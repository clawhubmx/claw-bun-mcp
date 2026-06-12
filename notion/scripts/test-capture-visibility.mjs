#!/usr/bin/env bun
/**
 * Compare capture on hidden (new background) tab vs visible active tab.
 *
 * Usage:
 *   bun notion/scripts/test-capture-visibility.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT_DIR = join(ROOT, "notion/example/capture-visibility-runs");
const maxWaitMs = 60000;
const spawnTimeoutMs = maxWaitMs + 45000;

const PROMPTS = [
  { label: "hidden-new-tab", prompt: "What is 17+25? Reply with just the number." },
  { label: "visible-active-tab", prompt: "Capital of Japan? One word." },
];

mkdirSync(OUT_DIR, { recursive: true });

function run(argv, tabId, timeoutMs = spawnTimeoutMs) {
  const full = ["bun", CLI, ...argv];
  if (tabId) full.push("--tab", tabId);
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
    return { error: "invalid json", raw: stdout.slice(0, 500) };
  }
}

function unwrapEval(data) {
  if (data?.result && typeof data.result === "object") return data.result;
  return data;
}

const stateProbeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  return {
    hidden: document.hidden,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    helpersVersion: h ? h.version : null,
    url: location.href
  };
})()`;

const captureProbeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var msgs=h.getAssistantMessagesSinceLastUser();
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';
  return{
    hidden: document.hidden,
    visibility: document.visibilityState,
    helpersVersion: h.version,
    msgCount: msgs.length,
    answerLen: ans.length,
    answer: ans.slice(0,200),
    hasToolbar: h.hasCompletedReplyActions(),
    hasToolbarForTurn: h.hasCompletedReplyActionsForTurn ? h.hasCompletedReplyActionsForTurn(0,'') : null,
    isGenerating: h.isGenerating(),
    isGeneratingForTurn: h.isGeneratingForTurn ? h.isGeneratingForTurn(0,'') : null,
    looksFinal: h.looksLikeFinalAnswer(ans),
    captureWarning: h.getLastCaptureWarning ? h.getLastCaptureWarning() : null
  };
})()`;

function getTabState(tabId) {
  return unwrapEval(parseJson(run(["eval", stateProbeJs], tabId, 30000).stdout));
}

function captureProbe(tabId) {
  return unwrapEval(parseJson(run(["eval", captureProbeJs], tabId, 30000).stdout));
}

function runChatScenario(scenario, tabId, prompt) {
  const t0 = Date.now();
  const before = getTabState(tabId);
  console.log(`\n=== ${scenario} ===`);
  console.log(`tab=${tabId} hidden=${before?.hidden} visibility=${before?.visibility}`);

  run(["site", "notion/chat", "--selectOnly", "true", "--model", "auto"], tabId, 90000);

  const chat = run(
    ["site", "notion/chat", prompt, "--model", "auto", "--maxWaitMs", String(maxWaitMs)],
    tabId,
    spawnTimeoutMs,
  );
  const chatData = parseJson(chat.stdout);
  const afterChat = captureProbe(tabId);
  const elapsedMs = Date.now() - t0;

  const chatAnswer = chatData?.answer ? String(chatData.answer) : "";
  const probeAnswer = afterChat?.answer || "";
  const captured = chatAnswer || (afterChat?.hasToolbar && probeAnswer ? probeAnswer : "");

  return {
    scenario,
    tabId,
    prompt,
    elapsedMs,
    timedOut: chat.timedOut,
    chatStatus: chat.status,
    chatError: chatData?.error || null,
    chatHint: chatData?.hint || null,
    captureWarning: chatData?.captureWarning || null,
    chatAnswer: chatAnswer || null,
    chatSource: chatAnswer ? "chat" : null,
    probeAfter: afterChat,
    recoveredViaProbe: !chatAnswer && !!captured,
    capturedAnswer: captured || null,
    pass: !!captured,
    beforeTab: before,
  };
}

const results = { startedAt: new Date().toISOString(), scenarios: [] };

// Capture currently active Notion tab BEFORE opening a new background tab
const tabsBefore = unwrapEval(parseJson(run(["tab", "list"], null, 30000).stdout));
const visibleTabId = tabsBefore?.tabs?.find((t) => t.active && t.url?.includes("notion.com"))?.tabId || null;

// Scenario A: brand-new tab (bun-browser opens in background → usually hidden)
const open = run(["open", "https://app.notion.com/ai"], null, 60000);
const hiddenTab = unwrapEval(parseJson(open.stdout))?.tabId;
if (!hiddenTab) {
  console.error("Failed to open hidden tab:", open.stderr || open.stdout);
  process.exit(1);
}
console.log("Waiting 10s for /ai load on new tab...");
await Bun.sleep(10000);
results.scenarios.push(runChatScenario("A-hidden-new-tab", hiddenTab, PROMPTS[0].prompt));

await Bun.sleep(3000);

// Scenario B: previously active Notion tab (should be visible if still focused in Chrome)
if (!visibleTabId) {
  console.error("No active Notion tab before test. Open/focus a Notion tab in Chrome and re-run.");
  results.scenarios.push({
    scenario: "B-visible-active-tab",
    error: "no active notion tab at start",
    pass: false,
  });
} else {
  const visibleBefore = getTabState(visibleTabId);
  console.log(`Using pre-open active tab ${visibleTabId} hidden=${visibleBefore?.hidden}`);
  results.scenarios.push(
    runChatScenario("B-visible-active-tab", visibleTabId, PROMPTS[1].prompt),
  );
}

results.finishedAt = new Date().toISOString();
writeFileSync(join(OUT_DIR, "comparison.json"), JSON.stringify(results, null, 2));

console.log("\n=== Summary ===");
for (const s of results.scenarios) {
  if (s.error) {
    console.log(`${s.scenario}: ERROR ${s.error}`);
    continue;
  }
  const src = s.chatSource || (s.recoveredViaProbe ? "probe-after-timeout" : "none");
  console.log(
    `${s.scenario}: ${s.pass ? "PASS" : "FAIL"} | ${s.elapsedMs}ms | src=${src} | answer=${JSON.stringify(s.capturedAnswer)} | hidden=${s.probeAfter?.hidden} | chatError=${s.chatError || "none"} | timedOut=${s.timedOut}`,
  );
  if (s.captureWarning) console.log(`  captureWarning: ${s.captureWarning}`);
  if (!s.chatAnswer && s.probeAfter?.hasToolbar && s.probeAfter?.answerLen > 0) {
    console.log(`  WHY: chat returned empty/timed out but DOM had toolbar+answer (hidden=${s.probeAfter.hidden})`);
  }
}
