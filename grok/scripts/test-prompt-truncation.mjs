#!/usr/bin/env bun
/**
 * Batch probe for Grok prompt truncation (composer input + optional answer completeness).
 *
 * Usage:
 *   bun grok/scripts/test-prompt-truncation.mjs --runs 100 --tab d77a
 *   bun grok/scripts/test-prompt-truncation.mjs --runs 100 --tab d77a --e2e 15
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO = join(ROOT, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const HELPERS = readFileSync(join(ROOT, "chat-helpers.js"), "utf8");
const PROMPT21 = join(REPO, "notion/example/prompt21.txt");
const OUT_DIR = join(ROOT, "example/truncation-runs");

const MODELS = ["fast", "auto", "expert", "heavy", "beta"];

const SHORT = [
  'Reply ONLY valid JSON: {"status":"ok","n":1}. No markdown.',
  "What is 17+25? Reply with just the number.",
  'Return JSON only: {"color":"blue","count":3}',
  "Name one planet. One word only.",
  'JSON only: {"topic":"AI regulation","score":7}',
  "List two primes under 20. Comma separated.",
  'Return only JSON: {"hello":"world"}',
  "Capital of Japan? One word.",
  'JSON only: {"items":["a","b","c"]}',
  "Is water wet? yes or no only.",
];

function pad(len, ch = "x") {
  return ch.repeat(Math.max(0, len));
}

function buildLongPrompt(run, marker) {
  const head = `RUN_${run}_HEAD_${marker}_ `;
  const tail = ` _TAIL_${run}_${marker}`;
  const bodyLen = 800 + (run % 5) * 1200;
  return (
    head +
    pad(bodyLen) +
    tail +
    '\nRespond ONLY with JSON: {"run":' +
    run +
    ',"marker":"' +
    marker +
    '","body_len":' +
    bodyLen +
    '}. No markdown.'
  );
}

function buildNewsJson(run) {
  const topics = [
    "SpaceX IPO",
    "Fed rate decision",
    "Apple WWDC",
    "Ethereum ETF",
    "OpenAI release",
    "NVIDIA export rules",
    "Bitcoin ETF flows",
    "Tesla robotaxi",
  ];
  const t = topics[run % topics.length];
  return (
    `You are a news assistant. Return JSON only; no markdown.\n` +
    `Query: "${t}" — find 2 unique topics from reuters.com or bbc.com for 2026-06-09 to 2026-06-15.\n` +
    `Schema: {"query":"...","time_period":"2026-06-10T14:30:00Z","unique_topics":["..."],"sources":"..."}\n` +
    `Include marker field "run_marker":"R${run}". JSON only.`
  );
}

function buildStructuralJson(run) {
  return (
    `Return ONLY valid JSON matching this schema exactly (fill all arrays with 3 items):\n` +
    `{"meta":{"run":${run},"version":1},"entities":[{"id":"e1","name":"Alpha","tags":["a","b"]},{"id":"e2","name":"Beta","tags":["c"]},{"id":"e3","name":"Gamma","tags":[]}],"relations":[{"from":"e1","to":"e2","type":"links"},{"from":"e2","to":"e3","type":"follows"},{"from":"e1","to":"e3","type":"refs"}],"summary":"three entity graph"}\n` +
    `Plain strings only. No markdown fences.`
  );
}

const args = process.argv.slice(2);
const totalRuns = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 100;
const e2eCount = args.includes("--e2e") ? Number(args[args.indexOf("--e2e") + 1]) : 15;
const tab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : "d77a";
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 400;
const e2eWaitMs = args.includes("--e2eWaitMs") ? Number(args[args.indexOf("--e2eWaitMs") + 1]) : 90000;

mkdirSync(OUT_DIR, { recursive: true });

function runTab(argv, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv, "--tab", tab, "--json"];
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
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, ...parsed };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 800) };
  }
}

function unwrapEval(data) {
  if (!data) return null;
  if (data.result && typeof data.result === "object") return data.result;
  if (typeof data.result === "string") {
    try {
      return JSON.parse(data.result);
    } catch {
      return { raw: data.result };
    }
  }
  return data;
}

function buildPlan(total) {
  let prompt21 = null;
  try {
    prompt21 = readFileSync(PROMPT21, "utf8");
  } catch {}

  const plan = [];
  for (let i = 0; i < total; i++) {
    const run = i + 1;
    const model = MODELS[i % MODELS.length];
    const command = i % 3 === 0 ? "chatfollow" : "chat";
    let kind;
    let prompt;
    const marker = `M${String(run).padStart(3, "0")}`;

    if (i === 0 && prompt21) {
      kind = "prompt21-full";
      prompt = prompt21;
    } else if (i % 11 === 0) {
      kind = "structural-json";
      prompt = buildStructuralJson(run);
    } else if (i % 7 === 0) {
      kind = "news-json";
      prompt = buildNewsJson(run);
    } else if (i % 5 === 0) {
      kind = "long-json";
      prompt = buildLongPrompt(run, marker);
    } else {
      kind = "short";
      prompt = SHORT[i % SHORT.length].replace('"n":1', `"n":${run}`);
    }

    plan.push({ run, model, command, kind, prompt, marker, e2e: i < e2eCount });
  }
  return plan;
}

function inputProbeScript(prompt) {
  return `(async function() {
${HELPERS}
  var h = installGrokChatHelpers();
  var PROMPT = ${JSON.stringify(prompt)};
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  async function waitForComposer(maxMs) {
    var deadline = Date.now() + (maxMs || 10000);
    while (Date.now() < deadline) {
      if (h.getChatInput()) return true;
      await sleep(250);
    }
    return false;
  }
  if (!await waitForComposer(8000)) {
    return { ok: false, phase: 'composer', error: 'chat input missing', url: location.href };
  }
  var fill = await h.fillChatInput(PROMPT);
  return {
    ok: !!fill.ok,
    phase: 'input',
    setOk: !!fill.ok,
    inputCheck: fill.inputCheck,
    attempts: fill.attempts,
    url: location.href
  };
})()`;
}

function preparePage(command, conversationId) {
  if (command === "chatfollow" && conversationId) {
    runTab(["open", `https://grok.com/c/${conversationId}`], 30000);
    spawnSync("sleep", ["2"]);
    return;
  }
  runTab(["open", "https://grok.com/"], 30000);
  spawnSync("sleep", ["1.5"]);
}

function classifyInput(probe) {
  if (!probe) return "probe_error";
  if (probe.phase && probe.phase !== "input") return `phase:${probe.phase}`;
  if (probe.ok) return "input_ok";
  if (probe.inputCheck?.kind === "truncated") return "input_truncated";
  if (probe.inputCheck?.kind === "mismatch") return "input_mismatch";
  if (!probe.setOk) return "set_failed";
  return "input_other";
}

function runSiteWithRetry(argv, timeoutMs, maxAttempts = 3) {
  let lastRun = null;
  let lastData = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastRun = runTab(argv, timeoutMs);
    lastData = parseJson(lastRun.stdout);
    const retry =
      lastData?.needsRetry ||
      lastData?.action === "retry same command" ||
      lastData?.error === "Mode change requires page reload" ||
      lastData?.error === "Navigation required";
    if (!retry) break;
    spawnSync("sleep", ["2.5"]);
  }
  return { chatRun: lastRun, chatData: lastData };
}

function classifyAnswer(data, marker, kind) {
  if (!data || data.error) {
    if (data?.kind === "input_truncated") return "input_truncated_at_submit";
    if (data?.error === "Still generating") return "still_generating";
    return `error:${data?.error || "unknown"}`;
  }
  const answer = String(data.answer || "");
  if (!answer) return "empty_answer";
  if (kind.includes("json") || kind === "short") {
    if (data.answerJson) {
      if (kind === "long-json" && data.answerJson.marker !== marker) return "answer_marker_missing";
      if (kind === "structural-json" && (!data.answerJson.meta || !data.answerJson.entities || data.answerJson.entities.length < 3)) {
        return "answer_json_incomplete";
      }
      return "answer_json_ok";
    }
    try {
      const block = answer.match(/\{[\s\S]*\}/);
      if (block) {
        JSON.parse(block[0]);
        return "answer_json_recovered";
      }
    } catch {
      return "answer_json_invalid";
    }
    return "answer_no_json";
  }
  if (answer.length < 2) return "answer_too_short";
  return "answer_ok";
}

const plan = buildPlan(totalRuns);
const results = {
  startedAt: new Date().toISOString(),
  totalRuns,
  e2eCount,
  tab,
  runs: [],
};

console.log(`Grok truncation probe: ${plan.length} input checks, up to ${e2eCount} e2e (tab ${tab})\n`);

const convProbe = unwrapEval(parseJson(runTab(["eval", "(function(){var m=location.pathname.match(/\\/c\\/([^/?]+)/); return {conversationId:m?m[1]:null,url:location.href};})()"], 30000).stdout));
let conversationId = convProbe?.conversationId || null;
console.log(`Starting conversationId: ${conversationId || "(none)"}\n`);

for (const item of plan) {
  console.log(`--- Run ${item.run}/${plan.length} | ${item.model} | ${item.command} | ${item.kind} | len ${item.prompt.length} ---`);

  if (item.command === "chatfollow" && !conversationId) {
    const seed = runTab(
      ["site", "grok/chat", 'Reply ONLY JSON: {"seed":true}. No markdown.', "--model", "fast", "--maxWaitMs", "90000"],
      180000,
    );
    conversationId = parseJson(seed.stdout)?.conversationId || null;
    console.log(`  seeded conversation: ${conversationId || "none"}`);
    if (!conversationId) item.command = "chat";
  }

  preparePage(item.command, conversationId);

  const probeRun = runTab(["eval", inputProbeScript(item.prompt)], 120000);
  const probe = unwrapEval(parseJson(probeRun.stdout));
  const inputClass = classifyInput(probe);

  const entry = {
    run: item.run,
    kind: item.kind,
    model: item.model,
    command: item.command,
    promptLen: item.prompt.length,
    input: {
      classification: inputClass,
      setOk: probe?.setOk,
      expectedLen: probe?.inputCheck?.expectedLen,
      actualLen: probe?.inputCheck?.actualLen,
      kind: probe?.inputCheck?.kind,
      timedOut: probeRun.timedOut,
      stderr: probeRun.stderr || undefined,
    },
    e2e: null,
  };

  if (item.e2e && inputClass === "input_ok") {
    const siteCmd =
      item.command === "chatfollow" && conversationId
        ? ["site", "grok/chatfollow", conversationId, item.prompt, "--model", item.model, "--maxWaitMs", String(e2eWaitMs)]
        : ["site", "grok/chat", item.prompt, "--model", item.model, "--newChat", "true", "--maxWaitMs", String(e2eWaitMs)];

    const { chatRun, chatData } = runSiteWithRetry(siteCmd, e2eWaitMs + 180000);
    if (chatData?.conversationId && item.command === "chat") conversationId = chatData.conversationId;
    entry.e2e = {
      classification: classifyAnswer(chatData, item.marker, item.kind),
      answerLen: chatData?.answer?.length || 0,
      hasAnswerJson: !!chatData?.answerJson,
      error: chatData?.error,
      kind: chatData?.kind,
      timedOut: chatRun.timedOut,
    };
    console.log(`  input: ${inputClass} | e2e: ${entry.e2e.classification}`);
  } else {
    console.log(`  input: ${inputClass}${probe?.inputCheck ? ` (${probe.inputCheck.actualLen}/${probe.inputCheck.expectedLen})` : ""}`);
  }

  results.runs.push(entry);
  writeFileSync(join(OUT_DIR, `run-${String(item.run).padStart(3, "0")}.json`), JSON.stringify(entry, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
  spawnSync("sleep", [String(Math.max(0.2, pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
const inputCounts = {};
const e2eCounts = {};
for (const r of results.runs) {
  inputCounts[r.input.classification] = (inputCounts[r.input.classification] || 0) + 1;
  if (r.e2e) e2eCounts[r.e2e.classification] = (e2eCounts[r.e2e.classification] || 0) + 1;
}
results.inputClassificationCounts = inputCounts;
results.e2eClassificationCounts = e2eCounts;
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log("\n=== Input classification ===");
for (const [k, v] of Object.entries(inputCounts)) console.log(`  ${k}: ${v}`);
if (Object.keys(e2eCounts).length) {
  console.log("\n=== E2E classification ===");
  for (const [k, v] of Object.entries(e2eCounts)) console.log(`  ${k}: ${v}`);
}
console.log(`\nResults: ${OUT_DIR}/summary.json`);
