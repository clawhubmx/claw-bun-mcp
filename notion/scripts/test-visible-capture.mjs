#!/usr/bin/env bun
/**
 * Run 3 prompts and report capture vs tab visibility (hidden tabs block DOM capture).
 *
 * Usage:
 *   bun notion/scripts/test-visible-capture.mjs
 *   bun notion/scripts/test-visible-capture.mjs --tab <TAB_ID>
 *   bun notion/scripts/test-visible-capture.mjs --wait-for-visible 120000
 *
 * Before running: focus the Notion tab in Chrome so capture is reliable.
 * With --wait-for-visible, the script pauses until document.hidden is false.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT_DIR = join(ROOT, "notion/example/visible-capture-runs");

const PROMPTS = [
  "What is 17+25? Reply with just the number.",
  "Name one planet. One word only.",
  "Capital of Japan? One word.",
];

const args = process.argv.slice(2);
const runsArg = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 3;
let activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 60000;
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 2000;
const waitForVisibleMs = args.includes("--wait-for-visible")
  ? Number(args[args.indexOf("--wait-for-visible") + 1])
  : 0;
const requireVisible = args.includes("--require-visible");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "auto";
const spawnTimeoutMs = maxWaitMs + 45000;

mkdirSync(OUT_DIR, { recursive: true });

function run(argv, timeoutMs = spawnTimeoutMs) {
  const full = ["bun", CLI, ...argv];
  if (activeTab != null) full.push("--tab", activeTab);
  full.push("--json");
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  return {
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

const visProbeJs = `(function(){
  return {
    hidden: document.hidden,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    url: location.href
  };
})()`;

const captureProbeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var msgs=h.getAssistantMessagesSinceLastUser();
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';
  return{
    helpersVersion:h.version,
    tabHidden:document.hidden,
    tabVisibility:document.visibilityState,
    hasCompletedReplyActions:h.hasCompletedReplyActions(),
    isGenerating:h.isGenerating(),
    isChatInProgress:h.isChatInProgress(),
    answerLen:ans.length,
    looksFinal:h.looksLikeFinalAnswer(ans),
    answerPreview:String(ans||'').slice(0,500),
    answerFull:ans,
    conversationId:h.getConversationId()
  };
})()`;

function getTabVisibility() {
  return unwrapEval(parseJson(run(["eval", visProbeJs], 15000).stdout));
}

function waitUntilVisible(label, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    const v = getTabVisibility();
    if (v && v.hidden === false && v.visibility === "visible") {
      console.log(`  ${label}: tab visible after ${Date.now() - t0}ms`);
      return { ok: true, waitedMs: Date.now() - t0, ...v };
    }
    spawnSync("sleep", ["1"]);
  }
  const v = getTabVisibility();
  return { ok: false, waitedMs: Date.now() - t0, ...v };
}

function resolveCapturedAnswer(chatData, probe) {
  if (chatData?.answer && String(chatData.answer).trim()) {
    return { answer: String(chatData.answer), recovered: false, source: "chat" };
  }
  const probeAnswer = probe?.answerFull || probe?.answerPreview;
  if (probeAnswer && probe.hasCompletedReplyActions && !probe.isGenerating && !probe.isChatInProgress) {
    return { answer: String(probeAnswer), recovered: true, source: "probe" };
  }
  return { answer: "", recovered: false, source: null };
}

function runPrompt(item, conversationId, command) {
  const t0 = Date.now();
  let argv;
  if (command === "chat") {
    argv = ["site", "notion/chat", item.prompt, "--model", model, "--maxWaitMs", String(maxWaitMs)];
  } else if (command === "waitOnly") {
    argv = [
      "site",
      "notion/chatfollow",
      conversationId,
      item.prompt,
      "--model",
      model,
      "--maxWaitMs",
      String(maxWaitMs),
      "--waitOnly",
      "true",
    ];
  } else {
    argv = [
      "site",
      "notion/chatfollow",
      conversationId,
      item.prompt,
      "--model",
      model,
      "--maxWaitMs",
      String(maxWaitMs),
    ];
  }
  const chatRun = run(argv, spawnTimeoutMs);
  const chatData = parseJson(chatRun.stdout);
  return { chatRun, chatData, elapsedMs: Date.now() - t0, command };
}

const plan = PROMPTS.slice(0, runsArg).map((prompt, i) => ({
  run: i + 1,
  prompt,
}));

const results = {
  startedAt: new Date().toISOString(),
  maxWaitMs,
  spawnTimeoutMs,
  waitForVisibleMs,
  requireVisible,
  model,
  tab: activeTab,
  runs: [],
};

console.log(
  `Visible capture test: ${plan.length} prompts, maxWaitMs=${maxWaitMs}, spawnTimeout=${spawnTimeoutMs}`,
);
if (waitForVisibleMs > 0) {
  console.log(`Will wait up to ${waitForVisibleMs}ms per run for tab to become visible.\n`);
} else {
  console.log("Tip: focus the Notion tab in Chrome before running, or use --wait-for-visible 120000\n");
}

if (!activeTab) {
  const opened = parseJson(run(["open", "https://app.notion.com/ai"], 60000).stdout);
  activeTab = opened?.tabId || opened?.id;
  results.tab = activeTab;
  console.log(`Opened tab: ${activeTab}`);
  spawnSync("sleep", ["8"]);
}

const initialVis = getTabVisibility();
results.initialVisibility = initialVis;
console.log(
  `Initial visibility: hidden=${initialVis?.hidden} visibility=${initialVis?.visibility} focus=${initialVis?.hasFocus}`,
);

if (requireVisible && initialVis?.hidden) {
  console.error("\nTab is hidden. Focus it in Chrome or drop --require-visible.");
  process.exit(1);
}

run(["site", "notion/chat", "--selectOnly", "true", "--model", "auto"], 90000);

let conversationId = null;

for (const item of plan) {
  console.log(`\n--- Run ${item.run}/${plan.length} ---`);
  console.log(`  prompt: ${item.prompt.slice(0, 60)}...`);

  const visBefore = getTabVisibility();
  let waitResult = null;
  if (waitForVisibleMs > 0 && visBefore?.hidden) {
    console.log(`  tab hidden — waiting for you to activate it (max ${waitForVisibleMs}ms)...`);
    waitResult = waitUntilVisible("activate", waitForVisibleMs);
  }

  const command = item.run === 1 ? "chat" : "chatfollow";
  let { chatRun, chatData, elapsedMs } = runPrompt(item, conversationId, command);
  let usedCommand = command;

  if (item.run === 1 && chatData?.conversationId) {
    conversationId = chatData.conversationId;
  }

  if (chatData?.error === "Still generating" && conversationId) {
    console.log("  retry: waitOnly");
    const retry = runPrompt(item, conversationId, "waitOnly");
    chatRun = retry.chatRun;
    chatData = retry.chatData;
    elapsedMs += retry.elapsedMs;
    usedCommand = "waitOnly";
  }

  const visAfter = getTabVisibility();
  const probe = unwrapEval(parseJson(run(["eval", captureProbeJs], 30000).stdout));
  if (chatData?.conversationId) conversationId = chatData.conversationId;
  if (!conversationId && probe?.conversationId) conversationId = probe.conversationId;

  const capture = resolveCapturedAnswer(chatData, probe);
  const directFromChat = !!chatData?.answer?.trim();
  const entry = {
    run: item.run,
    promptPreview: item.prompt.slice(0, 100),
    command: usedCommand,
    visibilityBefore: visBefore,
    visibilityAfter: visAfter,
    waitForVisible: waitResult,
    elapsedMs,
    timedOut: chatRun.timedOut,
    chatError: chatData?.error || null,
    captureWarning: chatData?.captureWarning || null,
    chatAnswer: chatData?.answer || null,
    capturedAnswer: capture.answer || null,
    captureSource: capture.source,
    recovered: capture.recovered,
    probe,
    pass: !!capture.answer,
    captureWhileHidden: visBefore?.hidden === true && !waitResult?.ok,
    directCapture: directFromChat && !chatRun.timedOut,
  };

  results.runs.push(entry);

  const visNote = entry.captureWhileHidden ? " [CAPTURED WHILE HIDDEN — may be stale/timeout]" : "";
  console.log(
    `  ${entry.pass ? "PASS" : "FAIL"} | src=${entry.captureSource || "none"} | ${entry.elapsedMs}ms | hidden before=${visBefore?.hidden} after=${visAfter?.hidden} | answer=${JSON.stringify((entry.capturedAnswer || "").slice(0, 40))}${visNote}`,
  );
  if (entry.captureWarning) console.log(`  captureWarning: ${entry.captureWarning}`);
  if (entry.timedOut && entry.probe?.answerFull) {
    console.log(`  note: chat timed out but probe sees answer (activate tab fixes this)`);
  }

  if (item.run < plan.length) spawnSync("sleep", [String(Math.ceil(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
results.passCount = results.runs.filter((r) => r.pass).length;
results.directCaptureCount = results.runs.filter((r) => r.directCapture).length;
results.hiddenBeforeCount = results.runs.filter((r) => r.visibilityBefore?.hidden).length;
results.conversationId = conversationId;

writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log("\n=== Summary ===");
console.log(`Passed: ${results.passCount}/${results.runs.length}`);
console.log(`Direct chat capture (no timeout): ${results.directCaptureCount}/${results.runs.length}`);
console.log(`Runs started while tab hidden: ${results.hiddenBeforeCount}/${results.runs.length}`);
console.log(`Results: ${join(OUT_DIR, "summary.json")}`);
process.exit(results.passCount === results.runs.length ? 0 : 1);
