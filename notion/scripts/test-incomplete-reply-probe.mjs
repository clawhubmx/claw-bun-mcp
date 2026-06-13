#!/usr/bin/env bun
/**
 * Probe remote notion/chat for "stuck on identical incomplete reply":
 * truncated JSON, Still generating loops, waitOnly polling, HELPERS_VERSION 25+ guards.
 *
 * Usage (local daemon):
 *   bun notion/scripts/test-incomplete-reply-probe.mjs --tab 30d9
 *   bun notion/scripts/test-incomplete-reply-probe.mjs --tab 30d9 --model auto
 *   bun notion/scripts/test-incomplete-reply-probe.mjs --dry-run
 *   bun notion/scripts/test-incomplete-reply-probe.mjs --help
 *
 * Single prompt:
 *   bun notion/scripts/test-incomplete-reply-probe.mjs --tab 30d9 --prompt p03-streaming-stress
 *
 * Manual one-off (same tab, new chat per prompt):
 *   bun /Users/hesdx/Documents/toolings/bun-browser/dist/cli.js site notion/chat "$(cat notion/example/incomplete-reply-probe/prompt-01-control-json.txt)" auto true false false --tab <TAB> --json
 *
 * waitOnly poll (in-flight reply on same tab):
 *   bun /Users/hesdx/Documents/toolings/bun-browser/dist/cli.js site notion/chat "x" auto true false true --maxWaitMs 30000 --tab <TAB> --json
 *
 * Staging1 production (docker exec inside bunbrowser container):
 *   ssh staging1 'docker exec bunbrowser bun-browser tab list --json'
 *   ssh staging1 'docker exec bunbrowser bun-browser site notion/chat "$(cat /path/in/container/prompt.txt)" auto true false false --tab <TAB> --json'
 *   ssh staging1 'docker exec bunbrowser bun-browser site notion/chat "x" auto true false true --maxWaitMs 30000 --tab <TAB> --json'
 *
 * Copy probe files to staging first, or pipe prompt inline:
 *   ssh staging1 "docker exec -i bunbrowser bun-browser site notion/chat \"\$(cat)\" auto true false false --tab <TAB> --json" < notion/example/incomplete-reply-probe/prompt-01-control-json.txt
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const PROBE_DIR = join(ROOT, "notion/example/incomplete-reply-probe");
const PROMPTS_META = join(PROBE_DIR, "prompts.json");
const OUT_DIR = join(PROBE_DIR, "runs");

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: bun notion/scripts/test-incomplete-reply-probe.mjs [options]

Options:
  --help              Show this help
  --dry-run           Load prompts and print plan; no bun-browser calls
  --tab <id>          Target browser tab (recommended for production)
  --model <name>      Model alias (default: auto)
  --prompt <id>       Run one prompt id from prompts.json (e.g. p01-control)
  --maxPolls <n>      waitOnly polls after initial submit (default: 3)
  --pollMaxWaitMs <n> maxWaitMs per waitOnly poll (default: from prompts.json)
  --pauseMs <n>       Pause between prompts (default: 2000)

Output: ${OUT_DIR}/summary.json and per-prompt run-*.json
`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
let activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const promptFilter = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : null;
const maxPollsArg = args.includes("--maxPolls") ? Number(args[args.indexOf("--maxPolls") + 1]) : null;
const pollMaxWaitMsArg = args.includes("--pollMaxWaitMs") ? Number(args[args.indexOf("--pollMaxWaitMs") + 1]) : null;
const pauseMsArg = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : null;

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
const defaults = meta.defaults || {};
const resolvedModel = model || defaults.model || "auto";
const maxPolls = maxPollsArg ?? defaults.maxPolls ?? 3;
const pauseMs = pauseMsArg ?? defaults.pauseMs ?? 2000;

function loadPromptItems() {
  let items = meta.prompts.map((p) => ({
    ...p,
    prompt: readFileSync(join(PROBE_DIR, p.file), "utf8").trim(),
    pollMaxWaitMs: pollMaxWaitMsArg ?? p.pollMaxWaitMs ?? defaults.pollMaxWaitMs ?? 30000,
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

function run(argv, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv];
  if (activeTab != null) full.push("--tab", activeTab);
  full.push("--json");
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    cmd: full.join(" "),
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
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
    tabVisibility:document.visibilityState,
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
  const chatRun = run(argv, maxWaitMs + 45000);
  const chatData = parseJson(chatRun.stdout);
  const probeRun = run(["eval", probeJs], 30000);
  const probe = unwrapEval(parseJson(probeRun.stdout));
  const domAnswer = probe?.answerFull || "";
  return {
    mode,
    elapsedMs: Date.now() - t0,
    timedOut: chatRun.timedOut,
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
    helpersVersion: probe?.helpersVersion ?? null,
    probe,
  };
}

function shouldContinuePolling(step, item) {
  if (step.chatError !== "Still generating") {
    if (item.expectJson && step.answerLen > 0 && step.looksFinal === false) return true;
    if (item.expectJson && step.answer && !step.answerJson && !step.hasParsedJson) return true;
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
      (s.answerLen > 0 && !s.hasParsedJson),
  );
  if (!allStillOrIncomplete) return { stuck: false, hash: hashes[0], count: steps.length };
  return { stuck: true, hash: hashes[0], count: steps.length };
}

function evaluatePass(item, steps, stuck) {
  const last = steps[steps.length - 1];
  const issues = [];

  if (stuck.stuck) {
    issues.push("identical_answer_stuck");
  }

  if (item.expectJson) {
    const gotJson = !!(last.answerJson || last.hasParsedJson);
    const partialBug =
      last.answer &&
      !last.chatError &&
      last.looksFinal === false &&
      !gotJson &&
      last.answerLen > 0;
    if (partialBug) issues.push("partial_success_invalid_json");
    if (last.chatError === "Still generating" && last.answer && !gotJson && last.answerLen > 50) {
      issues.push("still_generating_with_dom_text");
    }
  }

  if (item.id === "p01-control") {
    if (!last.answerJson && !last.hasParsedJson) issues.push("missing_json");
    if (last.chatError === "Still generating") issues.push("still_generating");
  }

  if (item.id === "p02-json-guard") {
    const planets = last.answerJson?.planets || last.probe?.parsedPreview;
    if (!last.chatError && !last.answerJson?.planets?.length && !last.hasParsedJson) {
      if (!last.chatError) issues.push("missing_planets_array");
    }
  }

  if (item.id === "p04-prose-control") {
    const ans = String(last.answer || last.probe?.answerFull || "");
    if (!ans.includes(item.expectedToken || "OK-NOTION-FLOW")) issues.push("missing_expected_token");
  }

  if (item.id === "p05-preamble-edge") {
    const parsed = last.answerJson;
    if (!last.chatError && parsed && parsed.probe !== "preamble") issues.push("wrong_probe_field");
  }

  const pass = issues.length === 0 && !stuck.stuck && (last.answer || last.chatError === null);
  if (!last.answer && last.chatError === "Still generating") {
    return { pass: false, issues: [...issues, "timeout_still_generating"] };
  }
  if (last.answer || (item.expectJson && last.hasParsedJson)) {
    return { pass: issues.length === 0, issues };
  }
  return { pass: false, issues: issues.length ? issues : ["no_answer"] };
}

const plan = loadPromptItems();

if (dryRun) {
  console.log(`Dry run: ${plan.length} prompt(s), model=${resolvedModel}, maxPolls=${maxPolls}\n`);
  for (const item of plan) {
    console.log(`  ${item.id}`);
    console.log(`    file: ${item.file}`);
    console.log(`    purpose: ${item.purpose}`);
    console.log(`    expectJson: ${item.expectJson}`);
    console.log(`    maxWaitMs: ${item.maxWaitMs}, pollMaxWaitMs: ${item.pollMaxWaitMs}`);
    console.log(`    promptLen: ${item.prompt.length}`);
    console.log("");
  }
  console.log(`Would write: ${OUT_DIR}/summary.json`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

const results = {
  startedAt: new Date().toISOString(),
  suite: meta.suite,
  model: resolvedModel,
  tab: activeTab,
  maxPolls,
  helpersTargetMin: 25,
  runs: [],
};

console.log(
  `Incomplete-reply probe: ${plan.length} prompt(s), model=${resolvedModel}, maxPolls=${maxPolls}, tab=${activeTab || "(auto)"}\n`,
);

if (!activeTab) {
  const newTab = run(["tab", "new", "https://app.notion.com/ai"], 30000);
  const tabData = parseJson(newTab.stdout);
  activeTab =
    tabData?.tab ||
    tabData?.data?.tab ||
    tabData?.data?.tabs?.slice(-1)[0]?.tab ||
    tabData?.tabs?.slice(-1)[0]?.tab;
  results.tab = activeTab;
  console.log(`Opened dedicated tab: ${activeTab}\n`);
  run(["open", "https://app.notion.com/ai"], 30000);
  spawnSync("sleep", ["5"]);
  run(["site", "notion/chat", "--selectOnly", "true"], 90000);
}

for (const item of plan) {
  console.log(`--- ${item.id} | expectJson=${item.expectJson} ---`);
  console.log(`  ${item.purpose}`);

  const steps = [];
  const initial = runChat(item.prompt, item.maxWaitMs, "submit");
  steps.push(initial);
  console.log(
    `  submit: error=${initial.chatError || "none"} | answerLen=${initial.answerLen} | looksFinal=${initial.looksFinal} | helpers=${initial.helpersVersion}`,
  );

  let polls = 0;
  while (polls < maxPolls && shouldContinuePolling(steps[steps.length - 1], item)) {
    polls++;
    spawnSync("sleep", ["1"]);
    const poll = runChat(item.prompt, item.pollMaxWaitMs, "waitOnly");
    poll.pollIndex = polls;
    steps.push(poll);
    console.log(
      `  poll ${polls}: error=${poll.chatError || "none"} | answerLen=${poll.answerLen} | hash=${poll.answerHash} | looksFinal=${poll.looksFinal}`,
    );
    if (poll.answer && poll.chatError !== "Still generating") break;
  }

  const stuck = detectIdenticalStuck(steps);
  const verdict = evaluatePass(item, steps, stuck);

  const entry = {
    id: item.id,
    purpose: item.purpose,
    expectJson: item.expectJson,
    maxWaitMs: item.maxWaitMs,
    pollMaxWaitMs: item.pollMaxWaitMs,
    pass: verdict.pass,
    issues: verdict.issues,
    identicalAnswerStuck: stuck.stuck,
    identicalAnswerHash: stuck.hash,
    identicalPollCount: stuck.count,
    steps: steps.map((s) => ({
      mode: s.mode,
      pollIndex: s.pollIndex ?? null,
      elapsedMs: s.elapsedMs,
      timedOut: s.timedOut,
      chatError: s.chatError,
      chatKind: s.chatKind,
      answerLen: s.answerLen,
      answerHash: s.answerHash,
      looksFinal: s.looksFinal,
      hasParsedJson: s.hasParsedJson,
      helpersVersion: s.helpersVersion,
      answerFormat: s.answerFormat,
      jsonRecovered: s.jsonRecovered,
      answerPreview: s.answer ? String(s.answer).slice(0, 200) : s.probe?.answerPreview?.slice(0, 200) || null,
    })),
    final: {
      chatError: steps[steps.length - 1].chatError,
      answer: steps[steps.length - 1].answer,
      answerJson: steps[steps.length - 1].answerJson,
      helpersVersion: steps[steps.length - 1].helpersVersion,
      looksFinal: steps[steps.length - 1].looksFinal,
    },
    passCriteria: item.passCriteria,
  };

  results.runs.push(entry);
  writeFileSync(join(OUT_DIR, `run-${item.id}.json`), JSON.stringify(entry, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  console.log(
    `  ${entry.pass ? "PASS" : "FAIL"} | stuck=${stuck.stuck} | issues=${verdict.issues.join(",") || "none"}\n`,
  );

  if (plan.indexOf(item) < plan.length - 1) spawnSync("sleep", [String(Math.ceil(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
results.passCount = results.runs.filter((r) => r.pass).length;
results.stuckCount = results.runs.filter((r) => r.identicalAnswerStuck).length;
results.failCount = results.runs.length - results.passCount;
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log("=== Summary ===");
console.log(`Passed: ${results.passCount}/${results.runs.length}`);
console.log(`Identical-stuck: ${results.stuckCount}/${results.runs.length}`);
console.log(`Output: ${OUT_DIR}/summary.json`);
process.exit(results.passCount === results.runs.length ? 0 : 1);
