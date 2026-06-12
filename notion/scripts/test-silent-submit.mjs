#!/usr/bin/env bun
/**
 * Batch probe for "silent submit" — Notion chat accepts a prompt but shows no
 * Thinking/Searching progress and automation sees no in-flight signals.
 *
 * Usage:
 *   bun notion/scripts/test-silent-submit.mjs --runs 25
 *   bun notion/scripts/test-silent-submit.mjs --runs 25 --tab 2144
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const PROMPT21 = join(ROOT, "notion/example/prompt21.txt");
const OUT_DIR = join(ROOT, "notion/example/silent-submit-runs");

const MODELS = [
  { alias: "opus", title: "Opus 4.7" },
  { alias: "opus-4.7", title: "Opus 4.7" },
  { alias: "opus-4.8", title: "Opus 4.8" },
  { alias: "sonnet", title: "Sonnet 4.6" },
];

const SHORT_PROMPTS = [
  'Reply with only valid JSON: {"status":"ok","n":1}. json format only; NO markdown',
  "What is 17+25? Reply with just the number.",
  'Return JSON only: {"color":"blue","count":3}. json format only',
  "Name one planet. One word only.",
  'JSON only: {"topic":"AI regulation","score":7}. no markdown',
  "List two prime numbers under 20. Comma separated, no explanation.",
  'Return only JSON: {"hello":"world"}. json format only',
  "Capital of Japan? One word.",
  'JSON only: {"items":["a","b"]}. json format only',
  "Is water wet? yes or no only.",
];

function buildNewsPrompt(topic) {
  return `You are a news research assistant. Return JSON only; json format only; NO markdown.
Based on user query: "${topic}" find 2-3 unique news topics from reuters.com, bbc.com, apnews.com within 2026-06-09 to 2026-06-15.
format: {"query":"<text>","time_period":"<text>","unique_topics":["..."],"sources":"<text>"}
Use time_period from: 2026-06-10T14:30:00Z. json format only`;
}

const NEWS_TOPICS = [
  "SpaceX IPO oversubscribed",
  "Fed interest rate decision June 2026",
  "Apple WWDC announcements",
  "Ethereum ETF inflows",
  "OpenAI model release",
  "Ukraine peace talks",
  "NVIDIA chip export rules",
  "Bitcoin halving aftermath",
  "Tesla robotaxi launch",
  "Amazon AWS outage",
];

const args = process.argv.slice(2);
const runsArg = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 25;
let activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const probeMs = args.includes("--probeMs") ? Number(args[args.indexOf("--probeMs") + 1]) : 45000;
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 2500;

mkdirSync(OUT_DIR, { recursive: true });

function run(argv, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv];
  if (activeTab != null) full.push("--tab", activeTab);
  full.push("--json");
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
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
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind };
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

function buildPromptPlan(totalRuns) {
  const plan = [];
  let prompt21 = null;
  try {
    prompt21 = readFileSync(PROMPT21, "utf8");
  } catch {}

  for (let i = 0; i < totalRuns; i++) {
    const model = MODELS[i % MODELS.length];
    let prompt;
    let kind;
    if (i === 0 && prompt21) {
      prompt = prompt21;
      kind = "prompt21-full";
    } else if (i % 7 === 0) {
      prompt = buildNewsPrompt(NEWS_TOPICS[i % NEWS_TOPICS.length]);
      kind = "news-json";
    } else {
      prompt = SHORT_PROMPTS[i % SHORT_PROMPTS.length];
      kind = "short";
    }
    plan.push({ run: i + 1, model, prompt, kind, command: i % 3 === 0 ? "chat" : "chat" });
  }
  return plan;
}

function probeEvalScript(modelTitle, prompt, probeDurationMs) {
  return `(async function() {
  var PROBE_MS = ${probeDurationMs};
  var POLL_MS = 1500;
  var MODEL = ${JSON.stringify(modelTitle)};
  var PROMPT = ${JSON.stringify(prompt)};

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function snap(label, elapsedMs) {
    var h = globalThis.__notionAiChatHelpers;
    var editor = document.querySelector('[contenteditable=true][role=textbox]');
    var composerText = editor ? String(editor.innerText || editor.textContent || '').trim() : '';
    var submit = document.querySelector('[aria-label="Submit AI message"]');
    var submitDisabled = submit ? (submit.disabled || submit.getAttribute('aria-disabled') === 'true') : null;
    var chatRoot = document.querySelector('.layout-chat');
    var chatText = chatRoot ? (chatRoot.innerText || chatRoot.textContent || '') : '';
    var recentLines = chatText.split('\\n').slice(-25).filter(function(l) { return String(l||'').trim(); });
    var statusLines = recentLines.filter(function(l) {
      return /^(Searching|Reading|Browsing|Fetching|Thinking|Running|Exploring|Computing|Thought|Searching the web|Generating|\\d+s)\\b/i.test(String(l).trim());
    });
    var msgs = h && h.getAssistantMessages ? h.getAssistantMessages() : [];
    var abnormal = h && h.detectNotionPageAbnormal ? h.detectNotionPageAbnormal({ skipSubmitCheck: true }) : null;
    var rate = h && h.matchRateLimit ? h.matchRateLimit(chatText.slice(-3000)) : null;
    var reject = h && h.matchPromptRejected ? h.matchPromptRejected(chatText.slice(-3000)) : null;
    var credits = h && h.matchCreditsExhausted ? h.matchCreditsExhausted(chatText.slice(-3000)) : null;
    return {
      t: label,
      elapsedMs: elapsedMs,
      generating: h && h.isGenerating ? h.isGenerating() : null,
      inProgress: h && h.isChatInProgress ? h.isChatInProgress() : null,
      assistantCount: msgs.length,
      lastAssistantPreview: msgs.length ? String(h.getAssistantText(msgs[msgs.length-1])||'').slice(0,200) : '',
      composerLen: composerText.length,
      composerPreview: composerText.slice(0, 120),
      submitDisabled: submitDisabled,
      statusLineCount: statusLines.length,
      statusLines: statusLines.slice(0, 8),
      hasCopyResponse: !!document.querySelector('[aria-label="Copy response"]'),
      conversationId: h && h.getConversationId ? h.getConversationId() : null,
      abnormalKind: abnormal && abnormal.kind ? abnormal.kind : (abnormal && abnormal.error ? abnormal.error : null),
      rateLimit: !!rate,
      promptRejected: !!reject,
      creditsExhausted: !!credits,
      recentTail: recentLines.slice(-8)
    };
  }

  async function ensureHelpers() {
    if (globalThis.__notionAiChatHelpers) return globalThis.__notionAiChatHelpers;
    return null;
  }

  var h = await ensureHelpers();
  if (!h) {
    return { ok: false, phase: 'helpers', error: 'chat helpers not loaded — run notion/chat once on this tab first' };
  }

  var landing = await h.ensureNewChatView();
  if (!landing.ok) {
    return { ok: false, phase: 'landing', landing: landing, url: location.href };
  }

  var mode = await h.setNotionMode(MODEL);
  if (!mode.ok) {
    return { ok: false, phase: 'model', mode: mode };
  }

  var beforeCount = h.getAssistantMessages().length;
  if (!h.setChatInput(PROMPT)) {
    return { ok: false, phase: 'input', error: 'setChatInput failed' };
  }
  await sleep(400);

  var preSubmit = snap('pre_submit', 0);
  var submitted = h.clickSubmit();
  var t0 = Date.now();
  var timeline = [snap('post_submit_0ms', 0)];
  if (!submitted) {
    var block = h.detectNotionPageAbnormal();
    return { ok: false, phase: 'submit', submitted: false, preSubmit: preSubmit, block: block, timeline: timeline };
  }

  while (Date.now() - t0 < PROBE_MS) {
    await sleep(POLL_MS);
    timeline.push(snap('poll', Date.now() - t0));
  }

  var finalMsgs = h.getAssistantMessages();
  var answer = h.getAssistantAnswerSince(finalMsgs, beforeCount);
  var classification = 'unknown';
  var last = timeline[timeline.length - 1] || {};
  var anyStatus = timeline.some(function(s) { return (s.statusLineCount||0) > 0 || s.generating; });
  var anyAssistant = finalMsgs.length > beforeCount;
  var composerStillFull = last.composerLen > 20;
  if (answer && h.looksLikeFinalAnswer && h.looksLikeFinalAnswer(answer)) classification = 'answered';
  else if (last.abnormalKind) classification = 'abnormal:' + last.abnormalKind;
  else if (last.rateLimit) classification = 'rate_limit';
  else if (last.promptRejected) classification = 'prompt_rejected';
  else if (last.creditsExhausted) classification = 'credits_exhausted';
  else if (anyStatus || last.generating || last.inProgress) classification = 'in_flight_with_signals';
  else if (anyAssistant && !anyStatus) classification = 'assistant_text_no_status_lines';
  else if (composerStillFull) classification = 'silent_submit_composer_still_full';
  else if (!anyStatus && !anyAssistant) classification = 'silent_no_signals';
  else classification = 'other';

  return {
    ok: true,
    model: MODEL,
    promptLen: PROMPT.length,
    beforeCount: beforeCount,
    submitted: true,
    classification: classification,
    answerLen: (answer||'').length,
    answerPreview: String(answer||'').slice(0, 300),
    timeline: timeline,
    url: location.href
  };
})()`;
}

function resetTab() {
  run(["open", "https://app.notion.com/ai"], 30000);
  spawnSync("sleep", ["3"]);
  // Prime helpers by running a minimal chat load
  run(["site", "notion/health"], 60000);
}

function primeHelpers() {
  const r = run(["site", "notion/chat", "--selectOnly", "true", "--model", "opus"], 90000);
  return parseJson(r.stdout);
}

const plan = buildPromptPlan(runsArg);
const startedAt = new Date().toISOString();
const results = { startedAt, probeMs, pauseMs, tab: activeTab, runs: [] };

console.log(`Silent-submit probe: ${plan.length} runs, probe=${probeMs}ms, pause=${pauseMs}ms\n`);

if (!activeTab) {
  const newTab = run(["tab", "new", "https://app.notion.com/ai"], 30000);
  const tabData = parseJson(newTab.stdout);
  activeTab =
    tabData?.data?.tab ||
    tabData?.tab ||
    tabData?.data?.tabs?.slice(-1)[0]?.tab ||
    tabData?.tabs?.slice(-1)[0]?.tab;
  if (activeTab) console.log(`Opened dedicated tab: ${activeTab}`);
  results.tab = activeTab;
}

function runWithTab(argv, timeoutMs) {
  return run(argv, timeoutMs);
}

resetTab();
console.log("Priming helpers...");
const prime = runWithTab(["site", "notion/chat", "--selectOnly", "true"], 90000);
console.log("prime:", JSON.stringify(parseJson(prime.stdout)?.modeLabel || parseJson(prime.stdout)?.error));

for (const item of plan) {
  console.log(`\n--- Run ${item.run}/${plan.length} | ${item.model.alias} | ${item.kind} ---`);
  resetTab();
  spawnSync("sleep", ["2"]);
  runWithTab(["site", "notion/chat", "--selectOnly", "true", "--model", item.model.alias], 90000);

  const probeJs = probeEvalScript(item.model.title, item.prompt, probeMs);
  const probeRun = runWithTab(["eval", probeJs], probeMs + 120000);
  const probeData = unwrapEval(parseJson(probeRun.stdout));

  const entry = {
    run: item.run,
    kind: item.kind,
    model: item.model,
    promptPreview: item.prompt.slice(0, 120),
    probe: {
      timedOut: probeRun.timedOut,
      classification: probeData?.classification || probeData?.phase || probeData?.error,
      submitted: probeData?.submitted,
      answerLen: probeData?.answerLen,
      timelineSummary: (probeData?.timeline || []).map((s) => ({
        t: s.t,
        elapsedMs: s.elapsedMs,
        generating: s.generating,
        statusLineCount: s.statusLineCount,
        assistantCount: s.assistantCount,
        composerLen: s.composerLen,
        abnormalKind: s.abnormalKind,
      })),
      full: probeData,
    },
  };

  results.runs.push(entry);
  const outPath = join(OUT_DIR, `run-${String(item.run).padStart(2, "0")}.json`);
  writeFileSync(outPath, JSON.stringify(entry, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  console.log(`  probe: ${entry.probe.classification}`);

  spawnSync("sleep", [String(Math.floor(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
const counts = {};
for (const r of results.runs) {
  const k = r.probe.classification || "unknown";
  counts[k] = (counts[k] || 0) + 1;
}
results.classificationCounts = counts;
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log("\n=== Classification counts ===");
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log(`\nResults: ${OUT_DIR}/summary.json`);
