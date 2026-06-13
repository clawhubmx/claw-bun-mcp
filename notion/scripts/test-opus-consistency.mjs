#!/usr/bin/env bun
/**
 * Opus 4.7 consistency batch: 30 long prompts via notion/chat (newChat each run).
 *
 * Usage:
 *   bun notion/scripts/test-opus-consistency.mjs --tab 858e
 *   bun notion/scripts/test-opus-consistency.mjs --dry-run
 *   bun notion/scripts/test-opus-consistency.mjs --prompt n01
 *   bun notion/scripts/test-opus-consistency.mjs --help
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const SUITE_DIR = join(ROOT, "notion/example/opus-consistency-runs");
const PROMPTS_META = join(SUITE_DIR, "prompts.json");
const PROMPT21 = join(ROOT, "notion/example/prompt21.txt");
const FINANCIAL_BASE = join(ROOT, "grok/example/test1.txt");
const STREAMING_NEWS = join(ROOT, "notion/example/incomplete-reply-probe/prompt-03-streaming-news.txt");
const PROBE_DIR = join(ROOT, "notion/example/incomplete-reply-probe");

const FINANCIAL_VARIANTS = [
  {
    published_at: "2026-05-24T13:56:00+00:00",
    fingerprint:
      '{"primary_event":"Signs of progress toward Iran deal amid Trump shifting rhetoric","event_date_estimate":"2026-05-24","atomic_claims":["Trump warned Iran clock is ticking","Trump postponed planned attack","Trump said negotiations in final phase"],"search_query":"Trump Iran deal progress","entities":["Trump","Iran","US"]}',
    headline: "Signs of progress toward Iran deal follow another week of Trump's shifting rhetoric",
  },
  {
    published_at: "2026-06-01T09:15:00+00:00",
    fingerprint:
      '{"primary_event":"Federal Reserve holds rates steady amid mixed inflation signals","event_date_estimate":"2026-06-01","atomic_claims":["Fed kept benchmark rate unchanged","Powell cited labor market cooling","Dot plot showed two cuts in 2026"],"search_query":"Fed rate decision June 2026","entities":["Fed","Powell","US"]}',
    headline: "Fed holds interest rates steady, signals patience on cuts as inflation cools gradually",
  },
  {
    published_at: "2026-06-05T16:40:00+00:00",
    fingerprint:
      '{"primary_event":"Apple unveils AI features at WWDC 2026","event_date_estimate":"2026-06-05","atomic_claims":["Apple Intelligence expanded to third-party apps","New on-device models announced","Privacy sandbox for cloud AI detailed"],"search_query":"Apple WWDC 2026 AI announcements","entities":["Apple","WWDC","iOS"]}',
    headline: "Apple expands AI across its platforms at WWDC, emphasizing on-device privacy",
  },
  {
    published_at: "2026-06-08T11:20:00+00:00",
    fingerprint:
      '{"primary_event":"SpaceX IPO filing draws record institutional demand","event_date_estimate":"2026-06-08","atomic_claims":["S-1 filed with SEC","Order book oversubscribed multiple times","Musk retains voting control structure"],"search_query":"SpaceX IPO 2026 oversubscribed","entities":["SpaceX","Musk","SEC"]}',
    headline: "SpaceX IPO reportedly oversubscribed as investors chase access to Starlink growth",
  },
  {
    published_at: "2026-06-11T08:00:00+00:00",
    fingerprint:
      '{"primary_event":"Ethereum spot ETF sees largest weekly inflow since launch","event_date_estimate":"2026-06-11","atomic_claims":["$1.2B weekly net inflow reported","BlackRock fund led flows","ETH price rose 8% on week"],"search_query":"Ethereum ETF inflows June 2026","entities":["Ethereum","ETF","BlackRock"]}',
    headline: "Ethereum ETFs post record weekly inflows as institutional demand accelerates",
  },
];

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: bun notion/scripts/test-opus-consistency.mjs [options]

Options:
  --help              Show this help
  --dry-run           Load prompts and print plan; no bun-browser calls
  --tab <id>          Target browser tab (recommended)
  --model <name>      Model alias (default: opus)
  --prompt <id>       Run one prompt id (e.g. n01)
  --maxPolls <n>      waitOnly polls after initial submit (default: 5)
  --maxWaitMs <n>     Initial submit maxWaitMs (default: 900000 = 15m; matches daemon chat timeout)
  --pollMaxWaitMs <n> maxWaitMs per waitOnly poll
  --pauseMs <n>       Pause between prompts (default: 3000)

Tab: pass --tab from \`bun-browser tab list --json\`. The same tab is used for every prompt;
if it disappears mid-run (e.g. after a daemon timeout), the batch aborts.

Output: ${SUITE_DIR}/run-<timestamp>.json and summary.json
`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const tabArg = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
let tabRef = tabArg;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const promptFilter = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : null;
const maxPollsArg = args.includes("--maxPolls") ? Number(args[args.indexOf("--maxPolls") + 1]) : null;
const maxWaitMsArg = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : null;
const pollMaxWaitMsArg = args.includes("--pollMaxWaitMs") ? Number(args[args.indexOf("--pollMaxWaitMs") + 1]) : null;
const pauseMsArg = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : null;

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
const defaults = meta.defaults || {};
const resolvedModel = model || defaults.model || "opus";
const maxPolls = maxPollsArg ?? defaults.maxPolls ?? 5;
const pauseMs = pauseMsArg ?? defaults.pauseMs ?? 3000;
const defaultMaxWaitMs = maxWaitMsArg ?? defaults.maxWaitMs ?? 900000;
const defaultPollMaxWaitMs = pollMaxWaitMsArg ?? defaults.pollMaxWaitMs ?? defaultMaxWaitMs;

function buildNewsCompact(topic) {
  const template = readFileSync(PROMPT21, "utf8");
  return template.replace(/Based on user query: "[^"]+"/i, `Based on user query: "${topic}"`);
}

function buildNewsStreaming(topic) {
  const template = readFileSync(STREAMING_NEWS, "utf8");
  return template.replace(/Based on user query: "[^"]+"/i, `Based on user query: "${topic}"`);
}

function buildFinancialTemporal(variantIndex) {
  const base = readFileSync(FINANCIAL_BASE, "utf8");
  const v = FINANCIAL_VARIANTS[variantIndex % FINANCIAL_VARIANTS.length];
  return base
    .replace(/published_at: [^\n]+/, `published_at: ${v.published_at}`)
    .replace(
      /Event fingerprint from prior extraction:\n\{[^}]+\}/,
      `Event fingerprint from prior extraction:\n${v.fingerprint}`,
    )
    .replace(/Signs of progress toward Iran deal follow[^\n]+/, v.headline);
}

function buildProseEssay(topic) {
  return `Write a detailed analytical essay of at least 450 words about "${topic}". Structure your response with an introduction, three substantive body paragraphs (each with a clear topic sentence and supporting evidence), and a conclusion. Discuss current market or policy trends, key stakeholders, risks, and plausible scenarios for the next 12–18 months. Use concrete examples and avoid bullet lists. Do not use JSON or markdown headings.`;
}

function buildProseAnalysis(topic) {
  return `Provide a multi-paragraph comparative analysis (minimum 350 words, prose only, no JSON) of "${topic}". Compare at least three regional approaches or technologies, explain trade-offs, cite specific recent developments where possible, and end with a short forward-looking assessment. No bullet points, no markdown formatting, no code blocks.`;
}

function resolvePrompt(item) {
  if (item.file) {
    return readFileSync(join(SUITE_DIR, item.file), "utf8").trim();
  }
  switch (item.template) {
    case "news-compact":
      return buildNewsCompact(item.topic);
    case "news-streaming":
      return buildNewsStreaming(item.topic);
    case "financial-temporal":
      return buildFinancialTemporal(item.variant ?? 0);
    case "prose-essay":
      return buildProseEssay(item.topic);
    case "prose-analysis":
      return buildProseAnalysis(item.topic);
    default:
      throw new Error(`Unknown template: ${item.template}`);
  }
}

function loadPromptItems() {
  let items = meta.prompts.map((p) => ({
    ...p,
    prompt: resolvePrompt(p),
    maxWaitMs: p.maxWaitMs ?? defaultMaxWaitMs,
    pollMaxWaitMs: p.pollMaxWaitMs ?? defaultPollMaxWaitMs,
  }));
  if (promptFilter) {
    items = items.filter((p) => p.id === promptFilter);
    if (!items.length) {
      console.error(`Unknown --prompt id: ${promptFilter}`);
      process.exit(1);
    }
  }
  return items;
}

function hashAnswer(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function run(argv, timeoutMs = defaultMaxWaitMs + 120000) {
  const full = ["bun", CLI, ...argv];
  if (tabRef != null) full.push("--tab", tabRef);
  full.push("--json");
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    cmd: full.join(" "),
    tab: tabRef,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
}

function listTabs() {
  const listed = run(["tab", "list"], 30000);
  const data = parseJson(listed.stdout);
  return data?.tabs ?? data?.data?.tabs ?? [];
}

function tabExists(tabId) {
  if (!tabId) return false;
  const needle = String(tabId).toLowerCase();
  return listTabs().some((t) => String(t.tab || t.tabId || "").toLowerCase() === needle);
}

function resolveTabRef() {
  if (tabRef) {
    if (!tabExists(tabRef)) {
      console.error(`Tab not found: ${tabRef}. Run: bun ${CLI} tab list --json`);
      process.exit(1);
    }
    return tabRef;
  }
  const opened = run(["tab", "new", "https://app.notion.com/ai"], 30000);
  const tabData = parseJson(opened.stdout);
  tabRef =
    tabData?.tab ||
    tabData?.data?.tab ||
    tabData?.data?.tabs?.slice(-1)[0]?.tab ||
    tabData?.tabs?.slice(-1)[0]?.tab;
  if (!tabRef) {
    console.error("Failed to open dedicated tab:", opened.stderr || opened.stdout);
    process.exit(1);
  }
  console.log(`Opened dedicated tab: ${tabRef}\n`);
  return tabRef;
}

function assertTabAlive(context) {
  if (!tabRef || tabExists(tabRef)) return true;
  console.error(`Tab ${tabRef} no longer available (${context}). Aborting batch.`);
  return false;
}

function parseJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success
        ? parsed.data
        : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, action: parsed.action };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 800) };
  }
}

function unwrapEval(data) {
  if (data?.result && typeof data.result === "object") return data.result;
  return data;
}

const probeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var msgs=h.getAssistantMessagesSinceLastUser();
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';
  var parsed=h.parseAnswerJson?h.parseAnswerJson(ans):null;
  return{
    helpersVersion:h.version,
    tabHidden:document.hidden,
    hasCompletedReplyActions:h.hasCompletedReplyActions(),
    isGenerating:h.isGenerating(),
    isChatInProgress:h.isChatInProgress(),
    answerLen:ans.length,
    looksFinal:h.looksLikeFinalAnswer(ans),
    hasParsedJson:!!parsed,
    parsedPreview:parsed?JSON.stringify(parsed).slice(0,200):null,
    answerPreview:String(ans||'').slice(0,500),
    answerFull:ans,
    conversationId:h.getConversationId()
  };
})()`;

function isStillGenerating(data) {
  if (!data) return false;
  return data.error === "Still generating" || data.kind === "chat_in_progress";
}

function isBlockerError(data) {
  if (data?.timedOut) return "spawn_timeout";
  if (!data?.error && !data?.chatError) return null;
  const e = String(data.error || data.chatError || "");
  if (/Tab not found/i.test(e)) return "tab_not_found";
  if (/Daemon request timed out/i.test(e)) return "daemon_timeout";
  if (/credit|quota|limit|exhausted|billing/i.test(e)) return "credits";
  if (/Tab busy/i.test(e)) return "tabBusy";
  if (/not logged in/i.test(e)) return "notLoggedIn";
  if (/Navigation required/i.test(e)) return "navigation";
  return null;
}

function runChat(prompt, maxWaitMs, mode) {
  const t0 = Date.now();
  let argv;
  if (mode === "submit") {
    argv = [
      "site",
      "notion/chat",
      prompt,
      "--model",
      resolvedModel,
      "--newChat",
      "true",
      "--maxWaitMs",
      String(maxWaitMs),
    ];
  } else {
    argv = [
      "site",
      "notion/chat",
      "x",
      resolvedModel,
      "true",
      "false",
      "true",
      "",
      String(maxWaitMs),
    ];
  }
  const chatRun = run(argv, maxWaitMs + 120000);
  const chatData = parseJson(chatRun.stdout);
  const probeRun = run(["eval", probeJs], 30000);
  const probe = unwrapEval(parseJson(probeRun.stdout));
  const domAnswer = probe?.answerFull || "";
  return {
    mode,
    elapsedMs: Date.now() - t0,
    timedOut: chatRun.timedOut,
    tab: chatRun.tab,
    cmd: chatRun.cmd,
    chatStatus: chatRun.status,
    chatError: chatData?.error || null,
    chatKind: chatData?.kind || null,
    chatAction: chatData?.action || null,
    answer: chatData?.answer || null,
    answerFormat: chatData?.answerFormat || null,
    answerJson: chatData?.answerJson || null,
    jsonRecovered: chatData?.jsonRecovered || false,
    conversationId: chatData?.conversationId || probe?.conversationId || null,
    answerLen: domAnswer.length || (chatData?.answer ? String(chatData.answer).length : 0),
    answerHash: hashAnswer(domAnswer || chatData?.answer || ""),
    looksFinal: probe?.looksFinal ?? null,
    hasParsedJson: probe?.hasParsedJson ?? !!chatData?.answerJson,
    parseableJson: !!(chatData?.answerJson || probe?.hasParsedJson),
    helpersVersion: probe?.helpersVersion ?? null,
    hasCompletedReplyActions: probe?.hasCompletedReplyActions ?? null,
    prematureStop:
      probe?.hasCompletedReplyActions === true &&
      probe?.looksFinal === false &&
      domAnswer.length > 0,
    probe,
  };
}

function shouldContinuePolling(step, item) {
  const blocker = isBlockerError(step);
  if (blocker) return false;
  if (step.chatError !== "Still generating") {
    if (item.expectJson && step.answerLen > 0 && step.looksFinal === false) return true;
    if (item.expectJson && step.answer && !step.parseableJson) return true;
    if (step.prematureStop) return true;
    return false;
  }
  return true;
}

function detectIdenticalStuck(steps) {
  const hashes = steps.map((s) => s.answerHash);
  const uniqueHashes = new Set(hashes.filter((h) => h && h !== hashAnswer("")));
  if (uniqueHashes.size !== 1 || steps.length < 2) {
    return { stuck: false, hash: null, count: 0 };
  }
  const allStillOrIncomplete = steps.every(
    (s) =>
      s.chatError === "Still generating" ||
      s.looksFinal === false ||
      (s.answerLen > 0 && !s.parseableJson),
  );
  if (!allStillOrIncomplete) return { stuck: false, hash: hashes[0], count: steps.length };
  return { stuck: true, hash: hashes[0], count: steps.length };
}

function evaluatePass(item, steps, stuck) {
  const last = steps[steps.length - 1];
  const issues = [];
  const blocker = isBlockerError(last);

  if (stuck.stuck) issues.push("identical_answer_stuck");
  if (blocker) issues.push(blocker);

  const incomplete =
    !blocker &&
    (last.looksFinal === false ||
      (item.expectJson && last.answerLen > 0 && !last.parseableJson && last.chatError !== "Still generating"));
  if (incomplete) issues.push("incomplete_or_truncated");

  if (last.prematureStop) issues.push("premature_stop");

  if (item.expectJson) {
    if (!blocker && !last.parseableJson && last.chatError !== "Still generating") {
      issues.push("missing_parseable_json");
    }
    const partialBug =
      last.answer && !last.chatError && last.looksFinal === false && !last.parseableJson && last.answerLen > 0;
    if (partialBug) issues.push("partial_success_invalid_json");
  } else if (item.expectedToken) {
    const ans = String(last.answer || last.probe?.answerFull || "");
    if (!blocker && !ans.includes(item.expectedToken)) issues.push("missing_expected_token");
  } else if (!blocker && !last.answer && last.chatError !== "Still generating") {
    issues.push("empty_answer");
  }

  if (last.chatError === "Still generating") issues.push("still_generating");

  const pass =
    issues.length === 0 &&
    !stuck.stuck &&
    (last.answer || last.parseableJson) &&
    last.chatError !== "Still generating";

  return { pass, issues, incomplete: issues.includes("incomplete_or_truncated"), prematureStop: last.prematureStop };
}

const plan = loadPromptItems();
const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");

if (dryRun) {
  console.log(`Dry run: ${plan.length} prompt(s), model=${resolvedModel}, maxPolls=${maxPolls}\n`);
  for (const item of plan) {
    console.log(`  ${item.id} (${item.kind}) expectJson=${item.expectJson} len=${item.prompt.length}`);
  }
  console.log(`\nWould write: ${SUITE_DIR}/run-${runTimestamp}.json`);
  process.exit(0);
}

mkdirSync(SUITE_DIR, { recursive: true });

const results = {
  startedAt: new Date().toISOString(),
  runTimestamp,
  suite: meta.suite,
  model: resolvedModel,
  tab: null,
  maxPolls,
  maxWaitMs: defaultMaxWaitMs,
  pollMaxWaitMs: defaultPollMaxWaitMs,
  helpersTargetMin: 39,
  runs: [],
  blockers: [],
  batchAborted: false,
  batchAbortReason: null,
};

resolveTabRef();
results.tab = tabRef;

console.log(
  `Opus consistency: ${plan.length} prompts, model=${resolvedModel}, maxWaitMs=${defaultMaxWaitMs}, maxPolls=${maxPolls}, tab=${tabRef}\n`,
);

run(["open", "https://app.notion.com/ai"], 30000);
spawnSync("sleep", ["5"]);
run(["site", "notion/chat", "--selectOnly", "true", "--model", resolvedModel], 90000);

let batchAborted = false;
let batchAbortReason = null;

for (const item of plan) {
  console.log(`--- ${item.id} | ${item.kind} | expectJson=${item.expectJson} | len=${item.prompt.length} ---`);

  const steps = [];
  let skipped = false;
  let skipReason = null;

  if (batchAborted) {
    skipped = true;
    skipReason = batchAbortReason || "batch_aborted";
    console.log(`  SKIP: batch aborted (${skipReason})`);
  } else if (!assertTabAlive(`before ${item.id}`)) {
    batchAborted = true;
    batchAbortReason = "tab_lost";
    skipped = true;
    skipReason = batchAbortReason;
    results.blockers.push({ id: item.id, reason: batchAbortReason, step: "precheck" });
  }

  if (!skipped) {
    const initial = runChat(item.prompt, item.maxWaitMs, "submit");
    steps.push(initial);
    console.log(
      `  submit: tab=${initial.tab} | error=${initial.chatError || "none"} | answerLen=${initial.answerLen} | looksFinal=${initial.looksFinal} | parseableJson=${initial.parseableJson} | helpers=${initial.helpersVersion} | ${initial.elapsedMs}ms`,
    );

    const initialBlocker = isBlockerError(initial);
    if (initialBlocker) {
      skipped = true;
      skipReason = initialBlocker;
      results.blockers.push({ id: item.id, reason: initialBlocker, step: "submit" });
      console.log(`  SKIP: blocker ${initialBlocker}`);
      if (initialBlocker === "tab_not_found" || initialBlocker === "daemon_timeout") {
        if (initialBlocker === "daemon_timeout" && !assertTabAlive(`after ${item.id} daemon timeout`)) {
          batchAborted = true;
          batchAbortReason = "tab_lost_after_daemon_timeout";
        } else if (initialBlocker === "tab_not_found") {
          batchAborted = true;
          batchAbortReason = "tab_not_found";
        } else if (initialBlocker === "daemon_timeout") {
          batchAborted = true;
          batchAbortReason = "daemon_timeout";
        }
      }
    }
  }

  let polls = 0;
  while (!skipped && polls < maxPolls && shouldContinuePolling(steps[steps.length - 1], item)) {
    polls++;
    spawnSync("sleep", ["2"]);
    const poll = runChat(item.prompt, item.pollMaxWaitMs, "waitOnly");
    poll.pollIndex = polls;
    steps.push(poll);
    console.log(
      `  poll ${polls}: error=${poll.chatError || "none"} | answerLen=${poll.answerLen} | hash=${poll.answerHash} | looksFinal=${poll.looksFinal} | ${poll.elapsedMs}ms`,
    );
    const pollBlocker = isBlockerError(poll);
    if (pollBlocker) {
      skipped = true;
      skipReason = pollBlocker;
      results.blockers.push({ id: item.id, reason: pollBlocker, step: `poll-${polls}` });
      if (pollBlocker === "tab_not_found") {
        batchAborted = true;
        batchAbortReason = "tab_not_found";
      }
      break;
    }
    if (poll.answer && poll.chatError !== "Still generating" && poll.looksFinal !== false) break;
  }

  const stuck = detectIdenticalStuck(steps);
  const verdict = skipped
    ? { pass: false, issues: [skipReason || "skipped"], incomplete: false, prematureStop: false }
    : evaluatePass(item, steps, stuck);

  const last = steps[steps.length - 1] || null;
  const entry = {
    id: item.id,
    kind: item.kind,
    expectJson: item.expectJson,
    promptLen: item.prompt.length,
    skipped,
    skipReason,
    pass: verdict.pass,
    issues: verdict.issues,
    incomplete: verdict.incomplete,
    prematureStop: verdict.prematureStop,
    identicalAnswerStuck: stuck.stuck,
    identicalAnswerHash: stuck.hash,
    identicalPollCount: stuck.count,
    totalElapsedMs: steps.reduce((s, x) => s + x.elapsedMs, 0),
    final: last
      ? {
          chatError: last.chatError,
          answerLen: last.answerLen,
          answerFormat: last.answerFormat,
          parseableJson: last.parseableJson,
          conversationId: last.conversationId,
          looksFinal: last.looksFinal,
          hasCompletedReplyActions: last.hasCompletedReplyActions,
          helpersVersion: last.helpersVersion,
          answerPreview: last.answer
            ? String(last.answer).slice(0, 200)
            : last.probe?.answerPreview?.slice(0, 200) || null,
        }
      : {
          chatError: skipReason,
          answerLen: 0,
          answerFormat: null,
          parseableJson: false,
          conversationId: null,
          looksFinal: null,
          hasCompletedReplyActions: null,
          helpersVersion: null,
          answerPreview: null,
        },
    steps: steps.map((s) => ({
      mode: s.mode,
      pollIndex: s.pollIndex ?? null,
      tab: s.tab ?? tabRef,
      elapsedMs: s.elapsedMs,
      timedOut: s.timedOut,
      chatError: s.chatError,
      answerLen: s.answerLen,
      answerHash: s.answerHash,
      looksFinal: s.looksFinal,
      parseableJson: s.parseableJson,
      answerFormat: s.answerFormat,
      prematureStop: s.prematureStop,
      helpersVersion: s.helpersVersion,
    })),
  };

  results.runs.push(entry);
  writeFileSync(join(SUITE_DIR, `run-${runTimestamp}.json`), JSON.stringify(results, null, 2));
  writeFileSync(join(SUITE_DIR, "summary.json"), JSON.stringify(results, null, 2));

  console.log(
    `  ${entry.pass ? "PASS" : "FAIL"} | stuck=${stuck.stuck} | incomplete=${entry.incomplete} | premature=${entry.prematureStop} | issues=${verdict.issues.join(",") || "none"} | total=${entry.totalElapsedMs}ms\n`,
  );

  if (plan.indexOf(item) < plan.length - 1) spawnSync("sleep", [String(Math.ceil(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
results.batchAborted = batchAborted;
results.batchAbortReason = batchAbortReason;
results.passCount = results.runs.filter((r) => r.pass).length;
results.failCount = results.runs.length - results.passCount;
results.skippedCount = results.runs.filter((r) => r.skipped).length;
results.incompleteCount = results.runs.filter((r) => r.incomplete).length;
results.prematureStopCount = results.runs.filter((r) => r.prematureStop).length;
results.stuckCount = results.runs.filter((r) => r.identicalAnswerStuck).length;
results.avgElapsedMs = Math.round(
  results.runs.reduce((s, r) => s + r.totalElapsedMs, 0) / Math.max(results.runs.length, 1),
);

const failureGroups = {};
for (const r of results.runs.filter((x) => !x.pass)) {
  const key = (r.issues || []).sort().join("|") || "unknown";
  if (!failureGroups[key]) failureGroups[key] = [];
  failureGroups[key].push(r.id);
}
results.identicalFailures = failureGroups;
results.passRate = `${results.passCount}/${results.runs.length}`;

writeFileSync(join(SUITE_DIR, `run-${runTimestamp}.json`), JSON.stringify(results, null, 2));
writeFileSync(join(SUITE_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log("=== Summary ===");
console.log(`Tab: ${results.tab}`);
if (results.batchAborted) console.log(`Batch aborted: ${results.batchAbortReason}`);
console.log(`Passed: ${results.passCount}/${results.runs.length}`);
console.log(`Incomplete/truncated: ${results.incompleteCount}`);
console.log(`Premature stop: ${results.prematureStopCount}`);
console.log(`Identical-stuck: ${results.stuckCount}`);
console.log(`Skipped/blockers: ${results.skippedCount}`);
console.log(`Avg elapsed: ${results.avgElapsedMs}ms`);
console.log(`Identical failure groups: ${JSON.stringify(failureGroups)}`);
console.log(`Output: ${SUITE_DIR}/run-${runTimestamp}.json`);
console.log(`Summary: ${SUITE_DIR}/summary.json`);
process.exit(results.passCount === results.runs.length ? 0 : 1);
