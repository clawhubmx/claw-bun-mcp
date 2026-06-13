#!/usr/bin/env bun
/**
 * Run 5 JSON prompts with --model opus; report modelFallback and outcomes.
 *
 * Usage:
 *   bun notion/scripts/test-opus-json-fallback-5.mjs
 *   bun notion/scripts/test-opus-json-fallback-5.mjs --prompt p03-streaming-stress
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const PROBE_DIR = join(ROOT, "notion/example/incomplete-reply-probe");
const PROMPTS_META = join(PROBE_DIR, "prompts.json");
const OUT_DIR = join(ROOT, "notion/example/opus-fallback-runs");

const args = process.argv.slice(2);
const promptFilter = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : null;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 180000;
const stuckMs = args.includes("--modelFallbackStuckMs") ? Number(args[args.indexOf("--modelFallbackStuckMs") + 1]) : 5000;

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
let items = meta.prompts.map((p) => ({
  ...p,
  prompt: readFileSync(join(PROBE_DIR, p.file), "utf8").trim(),
  maxWaitMs: p.maxWaitMs || maxWaitMs,
}));
if (promptFilter) items = items.filter((p) => p.id === promptFilter);

function parseJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 500) };
  }
}

function run(argv, timeoutMs, tab) {
  const full = ["bun", CLI, ...argv, "--json"];
  if (tab) full.push("--tab", tab);
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  return { stdout: (result.stdout || "").trim(), timedOut: result.signal === "SIGTERM" };
}

function openTab() {
  const opened = run(["tab", "new", "https://app.notion.com/ai"], 60000);
  const data = parseJson(opened.stdout);
  const shortId = data?.tab || String(data?.tabId || "").slice(-4).toLowerCase();
  if (!shortId) throw new Error("tab new failed");
  for (let i = 0; i < 20; i++) {
    spawnSync("sleep", ["1"]);
    const health = run(["site", "notion/health"], 30000, shortId);
    if (parseJson(health.stdout)?.ok) break;
  }
  spawnSync("sleep", ["2"]);
  return shortId;
}

function runChat(prompt, tab, itemMaxWait) {
  const t0 = Date.now();
  const r = run(
    [
      "site",
      "notion/chat",
      prompt,
      "--model",
      "opus",
      "--newChat",
      "true",
      "--maxWaitMs",
      String(itemMaxWait),
      "--modelFallbackStuckMs",
      String(stuckMs),
    ],
    itemMaxWait + 120000,
    tab,
  );
  const data = parseJson(r.stdout);
  return {
    elapsedMs: Date.now() - t0,
    timedOut: r.timedOut,
    data,
  };
}

const status = run(["status"], 15000);
if (parseJson(status.stdout)?.running !== true) {
  console.error("bun-browser daemon not running");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];

console.log(`Opus JSON fallback test: ${items.length} prompts, stuckMs=${stuckMs}\n`);

for (const item of items) {
  const tab = openTab();
  console.log(`--- ${item.id} tab=${tab} ---`);
  const runResult = runChat(item.prompt, tab, Math.max(item.maxWaitMs, maxWaitMs));
  const d = runResult.data || {};
  const row = {
    id: item.id,
    tab,
    elapsedMs: runResult.elapsedMs,
    error: d.error || null,
    model: d.model || null,
    modeLabel: d.modeLabel || null,
    modelFallback: d.modelFallback || null,
    hasAnswerJson: !!d.answerJson,
    answerLen: d.answer ? String(d.answer).length : 0,
    answerPreview: d.answer ? String(d.answer).slice(0, 120) : null,
  };
  results.push(row);
  const fb = row.modelFallback
    ? `FALLBACK ${row.modelFallback.from}→${row.modelFallback.to}`
    : "no fallback";
  console.log(
    `  ${row.error || "ok"} | model=${row.modeLabel || "?"} | json=${row.hasAnswerJson} | len=${row.answerLen} | ${fb}`,
  );
  if (row.answerPreview) console.log(`  preview: ${row.answerPreview.replace(/\n/g, " ")}`);
  console.log("");
  spawnSync("sleep", ["2"]);
}

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  model: "opus",
  modelFallbackStuckMs: stuckMs,
  fallbackCount: results.filter((r) => r.modelFallback).length,
  jsonSuccessCount: results.filter((r) => r.hasAnswerJson).length,
  errorCount: results.filter((r) => r.error).length,
  results,
};

const outPath = join(OUT_DIR, `run-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log("=== Summary ===");
console.log(`  fallback triggered: ${summary.fallbackCount}/${results.length}`);
console.log(`  parseable JSON:   ${summary.jsonSuccessCount}/${results.length}`);
console.log(`  errors:           ${summary.errorCount}/${results.length}`);
console.log(`  report: ${outPath}`);
