#!/usr/bin/env bun
/**
 * 10-prompt Notion Opus live test: grok/example/test1.txt + test2.txt style prompts.
 * Fresh tab + --newChat true per run.
 *
 * Usage:
 *   bun notion/scripts/test-grok-prompts-10.mjs
 *   bun notion/scripts/test-grok-prompts-10.mjs --dry-run
 *   bun notion/scripts/test-grok-prompts-10.mjs --prompt p01-test1-baseline
 *   bun notion/scripts/test-grok-prompts-10.mjs --model auto
 *   bun notion/scripts/test-grok-prompts-10.mjs --models auto,grok,gemini
 *   bun notion/scripts/test-grok-prompts-10.mjs --models non-opus-sonnet
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const SUITE_DIR = join(ROOT, "notion/example/grok-prompts-10");
const PROMPTS_META = join(SUITE_DIR, "prompts.json");
const OUT_DIR = join(SUITE_DIR, "runs");
const FINANCIAL_BASE = join(ROOT, "grok/example/test1.txt");
const TEST2 = join(ROOT, "grok/example/test2.txt");
const AI_URL = "https://app.notion.com/ai";

const FINANCIAL_VARIANTS = [
  {
    published_at: "2026-05-24T13:56:00+00:00",
    fingerprint:
      '{"primary_event":"Signs of progress toward Iran deal amid Trump shifting rhetoric","event_date_estimate":"2026-05-24","atomic_claims":["Trump warned Iran clock is ticking","Trump postponed planned attack","Trump said negotiations in final phase"],"search_query":"Trump Iran deal progress","entities":["Trump","Iran","US"]}',
    headline: "Signs of progress toward Iran deal follow another week of Trump's shifting rhetoric",
  },
  {
    published_at: "2026-06-01T09:15:00+00:00",
    fingerprint:
      '{"primary_event":"Federal Reserve holds rates steady amid mixed inflation signals","event_date_estimate":"2026-06-01","atomic_claims":["Fed kept benchmark rate unchanged","Powell cited labor market cooling","Dot plot showed two cuts in 2026"],"search_query":"Fed rate decision June 2026","entities":["Fed","Powell","US"]}',
    headline: "Fed holds interest rates steady, signals patience on cuts as inflation cools gradually",
  },
  {
    published_at: "2026-06-05T16:40:00+00:00",
    fingerprint:
      '{"primary_event":"Apple unveils AI features at WWDC 2026","event_date_estimate":"2026-06-05","atomic_claims":["Apple Intelligence expanded to third-party apps","New on-device models announced","Privacy sandbox for cloud AI detailed"],"search_query":"Apple WWDC 2026 AI announcements","entities":["Apple","WWDC","iOS"]}',
    headline: "Apple expands AI across its platforms at WWDC, emphasizing on-device privacy",
  },
  {
    published_at: "2026-06-08T11:20:00+00:00",
    fingerprint:
      '{"primary_event":"SpaceX IPO filing draws record institutional demand","event_date_estimate":"2026-06-08","atomic_claims":["S-1 filed with SEC","Order book oversubscribed multiple times","Musk retains voting control structure"],"search_query":"SpaceX IPO 2026 oversubscribed","entities":["SpaceX","Musk","SEC"]}',
    headline: "SpaceX IPO reportedly oversubscribed as investors chase access to Starlink growth",
  },
  {
    published_at: "2026-06-11T08:00:00+00:00",
    fingerprint:
      '{"primary_event":"Ethereum spot ETF sees largest weekly inflow since launch","event_date_estimate":"2026-06-11","atomic_claims":["$1.2B weekly net inflow reported","BlackRock fund led flows","ETH price rose 8% on week"],"search_query":"Ethereum ETF inflows June 2026","entities":["Ethereum","ETF","BlackRock"]}',
    headline: "Ethereum ETFs post record weekly inflows as institutional demand accelerates",
  },
];

const NON_OPUS_SONNET_MODELS = [
  "auto",
  "fable",
  "gemini",
  "gpt-5.2",
  "gpt-5.4",
  "grok",
  "kimi",
  "deepseek",
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const promptFilter = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : null;
const maxWaitOverride = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : null;
const stuckMs = args.includes("--modelFallbackStuckMs")
  ? Number(args[args.indexOf("--modelFallbackStuckMs") + 1])
  : null;
const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const modelsArg = args.includes("--models") ? args[args.indexOf("--models") + 1] : null;

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
const defaults = meta.defaults || {};
const resolvedStuckMs = stuckMs ?? defaults.modelFallbackStuckMs ?? 5000;
const defaultModel = defaults.model || "opus";
const pauseMs = defaults.pauseMs ?? 2000;

function resolveModelList() {
  if (modelsArg) {
    if (modelsArg === "non-opus-sonnet") return [...NON_OPUS_SONNET_MODELS];
    return modelsArg.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (modelArg) return [modelArg];
  return [defaultModel];
}

function buildFinancialTemporal(variantIndex) {
  const base = readFileSync(FINANCIAL_BASE, "utf8");
  const v = FINANCIAL_VARIANTS[variantIndex % FINANCIAL_VARIANTS.length];
  return base
    .replace(/published_at: [^\n]+/, `published_at: ${v.published_at}`)
    .replace(
      /Event fingerprint from prior extraction:\n\{[^}]+\}/,
      `Event fingerprint from prior extraction:\n${v.fingerprint}`,
    )
    .replace(/Signs of progress toward Iran deal follow[^\n]+/, v.headline);
}

function buildTest2Topic(topic) {
  const template = readFileSync(TEST2, "utf8");
  return template.replace(/based on user "[^"]+"/i, `based on user "${topic}"`);
}

function resolvePrompt(item) {
  switch (item.template) {
    case "test1-file":
      return readFileSync(FINANCIAL_BASE, "utf8").trim();
    case "financial-temporal":
      return buildFinancialTemporal(item.variant ?? 0);
    case "test2-file":
      return readFileSync(TEST2, "utf8").trim();
    case "test2-topic":
      if (!item.topic) throw new Error(`Missing topic for ${item.id}`);
      return buildTest2Topic(item.topic);
    default:
      throw new Error(`Unknown template: ${item.template}`);
  }
}

function loadItems() {
  let items = meta.prompts.map((p) => ({
    ...p,
    prompt: resolvePrompt(p),
    maxWaitMs: maxWaitOverride ?? p.maxWaitMs ?? defaults.maxWaitMsFinancial ?? 240000,
  }));
  if (promptFilter) {
    items = items.filter((p) => p.id === promptFilter);
    if (!items.length) {
      console.error(`Unknown --prompt id: ${promptFilter}`);
      process.exit(1);
    }
  }
  return items;
}

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
  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    timedOut: result.signal === "SIGTERM",
  };
}

function openTab() {
  const opened = run(["tab", "new", AI_URL], 60000);
  const data = parseJson(opened.stdout);
  const shortId = data?.tab || String(data?.tabId || "").slice(-4).toLowerCase();
  if (!shortId) throw new Error("tab new failed");
  for (let i = 0; i < 25; i++) {
    spawnSync("sleep", ["1"]);
    const health = run(["site", "notion/health"], 30000, shortId);
    if (parseJson(health.stdout)?.ok) break;
  }
  spawnSync("sleep", ["3"]);
  return shortId;
}

function runChat(prompt, tab, itemMaxWait, modelAlias, waitOnly = false) {
  const t0 = Date.now();
  const chatArgs = [
    "site",
    "notion/chat",
    waitOnly ? "x" : prompt,
    modelAlias,
    "true",
    "false",
    waitOnly ? "true" : "false",
    "--allowBusyTab",
    "true",
    "--maxWaitMs",
    String(itemMaxWait),
    "--modelFallbackStuckMs",
    String(resolvedStuckMs),
  ];
  const r = run(chatArgs, itemMaxWait + 120000, tab);
  const data = parseJson(r.stdout);
  return {
    elapsedMs: Date.now() - t0,
    timedOut: r.timedOut,
    data,
  };
}

function needsRetry(d) {
  if (!d) return true;
  if (d.selectOnly) return true;
  if (d.kind === "stale_thread") return true;
  if (d.error === "Stale chat thread still visible") return true;
  if (d.error === "Navigation required") return true;
  if (d.error === "Tab busy") return true;
  if (d.error === "Chat input not found") return true;
  return false;
}

function isStillGenerating(d) {
  return d?.error === "Still generating" || d?.kind === "chat_in_progress";
}

const maxStaleRetries = 3;
const maxWaitOnlyPolls = 5;

function runChatWithRetries(prompt, itemMaxWait, modelAlias, item) {
  let tab = openTab();
  let runResult;
  for (let attempt = 0; attempt < maxStaleRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  retry ${attempt}: opening fresh tab (${runResult?.data?.error || runResult?.data?.kind || "selectOnly"})`);
      tab = openTab();
    }
    runResult = runChat(prompt, tab, itemMaxWait, modelAlias);
    if (!needsRetry(runResult.data)) break;
  }
  const maxPolls = item?.kind === "news-search" ? 10 : maxWaitOnlyPolls;
  if (isStillGenerating(runResult.data)) {
    for (let poll = 0; poll < maxPolls; poll++) {
      console.log(`  waitOnly poll ${poll + 1}/${maxPolls}`);
      const pollResult = runChat(prompt, tab, itemMaxWait, modelAlias, true);
      runResult.elapsedMs += pollResult.elapsedMs;
      runResult.timedOut = pollResult.timedOut;
      runResult.data = pollResult.data;
      if (!isStillGenerating(pollResult.data) && (pollResult.data?.answer || pollResult.data?.answerJson)) break;
    }
  }
  return { tab, runResult };
}

const captureProbeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var msgs=h.getAssistantMessagesSinceLastUser();
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,0):'';
  return{
    helpersVersion:h.version,
    hasCompletedReplyActions:h.hasCompletedReplyActions(),
    answerLen:ans.length,
    looksFinal:h.looksLikeFinalAnswer(ans)
  };
})()`;

function probeHelpers(tab) {
  const r = run(["eval", captureProbeJs], 30000, tab);
  const data = parseJson(r.stdout);
  if (data?.result && typeof data.result === "object") return data.result;
  return data;
}

function tryRecoverJson(text) {
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

function classifyRow(item, d, runResult) {
  const answer = d?.answer ? String(d.answer) : "";
  const answerLen = answer.length;
  const hasAnswerJson = !!d?.answerJson;
  const jsonRecovered = !!d?.jsonRecovered;
  const recoveredJson = !hasAnswerJson ? tryRecoverJson(answer) : null;
  const hasJson = hasAnswerJson || !!recoveredJson;
  const errors = [];
  if (d?.error) errors.push(String(d.error));
  if (d?.selectOnly) errors.push("chat returned selectOnly (positional arg parse failure)");
  if (answerLen <= 1 && !d?.modelFallback) errors.push("answer too short (<=1 char)");
  if (item.expectJson && !hasJson && !d?.modelFallback) errors.push("missing parseable JSON");
  const ok = errors.length === 0 || (d?.modelFallback && answerLen > 1 && hasJson);
  return {
    ok,
    errors,
    answerLen,
    hasAnswerJson,
    jsonRecovered: jsonRecovered || !!recoveredJson,
    wasEmpty: answerLen === 0,
    timedOut: runResult.timedOut,
  };
}

const items = loadItems();
const modelList = resolveModelList();

if (dryRun) {
  console.log(`Dry run: ${items.length} prompts × ${modelList.length} model(s), stuckMs=${resolvedStuckMs}\n`);
  console.log(`  models: ${modelList.join(", ")}\n`);
  for (const item of items) {
    console.log(
      `  ${item.id.padEnd(22)} kind=${item.kind.padEnd(18)} len=${String(item.prompt.length).padStart(6)} maxWaitMs=${item.maxWaitMs}`,
    );
  }
  process.exit(0);
}

const status = run(["status"], 15000);
if (parseJson(status.stdout)?.running !== true) {
  console.error("bun-browser daemon not running");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const batchStartedAt = new Date().toISOString();
const allSummaries = [];

for (const modelAlias of modelList) {
  const modelOutDir = join(OUT_DIR, modelAlias);
  mkdirSync(modelOutDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = [];

  console.log(
    `\n========== model=${modelAlias} | ${items.length} prompts | stuckMs=${resolvedStuckMs} ==========\n`,
  );

  for (const item of items) {
    console.log(`--- ${modelAlias} | ${item.id} len=${item.prompt.length} maxWait=${item.maxWaitMs} ---`);
    const { tab, runResult } = runChatWithRetries(item.prompt, item.maxWaitMs, modelAlias, item);
    console.log(`  tab=${tab}`);
    const d = runResult.data || {};
    const probe = probeHelpers(tab);
    const classified = classifyRow(item, d, runResult);
    const row = {
      id: item.id,
      kind: item.kind,
      requestedModel: modelAlias,
      tab,
      promptLen: item.prompt.length,
      maxWaitMs: item.maxWaitMs,
      elapsedMs: runResult.elapsedMs,
      ok: classified.ok,
      errors: classified.errors,
      error: d.error || null,
      hint: d.hint || null,
      model: d.model || null,
      modeLabel: d.modeLabel || null,
      modelFallback: d.modelFallback || null,
      hasAnswerJson: classified.hasAnswerJson,
      jsonRecovered: classified.jsonRecovered,
      answerLen: classified.answerLen,
      wasEmpty: classified.wasEmpty,
      timedOut: classified.timedOut,
      helpersVersion: probe?.helpersVersion ?? null,
      answerPreview: d.answer ? String(d.answer).slice(0, 200) : null,
    };
    results.push(row);

    const fb = row.modelFallback
      ? `FALLBACK ${row.modelFallback.from}→${row.modelFallback.to} (${row.modelFallback.reason})`
      : "no fallback";
    const statusLabel = row.ok ? "OK" : "FAIL";
    console.log(
      `  ${statusLabel} | ${row.error || "ok"} | model=${row.modeLabel || "?"} | json=${row.hasAnswerJson || row.jsonRecovered} | len=${row.answerLen} | helpers=v${row.helpersVersion ?? "?"} | ${fb}`,
    );
    if (row.errors.length) console.log(`  errors: ${row.errors.join("; ")}`);
    if (row.answerPreview) console.log(`  preview: ${row.answerPreview.replace(/\n/g, " ")}`);
    console.log("");
    spawnSync("sleep", [String(pauseMs / 1000)]);
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    model: modelAlias,
    modelFallbackStuckMs: resolvedStuckMs,
    passCount: results.filter((r) => r.ok).length,
    fallbackCount: results.filter((r) => r.modelFallback).length,
    jsonSuccessCount: results.filter((r) => r.hasAnswerJson || r.jsonRecovered).length,
    errorCount: results.filter((r) => r.error).length,
    emptyCount: results.filter((r) => r.wasEmpty).length,
    results,
  };

  const outPath = join(modelOutDir, `run-${startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  writeFileSync(join(modelOutDir, "summary.json"), JSON.stringify(summary, null, 2));
  allSummaries.push({
    model: modelAlias,
    passCount: summary.passCount,
    total: results.length,
    jsonSuccessCount: summary.jsonSuccessCount,
    fallbackCount: summary.fallbackCount,
    errorCount: summary.errorCount,
    report: outPath,
  });

  console.log(`=== ${modelAlias} summary: ${summary.passCount}/${results.length} pass, JSON ${summary.jsonSuccessCount}/${results.length} ===`);
}

const batchSummary = {
  startedAt: batchStartedAt,
  finishedAt: new Date().toISOString(),
  models: modelList,
  modelFallbackStuckMs: resolvedStuckMs,
  summaries: allSummaries,
};
writeFileSync(join(OUT_DIR, "batch-summary.json"), JSON.stringify(batchSummary, null, 2));

console.log("\n=== Batch summary ===");
for (const s of allSummaries) {
  console.log(`  ${s.model.padEnd(10)} pass ${s.passCount}/${s.total} | json ${s.jsonSuccessCount}/${s.total} | fallback ${s.fallbackCount}`);
}
console.log(`  report: ${join(OUT_DIR, "batch-summary.json")}`);
