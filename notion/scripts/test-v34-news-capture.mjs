#!/usr/bin/env bun
/**
 * Test v34 submit retry + capture on 3 news-style prompts (grok/example/test2.txt template).
 *
 * Usage:
 *   bun notion/scripts/test-v34-news-capture.mjs
 *   bun notion/scripts/test-v34-news-capture.mjs --maxWaitMs 120000
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const TEST2 = join(ROOT, "grok/example/test2.txt");
const OUT_DIR = join(ROOT, "notion/example/v34-news-capture-runs");

const TOPICS = [
  "Protesters block road to Mexican World Cup stadium",
  "Fed interest rate decision June 2026",
  "Apple WWDC announcements 2026",
];

const args = process.argv.slice(2);
let activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
let conversationId = args.includes("--conversation") ? args[args.indexOf("--conversation") + 1] : null;
const startRun = args.includes("--startRun") ? Number(args[args.indexOf("--startRun") + 1]) : 1;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 120000;
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 3000;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "auto";
const spawnTimeoutMs = maxWaitMs + 120000;

mkdirSync(OUT_DIR, { recursive: true });

function buildPrompt(topic) {
  const template = readFileSync(TEST2, "utf8");
  return template.replace(/based on user "[^"]+"/i, `based on user "${topic}"`);
}

function run(argv, timeoutMs = spawnTimeoutMs) {
  const full = ["bun", CLI, ...argv];
  if (activeTab != null) full.push("--tab", activeTab);
  full.push("--json");
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
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, action: parsed.action };
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

const captureProbeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var msgs=h.getAssistantMessagesSinceLastUser();
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';
  return{
    helpersVersion:h.version,
    tabHidden:document.hidden,
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

function runPrompt(prompt, conversationId, command) {
  const t0 = Date.now();
  let argv;
  if (command === "chat") {
    argv = ["site", "notion/chat", prompt, "--model", model, "--newChat", "true", "--maxWaitMs", String(maxWaitMs)];
  } else if (command === "waitOnly") {
    argv = [
      "site",
      "notion/chatfollow",
      conversationId,
      prompt,
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
      prompt,
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

const plan = TOPICS.map((topic, i) => ({
  run: i + 1,
  topic,
  prompt: buildPrompt(topic),
}));

const results = {
  startedAt: new Date().toISOString(),
  helpersTarget: 35,
  maxWaitMs,
  spawnTimeoutMs,
  model,
  tab: activeTab,
  promptTemplate: "grok/example/test2.txt",
  runs: [],
};

console.log(`v34 news capture test: ${plan.length} prompts, maxWaitMs=${maxWaitMs}, startRun=${startRun}\n`);

if (!activeTab) {
  const opened = parseJson(run(["open", "https://app.notion.com/ai"], 60000).stdout);
  activeTab = opened?.tabId || opened?.id;
  results.tab = activeTab;
  console.log(`Opened tab: ${activeTab}`);
  spawnSync("sleep", ["10"]);
}

for (const item of plan.filter((p) => p.run >= startRun)) {
  console.log(`\n--- Run ${item.run}/${plan.length} ---`);
  console.log(`  topic: ${item.topic}`);

  writeFileSync(join(OUT_DIR, `run-${String(item.run).padStart(2, "0")}-prompt.txt`), item.prompt);

  const command = item.run === 1 && !conversationId ? "chat" : "chatfollow";
  let { chatRun, chatData, elapsedMs } = runPrompt(item.prompt, conversationId, command);
  let usedCommand = command;

  if (item.run === 1 && chatData?.conversationId) {
    conversationId = chatData.conversationId;
  }

  if (chatData?.error === "Still generating" && chatData?.action?.includes("waitOnly") && conversationId) {
    console.log("  retry: waitOnly");
    const retry = runPrompt(item.prompt, conversationId, "waitOnly");
    chatRun = retry.chatRun;
    chatData = retry.chatData;
    elapsedMs += retry.elapsedMs;
    usedCommand = "waitOnly";
  }

  if (chatData?.kind === "chat_in_progress" && conversationId) {
    console.log("  retry: waitOnly (tab busy)");
    const retry = runPrompt(item.prompt, conversationId, "waitOnly");
    chatRun = retry.chatRun;
    chatData = retry.chatData;
    elapsedMs += retry.elapsedMs;
    usedCommand = "waitOnly";
  }

  const probe = unwrapEval(parseJson(run(["eval", captureProbeJs], 30000).stdout));
  if (chatData?.conversationId) conversationId = chatData.conversationId;
  if (!conversationId && probe?.conversationId) conversationId = probe.conversationId;

  const capture = resolveCapturedAnswer(chatData, probe);
  const validation = isValidNewsCapture(item.topic, chatData, probe, capture);
  const entry = {
    run: item.run,
    topic: item.topic,
    command: usedCommand,
    elapsedMs,
    timedOut: chatRun.timedOut,
    chatError: chatData?.error || null,
    chatKind: chatData?.kind || null,
    chatAction: chatData?.action || null,
    answerFormat: chatData?.answerFormat || null,
    answerJson: chatData?.answerJson || null,
    capturedAnswer: capture.answer || null,
    captureSource: capture.source,
    recovered: capture.recovered,
    answerJson: capture.answerJson || chatData?.answerJson || null,
    validation,
    helpersVersion: probe?.helpersVersion || null,
    probe,
    pass: validation.ok,
    directCapture: validation.ok && capture.source === "chat" && !chatRun.timedOut,
  };

  results.runs.push(entry);
  writeFileSync(join(OUT_DIR, `run-${String(item.run).padStart(2, "0")}.json`), JSON.stringify(entry, null, 2));

  console.log(
    `  ${entry.pass ? "PASS" : "FAIL"} | src=${entry.captureSource || "none"} | ${Math.round(entry.elapsedMs / 1000)}s | error=${entry.chatError || "none"} | kind=${entry.chatKind || "none"} | topics=${entry.answerJson?.unique_topics?.length || 0}${entry.validation.ok ? "" : ` | why=${entry.validation.reason}`}`,
  );
  if (entry.chatKind === "silent_submit") console.log(`  note: silent submit — v34 should have retried submit`);
  if (entry.timedOut) console.log(`  note: spawn timed out`);

  if (item.run < plan.length) spawnSync("sleep", [String(Math.ceil(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
results.passCount = results.runs.filter((r) => r.pass).length;
results.directCaptureCount = results.runs.filter((r) => r.directCapture).length;
results.conversationId = conversationId;
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log("\n=== Summary ===");
console.log(`Passed: ${results.passCount}/${results.runs.length}`);
console.log(`Direct capture: ${results.directCaptureCount}/${results.runs.length}`);
console.log(`Results: ${join(OUT_DIR, "summary.json")}`);
process.exit(results.passCount === results.runs.length ? 0 : 1);
