#!/usr/bin/env bun
/**
 * Sequential live test: grok/chat with --newChat for each prompt.
 * Verifies reply capture stability and just-in-time wait timing.
 *
 * Usage:
 *   bun grok/scripts/test-new-chat-stability.mjs --tab 25fe
 *   bun grok/scripts/test-new-chat-stability.mjs --tab 25fe --maxWaitMs 120000
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO = join(ROOT, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT_DIR = join(ROOT, "example/new-chat-stability-runs");

const args = process.argv.slice(2);
const tab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : "25fe";
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 120000;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "fast";

function pad(len, ch = "x") {
  return ch.repeat(Math.max(0, len));
}

function buildLongJson(run) {
  const bodyLen = 1200 + run * 200;
  return (
    `RUN_${run}_HEAD ` +
    pad(bodyLen) +
    ` _TAIL_${run}\n` +
    `Respond ONLY with JSON: {"run":${run},"body_len":${bodyLen}}. No markdown.`
  );
}

function loadTest1() {
  try {
    return readFileSync(join(ROOT, "example/test1.txt"), "utf8");
  } catch {
    return null;
  }
}

const test1 = loadTest1();

const PROMPTS = [
  { kind: "short-json", prompt: 'Reply ONLY valid JSON: {"status":"ok","n":1}. No markdown.' },
  { kind: "short-math", prompt: "What is 17+25? Reply with just the number." },
  { kind: "short-word", prompt: "Capital of Japan? One word only." },
  {
    kind: "structural-json",
    prompt:
      'Return ONLY valid JSON: {"meta":{"run":4},"items":["alpha","beta","gamma"],"score":42}. No markdown fences.',
  },
  ...(test1 ? [{ kind: "test1-full", prompt: test1 }] : []),
  { kind: "long-json", prompt: buildLongJson(6) },
  { kind: "short-yesno", prompt: "Is water wet? Reply yes or no only." },
  { kind: "short-json", prompt: 'Return JSON only: {"color":"blue","count":3}' },
  { kind: "short-list", prompt: "List two primes under 20. Comma separated." },
  { kind: "medium-prose", prompt: "Explain photosynthesis in exactly two sentences." },
].slice(0, 10);

mkdirSync(OUT_DIR, { recursive: true });

function runTab(argv, timeoutMs) {
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

function classifyCapture(data, kind) {
  if (!data || data.error) {
    if (data?.error === "Still generating") return { status: "still_generating", error: data.error };
    if (data?.error === "Chat input not found") return { status: "chat_input_not_found", error: data.error };
    if (data?.kind === "input_truncated") return { status: "input_truncated", error: data.error };
    return { status: "error", error: data?.error || "unknown" };
  }
  const answer = String(data.answer || "");
  if (!answer) return { status: "empty_answer", error: "no answer text" };
  if (kind.includes("json") || kind === "short-json" || kind === "test1-full") {
    if (data.answerJson) return { status: "captured_json", answerLen: answer.length };
    const block = answer.match(/\{[\s\S]*\}/);
    if (block) {
      try {
        JSON.parse(block[0]);
        return { status: "captured_json_recovered", answerLen: answer.length };
      } catch {
        return { status: "json_invalid", answerLen: answer.length, error: "unparseable JSON" };
      }
    }
    if (kind === "test1-full") return { status: "captured_prose", answerLen: answer.length };
    return { status: "no_json", answerLen: answer.length };
  }
  return { status: "captured", answerLen: answer.length };
}

function runSiteWithRetry(argv, timeoutMs, maxAttempts = 2) {
  let lastRun = null;
  let lastData = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastRun = runTab(argv, timeoutMs);
    lastData = parseJson(lastRun.stdout);
    const retry =
      lastData?.needsRetry ||
      lastData?.action === "retry same command" ||
      lastData?.error === "Mode change requires page reload";
    if (!retry) break;
    spawnSync("sleep", ["2.5"]);
  }
  return { chatRun: lastRun, chatData: lastData };
}

const results = {
  startedAt: new Date().toISOString(),
  tab,
  model,
  maxWaitMs,
  runs: [],
};

console.log(`Grok new-chat stability: ${PROMPTS.length} sequential runs (tab ${tab}, model ${model})\n`);

for (let i = 0; i < PROMPTS.length; i++) {
  const item = PROMPTS[i];
  const runNum = i + 1;
  console.log(`--- Run ${runNum}/${PROMPTS.length} | ${item.kind} | len ${item.prompt.length} ---`);

  const t0 = Date.now();
  const siteCmd = [
    "site",
    "grok/chat",
    item.prompt,
    "--model",
    model,
    "--newChat",
    "true",
    "--maxWaitMs",
    String(maxWaitMs),
  ];
  const { chatRun, chatData } = runSiteWithRetry(siteCmd, maxWaitMs + 90000);
  const elapsedMs = Date.now() - t0;

  const capture = classifyCapture(chatData, item.kind);
  const ok = ["captured", "captured_json", "captured_json_recovered", "captured_prose"].includes(capture.status);

  const entry = {
    run: runNum,
    kind: item.kind,
    promptLen: item.prompt.length,
    elapsedMs,
    captureStatus: capture.status,
    ok,
    answerLen: capture.answerLen || chatData?.answer?.length || 0,
    hasAnswerJson: !!chatData?.answerJson,
    conversationId: chatData?.conversationId || null,
    error: capture.error || chatData?.error || null,
    hint: chatData?.hint || null,
    timedOut: chatRun.timedOut,
    stderr: chatRun.stderr || undefined,
  };

  results.runs.push(entry);
  writeFileSync(join(OUT_DIR, `run-${String(runNum).padStart(2, "0")}.json`), JSON.stringify(entry, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  console.log(
    `  wait: ${(elapsedMs / 1000).toFixed(1)}s | ${capture.status}${entry.error ? ` (${entry.error})` : ""} | answer ${entry.answerLen} chars`,
  );
}

results.finishedAt = new Date().toISOString();
const passCount = results.runs.filter((r) => r.ok).length;
results.passCount = passCount;
results.total = PROMPTS.length;
results.passRate = `${passCount}/${PROMPTS.length}`;
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

console.log(`\n=== Pass rate: ${passCount}/${PROMPTS.length} ===`);
for (const r of results.runs) {
  console.log(
    `  #${r.run} ${r.kind.padEnd(16)} len=${String(r.promptLen).padStart(5)} wait=${(r.elapsedMs / 1000).toFixed(1).padStart(6)}s ${r.ok ? "OK" : "FAIL"} ${r.captureStatus}`,
  );
}
console.log(`\nResults: ${OUT_DIR}/summary.json`);
