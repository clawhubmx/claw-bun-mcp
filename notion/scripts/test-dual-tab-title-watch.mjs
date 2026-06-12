#!/usr/bin/env bun
/**
 * Dual-tab title-watch capture test.
 *
 * Opens two Notion AI tabs, submits compact test2-style prompts without blocking,
 * polls tab titles via `tab list`, activates tabs when titles change, and captures
 * when Notion reports completion.
 *
 * Usage:
 *   bun notion/scripts/test-dual-tab-title-watch.mjs
 *   bun notion/scripts/test-dual-tab-title-watch.mjs --full
 *   bun notion/scripts/test-dual-tab-title-watch.mjs --topics "Topic A,Topic B"
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const TEST2 = join(ROOT, "grok/example/test2.txt");
const PROMPT21 = join(ROOT, "notion/example/prompt21.txt");
const AI_URL = "https://app.notion.com/ai";
const OUT_DIR = join(ROOT, "notion/example/dual-tab-title-watch-runs");

const DEFAULT_TOPICS = [
  "Protesters block road to Mexican World Cup stadium",
  "Fed interest rate decision June 2026",
];

const args = process.argv.slice(2);
const useFullTest2 = args.includes("--full");
const topicsArg = args.includes("--topics") ? args[args.indexOf("--topics") + 1] : null;
const TOPICS = topicsArg
  ? topicsArg.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2)
  : DEFAULT_TOPICS;
if (TOPICS.length < 2) {
  console.error("Need exactly 2 topics (use --topics \"A,B\")");
  process.exit(1);
}

const pollMs = args.includes("--pollMs") ? Number(args[args.indexOf("--pollMs") + 1]) : 3000;
const submitWaitMs = args.includes("--submitWaitMs") ? Number(args[args.indexOf("--submitWaitMs") + 1]) : 12000;
const captureWaitMs = args.includes("--captureWaitMs") ? Number(args[args.indexOf("--captureWaitMs") + 1]) : 90000;
const globalTimeoutMs = args.includes("--globalTimeoutMs")
  ? Number(args[args.indexOf("--globalTimeoutMs") + 1])
  : 600000;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "auto";
const openWaitSec = args.includes("--openWaitSec") ? Number(args[args.indexOf("--openWaitSec") + 1]) : 5;
const periodicProbeEvery = args.includes("--periodicProbeEvery")
  ? Number(args[args.indexOf("--periodicProbeEvery") + 1])
  : 5;

mkdirSync(OUT_DIR, { recursive: true });

let compactTemplate = null;
function loadCompactTemplate() {
  if (compactTemplate) return compactTemplate;
  compactTemplate = readFileSync(PROMPT21, "utf8");
  return compactTemplate;
}

function buildPrompt(topic) {
  if (useFullTest2) {
    const template = readFileSync(TEST2, "utf8");
    return template.replace(/based on user "[^"]+"/i, `based on user "${topic}"`);
  }
  return loadCompactTemplate().replace(
    /Based on user query: "[^"]+"/i,
    `Based on user query: "${topic}"`,
  );
}

function runOnTab(tabRef, argv, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv, "--tab", String(tabRef), "--json"];
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
}

function runGlobal(argv, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv, "--json"];
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
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
      return parsed.success
        ? parsed.data
        : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, action: parsed.action };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 800) };
  }
}

function unwrapCliData(stdout) {
  const parsed = parseJson(stdout);
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    return parsed.success ? parsed.data : parsed;
  }
  return parsed;
}

function unwrapEval(data) {
  if (data?.result && typeof data.result === "object") return data.result;
  return data;
}

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
    answerPreview:String(ans||'').slice(0,400),
    answerFull:ans,
    conversationId:h.getConversationId()
  };
})()`;

function tryParseNewsJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function isValidNewsCapture(topic, chatData, probe, capture) {
  const parsed =
    chatData?.answerJson ||
    tryParseNewsJson(chatData?.answer) ||
    tryParseNewsJson(capture?.answer) ||
    tryParseNewsJson(probe?.answerFull);
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "missing_json" };
  if (!Array.isArray(parsed.unique_topics) || parsed.unique_topics.length === 0) {
    return { ok: false, reason: "empty_unique_topics" };
  }
  const query = String(parsed.query || "").toLowerCase();
  const topicKey = topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 24);
  const topicTokens = topicKey.split(/\s+/).filter((t) => t.length > 3);
  const topicHit = topicTokens.some((tok) => query.includes(tok));
  if (!topicHit) return { ok: false, reason: "query_mismatch", parsedQuery: parsed.query };
  return { ok: true, parsed };
}

function resolveCapturedAnswer(chatData, probe) {
  if (chatData?.answerJson && chatData?.answer) {
    return { answer: String(chatData.answer), recovered: false, source: "chat", answerJson: chatData.answerJson };
  }
  if (chatData?.answer && String(chatData.answer).trim()) {
    const parsed = tryParseNewsJson(chatData.answer);
    if (parsed) {
      return {
        answer: JSON.stringify(parsed),
        recovered: false,
        source: "chat",
        answerJson: parsed,
      };
    }
    return { answer: String(chatData.answer), recovered: false, source: "chat", answerJson: null };
  }
  const probeAnswer = probe?.answerFull || probe?.answerPreview;
  const probeParsed = tryParseNewsJson(probeAnswer);
  if (
    probeParsed &&
    probe.hasCompletedReplyActions &&
    !probe.isGenerating &&
    !probe.isChatInProgress
  ) {
    return {
      answer: JSON.stringify(probeParsed),
      recovered: true,
      source: "probe",
      answerJson: probeParsed,
    };
  }
  if (probeAnswer && probe.hasCompletedReplyActions && !probe.isGenerating && !probe.isChatInProgress) {
    return { answer: String(probeAnswer), recovered: true, source: "probe", answerJson: probeParsed };
  }
  return { answer: "", recovered: false, source: null, answerJson: null };
}

function listTabs() {
  const data = parseJson(runGlobal(["tab", "list"], 30000).stdout);
  return data?.tabs || [];
}

function findTabEntry(tabs, tabState) {
  return (
    tabs.find((t) => t.tabId === tabState.tabId) ||
    tabs.find((t) => t.tab === tabState.shortId) ||
    tabs.find((t) => String(t.tab) === String(tabState.shortId))
  );
}

function getTabEntry(tabRef) {
  const tabs = listTabs();
  return (
    tabs.find((t) => t.tab === tabRef) ||
    tabs.find((t) => t.tabId === tabRef) ||
    tabs.find((t) => String(t.tab) === String(tabRef))
  );
}

function getTabHref(tabRef) {
  const entry = getTabEntry(tabRef);
  if (entry?.url) return entry.url;
  const data = unwrapEval(parseJson(runOnTab(tabRef, ["eval", "location.href"], 15000).stdout));
  return typeof data === "string" ? data : "";
}

function waitForNotionLanding(tabRef, maxSec = 30) {
  for (let i = 0; i < maxSec; i++) {
    const href = getTabHref(tabRef);
    if (href.includes("app.notion.com") && !href.includes("about:blank")) {
      return href;
    }
    if (i === 3 || i === 10 || i === 18) {
      runOnTab(tabRef, ["open", AI_URL], 60000);
    }
    spawnSync("sleep", ["1"]);
  }
  return getTabHref(tabRef);
}

function openNotionTabSimple(label) {
  const opened = unwrapCliData(runGlobal(["tab", "new", AI_URL], 60000).stdout);
  const tabId = opened?.tabId || opened?.id;
  const shortId = opened?.tab || String(tabId || "").slice(-4).toLowerCase();
  if (!tabId && !shortId) throw new Error("tab new did not return tabId");
  const href = waitForNotionLanding(shortId);
  if (!href.includes("app.notion.com")) {
    throw new Error(`tab ${label} did not load Notion (${href || "empty"})`);
  }
  if (openWaitSec > 0) spawnSync("sleep", [String(openWaitSec)]);
  runOnTab(shortId, ["site", "notion/chat", "--selectOnly", "true", "--model", model], 90000);
  spawnSync("sleep", ["2"]);
  const tabs = listTabs();
  const entry = getTabEntry(shortId) || tabs.find((t) => t.tabId === tabId);
  return {
    tabId: tabId || entry?.tabId,
    shortId: shortId || entry?.tab,
    baselineTitle: entry?.title || opened?.title || "",
    url: entry?.url || AI_URL,
    label,
  };
}

function selectTab(shortId) {
  return parseJson(runGlobal(["tab", "select", "--id", String(shortId)], 30000).stdout);
}

function probeTabBusy(tabRef) {
  return parseJson(runOnTab(tabRef, ["site", "notion/tab-probe"], 30000).stdout);
}

function evalCaptureProbe(tabRef) {
  return unwrapEval(parseJson(runOnTab(tabRef, ["eval", captureProbeJs], 30000).stdout));
}

function isReplyComplete(tabProbe, captureProbe) {
  if (captureProbe?.isGenerating || captureProbe?.isChatInProgress) return false;
  if (!captureProbe?.hasCompletedReplyActions) return false;
  if (tabProbe?.busy && captureProbe?.helpersVersion) {
    // Prefer helper signals when loaded; tab-probe heuristics can lag.
  } else if (tabProbe?.busy) {
    return false;
  }
  return !!tryParseNewsJson(captureProbe?.answerFull);
}

function submitViaEval(tabRef, prompt) {
  const submitJs = `(async function(){
    var h=globalThis.__notionAiChatHelpers;
    if(!h)return{error:'helpers not loaded'};
    await h.ensureNewChatView();
    await h.sleep(600);
    for (var i = 0; i < 4 && h.getAssistantMessagesSinceLastUser().length > 0; i++) {
      await h.clickNewChat();
      await h.sleep(700);
    }
    var mode=await h.setNotionMode(${JSON.stringify(model)});
    if(!mode.ok)return{error:mode.error||'mode failed',hint:mode.hint};
    var beforeCount=h.getAssistantMessagesSinceLastUser().length;
    var beforeText=h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\\n');
    var submit=await h.submitChatPrompt(${JSON.stringify(prompt)}, beforeCount, beforeText, { maxWaitMs: ${submitWaitMs}, stableNeeded: 2, queryExpectsJson: true, query: ${JSON.stringify(prompt)} });
    if(!submit.ok)return submit;
    return {
      ok: true,
      submitted: true,
      stillGenerating: h.isChatInProgress() || h.isGenerating(),
      conversationId: h.getConversationId(),
      title: document.title,
      beforeCount: beforeCount
    };
  })()`;
  const t0 = Date.now();
  const data = unwrapEval(parseJson(runOnTab(tabRef, ["eval", submitJs], submitWaitMs + 90000).stdout));
  return { data, elapsedMs: Date.now() - t0, via: "eval" };
}

function submitPrompt(tabRef, prompt) {
  const t0 = Date.now();
  const evalSubmit = submitViaEval(tabRef, prompt);
  if (evalSubmit.data?.ok || evalSubmit.data?.stillGenerating || evalSubmit.data?.submitted) {
    return {
      chatRun: { timedOut: false, status: 0 },
      chatData: evalSubmit.data,
      elapsedMs: Date.now() - t0,
      via: "eval",
    };
  }

  let chatRun = runOnTab(
    tabRef,
    ["site", "notion/chat", prompt, "--model", model, "--newChat", "true", "--maxWaitMs", String(submitWaitMs)],
    submitWaitMs + 60000,
  );
  let chatData = parseJson(chatRun.stdout);
  return { chatRun, chatData, elapsedMs: Date.now() - t0, via: "chat" };
}

function captureWaitOnly(tabRef) {
  const t0 = Date.now();
  const chatRun = runOnTab(
    tabRef,
    ["site", "notion/chat", "x", model, "true", "false", "true", "--maxWaitMs", String(captureWaitMs)],
    captureWaitMs + 60000,
  );
  const chatData = parseJson(chatRun.stdout);
  return { chatRun, chatData, elapsedMs: Date.now() - t0 };
}

function inspectTab(tabState, reason) {
  const event = {
    at: new Date().toISOString(),
    tab: tabState.shortId,
    topic: tabState.topic,
    reason,
    title: tabState.lastTitle,
  };

  selectTab(tabState.shortId);
  event.activated = true;

  const tabProbe = probeTabBusy(tabState.shortId);
  const captureProbe = evalCaptureProbe(tabState.shortId);
  event.tabProbe = tabProbe;
  event.captureProbe = {
    helpersVersion: captureProbe?.helpersVersion,
    tabHidden: captureProbe?.tabHidden,
    hasCompletedReplyActions: captureProbe?.hasCompletedReplyActions,
    isGenerating: captureProbe?.isGenerating,
    isChatInProgress: captureProbe?.isChatInProgress,
    answerLen: captureProbe?.answerLen,
    looksFinal: captureProbe?.looksFinal,
    conversationId: captureProbe?.conversationId,
  };

  if (captureProbe?.conversationId && !tabState.conversationId) {
    tabState.conversationId = captureProbe.conversationId;
  }

  if (!isReplyComplete(tabProbe, captureProbe)) {
    event.result = "still_generating";
    tabState.events.push(event);
    return event;
  }

  const wait = captureWaitOnly(tabState.shortId);
  const probeAfter = evalCaptureProbe(tabState.shortId);
  const capture = resolveCapturedAnswer(wait.chatData, probeAfter);
  const validation = isValidNewsCapture(tabState.topic, wait.chatData, probeAfter, capture);

  event.result = validation.ok ? "captured" : "capture_invalid";
  event.captureElapsedMs = wait.elapsedMs;
  event.captureSource = capture.source;
  event.validation = validation;
  tabState.events.push(event);

  if (validation.ok) {
    tabState.status = "captured";
    tabState.capturedAt = event.at;
    tabState.capturedAnswer = capture.answer;
    tabState.answerJson = validation.parsed;
    tabState.captureSource = capture.source;
    tabState.validation = validation;
    tabState.pass = true;
  }

  return event;
}

function buildResponsesTxt(summary) {
  const lines = [
    "# dual-tab title-watch responses",
    `Started: ${summary.startedAt}`,
    `Finished: ${summary.finishedAt}`,
    `Template: ${summary.promptTemplate}`,
    `Passed: ${summary.passCount}/${summary.tabs.length}`,
    "",
  ];
  for (const tab of summary.tabs) {
    lines.push("=".repeat(80));
    lines.push(`Tab ${tab.label} (${tab.shortId})`);
    lines.push(`Topic: ${tab.topic}`);
    lines.push(`Baseline title: ${tab.baselineTitle || "(empty)"}`);
    lines.push(`Final title: ${tab.lastTitle || "(empty)"}`);
    lines.push(
      `Status: ${tab.pass ? "PASS" : "FAIL"} | status=${tab.status} | source=${tab.captureSource || "none"}${tab.validation?.ok ? "" : tab.validation ? ` | why=${tab.validation.reason}` : ""}`,
    );
    if (tab.titleChanges?.length) {
      lines.push(`Title changes: ${tab.titleChanges.map((e) => `"${e.from}" -> "${e.to}" @ ${e.at}`).join("; ")}`);
    }
    lines.push("-".repeat(80));
    const answer =
      tab.capturedAnswer ||
      (tab.answerJson ? JSON.stringify(tab.answerJson) : "") ||
      "(no answer)";
    lines.push(answer);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const results = {
  startedAt: new Date().toISOString(),
  promptTemplate: useFullTest2 ? "grok/example/test2.txt" : "notion/example/prompt21.txt (compact)",
  model,
  pollMs,
  submitWaitMs,
  captureWaitMs,
  globalTimeoutMs,
  periodicProbeEvery,
  titleEvents: [],
  tabs: [],
};

console.log(
  `Dual-tab title-watch: topics=${TOPICS.length}, pollMs=${pollMs}, submitWaitMs=${submitWaitMs}, template=${useFullTest2 ? "full test2" : "compact prompt21"}\n`,
);

const tabStates = TOPICS.map((topic, i) => {
  const label = String.fromCharCode(65 + i);
  console.log(`Opening tab ${label}...`);
  const opened = openNotionTabSimple(label);
  const tabsAfter = listTabs();
  const entry = findTabEntry(tabsAfter, opened);
  const state = {
    label,
    topic,
    prompt: buildPrompt(topic),
    tabId: opened.tabId,
    shortId: opened.shortId,
    baselineTitle: entry?.title || opened.baselineTitle || "",
    postSubmitTitle: null,
    lastTitle: entry?.title || opened.baselineTitle || "",
    titleChanges: [],
    titleChangedAt: null,
    status: "pending",
    conversationId: null,
    submit: null,
    capturedAt: null,
    capturedAnswer: null,
    answerJson: null,
    captureSource: null,
    validation: null,
    pass: false,
    events: [],
  };
  writeFileSync(join(OUT_DIR, `tab-${label.toLowerCase()}-prompt.txt`), state.prompt);
  console.log(`  tab ${label}: id=${state.shortId} title="${state.baselineTitle}"`);
  return state;
});

console.log("\n--- Submit phase ---");
for (const tabState of tabStates) {
  console.log(`Submit tab ${tabState.label}: ${tabState.topic.slice(0, 50)}...`);
  const submit = submitPrompt(tabState.shortId, tabState.prompt);
  tabState.submit = {
    elapsedMs: submit.elapsedMs,
    timedOut: submit.chatRun.timedOut,
    via: submit.via,
    error: submit.chatData?.error || null,
    kind: submit.chatData?.kind || null,
    conversationId: submit.chatData?.conversationId || null,
    stillGenerating: submit.chatData?.stillGenerating || submit.chatData?.error === "Still generating",
    hasAnswer: !!submit.chatData?.answer,
  };
  if (submit.chatData?.conversationId) {
    tabState.conversationId = submit.chatData.conversationId;
  }
  if (submit.chatData?.answer && submit.chatData?.answerJson) {
    const validation = isValidNewsCapture(tabState.topic, submit.chatData, null, { answer: submit.chatData.answer });
    if (validation.ok) {
      tabState.status = "captured";
      tabState.capturedAt = new Date().toISOString();
      tabState.capturedAnswer = submit.chatData.answer;
      tabState.answerJson = validation.parsed;
      tabState.captureSource = "submit";
      tabState.validation = validation;
      tabState.pass = true;
    }
  }
  const tabsAfterSubmit = listTabs();
  const entry = findTabEntry(tabsAfterSubmit, tabState);
  if (entry?.title) {
    tabState.postSubmitTitle = entry.title;
    if (entry.title !== tabState.lastTitle) {
      tabState.titleChanges.push({
        at: new Date().toISOString(),
        from: tabState.lastTitle,
        to: entry.title,
        phase: "submit",
      });
      tabState.lastTitle = entry.title;
      tabState.titleChangedAt = new Date().toISOString();
    }
  }
  console.log(
    `  ${tabState.status === "captured" ? "CAPTURED (fast)" : "submitted"} | via=${tabState.submit.via} | ${Math.round(submit.elapsedMs / 1000)}s | error=${tabState.submit.error || "none"} | generating=${tabState.submit.stillGenerating ? "yes" : "no"} | title="${tabState.lastTitle}"`,
  );
}

const watchStart = Date.now();
let pollRound = 0;

console.log("\n--- Title-watch phase ---");
while (Date.now() - watchStart < globalTimeoutMs) {
  const pending = tabStates.filter((t) => t.status === "pending");
  if (pending.length === 0) break;

  pollRound++;
  const tabs = listTabs();
  const periodicProbe = pollRound % periodicProbeEvery === 0;

  for (const tabState of pending) {
    const entry = findTabEntry(tabs, tabState);
    if (!entry) {
      console.log(`  poll ${pollRound}: tab ${tabState.label} missing from tab list`);
      continue;
    }

    const title = entry.title || "";
    if (title !== tabState.lastTitle) {
      const change = {
        at: new Date().toISOString(),
        from: tabState.lastTitle,
        to: title,
        phase: "watch",
        pollRound,
      };
      tabState.titleChanges.push(change);
      tabState.titleChangedAt = change.at;
      results.titleEvents.push({ tab: tabState.label, shortId: tabState.shortId, ...change });
      console.log(
        `  poll ${pollRound}: tab ${tabState.label} title changed "${tabState.lastTitle}" -> "${title}"`,
      );
      tabState.lastTitle = title;

      const event = inspectTab(tabState, "title_changed");
      if (tabState.status === "captured") {
        console.log(
          `  tab ${tabState.label} CAPTURED via title-watch | source=${tabState.captureSource} | topics=${tabState.answerJson?.unique_topics?.length || 0}`,
        );
      } else {
        console.log(`  tab ${tabState.label} inspected (${event.result})`);
      }
      continue;
    }

    if (periodicProbe) {
      console.log(`  poll ${pollRound}: periodic probe tab ${tabState.label} title="${title}"`);
      const event = inspectTab(tabState, "periodic_probe");
      if (tabState.status === "captured") {
        console.log(
          `  tab ${tabState.label} CAPTURED via periodic probe | source=${tabState.captureSource} | topics=${tabState.answerJson?.unique_topics?.length || 0}`,
        );
      } else {
        console.log(`  tab ${tabState.label} inspected (${event.result})`);
      }
    }
  }

  if (tabStates.every((t) => t.status === "captured")) break;
  spawnSync("sleep", [String(Math.ceil(pollMs / 1000))]);
}

for (const tabState of tabStates) {
  if (tabState.status === "pending") {
    tabState.status = "failed";
    tabState.validation = tabState.validation || { ok: false, reason: "timeout" };
    tabState.pass = false;
  }
}

results.finishedAt = new Date().toISOString();
results.pollRounds = pollRound;
results.elapsedMs = Date.now() - new Date(results.startedAt).getTime();
results.tabs = tabStates.map((t) => ({
  label: t.label,
  topic: t.topic,
  tabId: t.tabId,
  shortId: t.shortId,
  baselineTitle: t.baselineTitle,
  postSubmitTitle: t.postSubmitTitle,
  lastTitle: t.lastTitle,
  titleChanges: t.titleChanges,
  titleChangedAt: t.titleChangedAt,
  status: t.status,
  conversationId: t.conversationId,
  submit: t.submit,
  capturedAt: t.capturedAt,
  capturedAnswer: t.capturedAnswer,
  answerJson: t.answerJson,
  captureSource: t.captureSource,
  validation: t.validation,
  pass: t.pass,
  events: t.events,
}));
results.passCount = results.tabs.filter((t) => t.pass).length;

writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
writeFileSync(join(OUT_DIR, "responses.txt"), buildResponsesTxt(results));

console.log("\n=== Summary ===");
console.log(`Passed: ${results.passCount}/${results.tabs.length}`);
console.log(`Poll rounds: ${pollRound}`);
console.log(`Title events: ${results.titleEvents.length}`);
console.log(`Results: ${join(OUT_DIR, "summary.json")}`);
console.log(`Responses: ${join(OUT_DIR, "responses.txt")}`);
process.exit(results.passCount === results.tabs.length ? 0 : 1);
