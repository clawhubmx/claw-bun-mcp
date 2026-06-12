#!/usr/bin/env bun
/**
 * Live batch test: 30 prompts via notion/chat + chatfollow, verify reply-toolbar completion.
 *
 * Usage:
 *   bun notion/scripts/test-reply-completion.mjs --runs 30 --maxWaitMs 60000 --pauseMs 2000
 *   bun notion/scripts/test-reply-completion.mjs --tab 30d9
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT_DIR = join(ROOT, "notion/example/reply-completion-runs");

const PROMPTS = [
  "What is 17+25? Reply with just the number.",
  "Name one planet. One word only.",
  "Capital of Japan? One word.",
  "Is water wet? Reply yes or no only.",
  'Reply with only valid JSON: {"status":"ok","n":1}. json format only; NO markdown',
  "List two prime numbers under 20. Comma separated, no explanation.",
  'Return JSON only: {"color":"blue","count":3}. json format only',
  "How many continents? Reply with just the number.",
  "Name the chemical symbol for gold. One or two characters only.",
  'JSON only: {"topic":"AI","score":7}. no markdown',
  "What is 9 x 8? Number only.",
  "Which ocean is largest? One word.",
  "Reply with only: OK",
  'Return only JSON: {"hello":"world"}. json format only',
  "What year did World War II end? Four digits only.",
  "Name one programming language. One word.",
  'JSON only: {"items":["a","b"]}. json format only',
  "What is the square root of 144? Number only.",
  "Primary color made by mixing red and blue? One word.",
  "How many days in a leap year? Number only.",
  'Reply JSON only: {"answer":42,"unit":"none"}. json format only',
  "Capital of France? One word.",
  "How many sides does a hexagon have? Number only.",
  "Name one mammal that lays eggs. One word.",
  'JSON only: {"lang":"python","typing":"dynamic"}. json format only',
  "What is 100 divided by 4? Number only.",
  "Which planet is closest to the Sun? One word.",
  "How many bytes in a kilobyte (decimal)? Number only.",
  'Return JSON only: {"pi":3.14}. json format only',
  "What is 2 to the power of 5? Number only.",
  "Name one Nobel Prize category. One or two words.",
  "In one sentence, explain what HTTP stands for.",
];

const args = process.argv.slice(2);
const runsArg = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 30;
let activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 180000;
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 2000;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "auto";
const spawnTimeoutMs = maxWaitMs + 45000;

mkdirSync(OUT_DIR, { recursive: true });

function run(argv, timeoutMs = 900000) {
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

const probeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var msgs=h.getAssistantMessagesSinceLastUser();
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';
  var scope=h.getLatestAssistantReplyScope?h.getLatestAssistantReplyScope():null;
  var checks={};
  if(h.REPLY_ACTION_REQUIRED){
    h.REPLY_ACTION_REQUIRED.forEach(function(l){
      checks[l]=scope?!!h.findReplyActionButton(scope,l):false;
    });
  }
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
    replyChecks:checks,
    conversationId:h.getConversationId()
  };
})()`;

function isStillGenerating(data) {
  if (!data) return false;
  return data.error === "Still generating" || data.kind === "chat_in_progress";
}

function isTabBusy(data) {
  if (!data) return false;
  return data.error === "Tab busy" || data.kind === "chat_in_progress";
}

function isUiError(data) {
  if (!data?.error) return false;
  const e = String(data.error);
  return /not found|Navigation required|Chat input not found|Submit button|Mode selection|Attachment failed/i.test(e);
}

function resolveCapturedAnswer(chatData, probe) {
  if (chatData?.answer && String(chatData.answer).trim()) {
    return { answer: String(chatData.answer), recovered: false, source: "chat" };
  }
  const probeAnswer = probe?.answerFull || probe?.answerPreview;
  if (
    probeAnswer &&
    probe.hasCompletedReplyActions &&
    !probe.isGenerating &&
    !probe.isChatInProgress
  ) {
    return { answer: String(probeAnswer), recovered: true, source: "probe" };
  }
  return { answer: "", recovered: false, source: null };
}

function classifyFailure(entry) {
  if (entry.pass) return null;
  if (entry.timedOut) return "timeout";
  if (isTabBusy({ error: entry.chatError, kind: entry.chatKind })) return "tabBusy";
  if (isStillGenerating({ error: entry.chatError, kind: entry.chatKind })) return "stillGenerating";
  if (isUiError({ error: entry.chatError })) return "uiError";
  if (!entry.capturedAnswer) return "empty";
  return "other";
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
  kind: prompt.includes("JSON") || prompt.includes("json") ? "json" : "short",
}));

const results = {
  startedAt: new Date().toISOString(),
  maxWaitMs,
  spawnTimeoutMs,
  model,
  workflow: "chat_then_chatfollow",
  tab: activeTab,
  runs: [],
};

console.log(
  `Reply-completion test: ${plan.length} prompts, maxWaitMs=${maxWaitMs}, spawnTimeout=${spawnTimeoutMs}, model=${model}\n`,
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
}

run(["open", "https://app.notion.com/ai"], 30000);
spawnSync("sleep", ["5"]);
run(["site", "notion/chat", "--selectOnly", "true"], 90000);

let conversationId = null;

for (const item of plan) {
  console.log(`--- Run ${item.run}/${plan.length} | ${item.kind} ---`);
  const command = item.run === 1 ? "chat" : "chatfollow";
  let { chatRun, chatData, elapsedMs } = runPrompt(item, conversationId, command);
  let usedCommand = command;

  if (item.run === 1 && (chatData?.error || !chatData?.conversationId) && !chatRun.timedOut) {
    console.log("  retry: run 1 after page settle");
    spawnSync("sleep", ["3"]);
    const retry = runPrompt(item, conversationId, command);
    chatRun = retry.chatRun;
    chatData = retry.chatData;
    elapsedMs += retry.elapsedMs;
  }

  if (item.run === 1 && chatData?.conversationId) {
    conversationId = chatData.conversationId;
  }

  if (isStillGenerating(chatData) && conversationId) {
    console.log("  retry: waitOnly");
    const retry = runPrompt(item, conversationId, "waitOnly");
    chatRun = retry.chatRun;
    chatData = retry.chatData;
    elapsedMs += retry.elapsedMs;
    usedCommand = "waitOnly";
  }

  const probeRun = run(["eval", probeJs], 30000);
  const probe = unwrapEval(parseJson(probeRun.stdout));

  if (!conversationId && probe?.conversationId) {
    conversationId = probe.conversationId;
  }
  if (chatData?.conversationId) {
    conversationId = chatData.conversationId;
  }

  const capture = resolveCapturedAnswer(chatData, probe);
  const entry = {
    run: item.run,
    kind: item.kind,
    promptPreview: item.prompt.slice(0, 100),
    command: usedCommand,
    elapsedMs,
    timedOut: chatRun.timedOut,
    chatStatus: chatRun.status,
    chatRaw: chatRun.timedOut ? chatRun.stdout.slice(0, 500) : null,
    chatError: chatData?.error || null,
    chatKind: chatData?.kind || null,
    conversationId: conversationId || probe?.conversationId || null,
    capturedAnswer: capture.answer || null,
    recovered: capture.recovered,
    captureSource: capture.source,
    answerLen: capture.answer ? capture.answer.length : 0,
    answerPreview: capture.answer ? capture.answer.slice(0, 200) : null,
    answerFormat: chatData?.answerFormat || null,
    probe,
    pass:
      !!capture.answer &&
      probe?.hasCompletedReplyActions === true &&
      probe?.isChatInProgress === false,
  };
  entry.failureBucket = classifyFailure(entry);

  results.runs.push(entry);
  writeFileSync(join(OUT_DIR, `run-${String(item.run).padStart(2, "0")}.json`), JSON.stringify(entry, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  console.log(
    `  ${entry.pass ? "PASS" : "FAIL"} | captured=${entry.answerLen} | toolbar=${probe?.hasCompletedReplyActions} | recovered=${entry.recovered} | ${entry.elapsedMs}ms | error=${entry.chatError || "none"}`,
  );

  if (item.run < plan.length) spawnSync("sleep", [String(Math.floor(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
results.conversationId = conversationId;
results.passCount = results.runs.filter((r) => r.pass).length;
results.capturedCount = results.runs.filter((r) => r.capturedAnswer).length;
results.recoveredCount = results.runs.filter((r) => r.recovered).length;
results.failCount = results.runs.length - results.passCount;
results.passRate = `${results.passCount}/${results.runs.length}`;

const failureBuckets = { tabBusy: 0, stillGenerating: 0, timeout: 0, uiError: 0, empty: 0, other: 0 };
for (const r of results.runs) {
  if (r.failureBucket) failureBuckets[r.failureBucket] = (failureBuckets[r.failureBucket] || 0) + 1;
}
results.failureBuckets = failureBuckets;

writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log(`\n=== Results: ${results.passCount}/${results.runs.length} passed ===`);
console.log(`Captured: ${results.capturedCount}/${results.runs.length} | Recovered from probe: ${results.recoveredCount}`);
console.log(`Failure buckets: ${JSON.stringify(failureBuckets)}`);
console.log(`Summary: ${OUT_DIR}/summary.json`);
process.exit(results.passCount === results.runs.length ? 0 : 1);
