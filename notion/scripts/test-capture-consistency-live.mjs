#!/usr/bin/env bun
/**
 * Live capture consistency: repeat control prompts and log captureSource / answerFormat.
 *
 *   bun notion/scripts/test-capture-consistency-live.mjs --tab 5b52
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
const OUT_DIR = join(ROOT, "notion/example/capture-consistency-live/runs");

const args = process.argv.slice(2);
let tab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const freshTab = args.includes("--fresh-tab");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "auto";

if (!tab && !freshTab) {
  console.error("Usage: bun notion/scripts/test-capture-consistency-live.mjs --tab <shortId>");
  console.error("   or: bun notion/scripts/test-capture-consistency-live.mjs --fresh-tab");
  process.exit(1);
}

const PLAN = [
  { id: "json-control-1", file: "prompt-01-control-json.txt", expectJson: true, repeats: 3 },
  { id: "prose-token", file: "prompt-04-prose-token.txt", expectJson: false, repeats: 1 },
  { id: "json-preamble", file: "prompt-05-preamble-json.txt", expectJson: true, repeats: 1 },
];

function hash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 12);
}

function newTab() {
  const result = spawnSync("bun", [CLI, "tab", "new", "https://app.notion.com/ai", "--json"], {
    encoding: "utf8",
    timeout: 30000,
  });
  try {
    const outer = JSON.parse((result.stdout || "").trim());
    return outer?.data?.tab || null;
  } catch {
    return null;
  }
}

function parseCliJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind };
    }
    return parsed;
  } catch {
    return null;
  }
}

function runChat(prompt, tabId, maxWaitMs = 45000) {
  const full = [
    "bun",
    CLI,
    "site",
    "notion/chat",
    prompt,
    model,
    "true",
    "false",
    "false",
    "",
    String(maxWaitMs),
    "--tab",
    tabId,
    "--json",
  ];
  const t0 = Date.now();
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: maxWaitMs + 60000,
    maxBuffer: 20 * 1024 * 1024,
  });
  let data = parseCliJson(result.stdout || "");
  if (!data) {
    data = { error: "parse_failed", stdout: (result.stdout || "").slice(0, 500) };
  }
  return {
    elapsedMs: Date.now() - t0,
    status: result.status,
    data,
  };
}

function probeHelpers(tabId) {
  const js = `(function(){var h=globalThis.__notionAiChatHelpers;return{version:h&&h.version,captureSource:h&&h.getLastCaptureSource?h.getLastCaptureSource():null};})()`;
  const full = ["bun", CLI, "eval", js, "--tab", tabId, "--json"];
  const result = spawnSync(full[0], full.slice(1), { encoding: "utf8", timeout: 15000 });
  try {
    const outer = JSON.parse((result.stdout || "").trim());
    return outer?.data ?? outer;
  } catch {
    return null;
  }
}

const status = spawnSync("bun", [CLI, "status", "--json"], { encoding: "utf8" });
const daemon = JSON.parse(status.stdout || "{}");
if (daemon.running !== true) {
  console.error("bun-browser daemon not running");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const runs = [];

console.log(`Capture consistency live | tab=${tab} model=${model} helpers probe=${JSON.stringify(probeHelpers())}\n`);

for (const item of PLAN) {
  const prompt = readFileSync(join(PROBE_DIR, item.file), "utf8").trim();
  for (let i = 0; i < item.repeats; i++) {
    const runId = item.repeats > 1 ? `${item.id}-r${i + 1}` : item.id;
    const runTab = freshTab ? newTab() : tab;
    if (!runTab) {
      console.log(`SKIP ${runId}: could not allocate tab`);
      continue;
    }
    if (freshTab) await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(`Running ${runId} (tab=${runTab})... `);
    const { elapsedMs, data } = runChat(prompt, runTab);
    const answer = data?.answer ?? null;
    const entry = {
      id: runId,
      promptFile: item.file,
      expectJson: item.expectJson,
      elapsedMs,
      error: data?.error ?? null,
      answerFormat: data?.answerFormat ?? null,
      captureSource: data?.captureSource ?? null,
      jsonRecovered: data?.jsonRecovered ?? false,
      answerLen: answer ? String(answer).length : 0,
      answerHash: hash(answer),
      answerPreview: answer ? String(answer).slice(0, 120) : null,
      answerJson: data?.answerJson ?? null,
      helpersAfter: probeHelpers(runTab),
    };
    runs.push(entry);
    const ok = item.expectJson
      ? !!(data?.answerJson || (answer && answer.includes('"status"')))
      : !!(answer && String(answer).includes("OK-NOTION-FLOW"));
    console.log(
      `${ok ? "OK" : "FAIL"} | ${Math.round(elapsedMs / 1000)}s | src=${entry.captureSource || "?"} | fmt=${entry.answerFormat || "?"} | hash=${entry.answerHash}${entry.error ? ` | err=${entry.error}` : ""}`,
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const jsonRuns = runs.filter((r) => r.expectJson && r.id.startsWith("json-control"));
const jsonHashes = [...new Set(jsonRuns.map((r) => r.answerHash))];
const jsonSources = [...new Set(jsonRuns.map((r) => r.captureSource).filter(Boolean))];
const summary = {
  startedAt,
  tab,
  model,
  jsonControlRuns: jsonRuns.length,
  jsonHashUnique: jsonHashes.length,
  jsonHashes,
  jsonCaptureSources: jsonSources,
  allCaptureSources: [...new Set(runs.map((r) => r.captureSource).filter(Boolean))],
  passCount: runs.filter((r) => !r.error && r.answerLen > 0).length,
  totalRuns: runs.length,
  runs,
};

const outPath = join(OUT_DIR, `run-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log("\n--- Summary ---");
console.log(`JSON control: ${jsonRuns.length} runs, ${jsonHashes.length} unique answer hash(es): ${jsonHashes.join(", ") || "none"}`);
console.log(`Capture sources seen: ${summary.allCaptureSources.join(", ") || "none"}`);
console.log(`Passed: ${summary.passCount}/${summary.totalRuns}`);
console.log(`Written: ${outPath}`);
