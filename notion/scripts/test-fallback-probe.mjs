#!/usr/bin/env bun
/**
 * Validate model fallback: JSON stuck (live Opus) + single-char policy (in-tab eval).
 *
 * Usage:
 *   bun notion/scripts/test-fallback-probe.mjs
 *   bun notion/scripts/test-fallback-probe.mjs --prompt fb-json-stuck
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const SUITE_DIR = join(ROOT, "notion/example/fallback-probe");
const PROMPTS_META = join(SUITE_DIR, "prompts.json");
const OUT_DIR = join(SUITE_DIR, "runs");
const AI_URL = "https://app.notion.com/ai";

const args = process.argv.slice(2);
const promptFilter = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : null;

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
const defaults = meta.defaults || {};

function parseJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout?.slice(0, 500) };
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

function runChat(prompt, tab, item) {
  const maxWait = item.maxWaitMs ?? defaults.maxWaitMs ?? 120000;
  const stuckMs = item.modelFallbackStuckMs ?? defaults.modelFallbackStuckMs ?? 3000;
  const model = item.model ?? defaults.model ?? "opus";
  const t0 = Date.now();
  const r = run(
    [
      "site",
      "notion/chat",
      prompt,
      model,
      "true",
      "false",
      "false",
      "--allowBusyTab",
      "true",
      "--maxWaitMs",
      String(maxWait),
      "--modelFallbackStuckMs",
      String(stuckMs),
    ],
    maxWait + 120000,
    tab,
  );
  return { elapsedMs: Date.now() - t0, data: parseJson(r.stdout), timedOut: r.timedOut };
}

function needsRetry(d) {
  if (!d) return true;
  if (d.kind === "stale_thread") return true;
  if (d.error === "Stale chat thread still visible") return true;
  if (d.error === "Navigation required") return true;
  if (d.error === "Tab busy") return true;
  if (d.error === "Chat input not found") return true;
  return false;
}

function runChatWithRetries(prompt, item) {
  let tab = openTab();
  let runResult;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log(`  retry ${attempt}: fresh tab (${runResult?.data?.error || runResult?.data?.kind || "?"})`);
      tab = openTab();
    }
    runResult = runChat(prompt, tab, item);
    if (!needsRetry(runResult.data)) break;
  }
  return { tab, runResult };
}

function runPolicyEval(tab, item) {
  if (item.expectFallbackReason === "incomplete_json_stuck") {
    return runJsonStuckPolicyEval(tab);
  }
  if (item.expectFallbackReason === "incomplete_json_failed") {
    return runIncompleteJsonFailedPolicyEval(tab, item);
  }
  const js = `(function(){
    var h=globalThis.__notionAiChatHelpers;
    if(!h)return{error:'helpers not loaded',helpersVersion:null};
    var rejected=h.rejectSingleCharFailedAnswer('?',{mode:'opus',modelFallback:true});
    return{
      helpersVersion:h.version,
      rejected:rejected,
      wasSingleCharFailed:h.wasLastWaitSingleCharFailed(),
      reason:h.getModelFallbackTriggerReason(),
      shouldRetry:h.shouldRetryModelFallback('opus','plain',{modelFallback:true}),
      autoNoRetry:h.shouldRetryModelFallback('auto','plain',{modelFallback:true})
    };
  })()`;
  run(["site", "notion/chat", "", "opus", "true", "true", "false"], 120000, tab);
  const raw = run(["eval", js], 60000, tab).stdout;
  const parsed = parseJson(raw);
  const result = parsed?.result ?? parsed?.data?.result ?? parsed;
  const ok =
    result?.rejected === "" &&
    result?.wasSingleCharFailed === true &&
    result?.reason === "single_char_failed" &&
    result?.shouldRetry === true &&
    result?.autoNoRetry === false;
  return {
    elapsedMs: 0,
    ok,
    data: result,
    modelFallback: ok ? { reason: "single_char_failed", policy: true } : null,
  };
}

function runIncompleteJsonFailedPolicyEval(tab, item) {
  const model = item.model || "grok";
  const js = `(function(){
    var h=globalThis.__notionAiChatHelpers;
    if(!h)return{error:'helpers not loaded',helpersVersion:null};
    var rejected=h.rejectIncompleteJsonFailedAnswer('{"query":"Fed interest rate',{expectJson:true,modelFallback:true,mode:'${model}'});
    return{
      helpersVersion:h.version,
      rejected:rejected,
      wasIncompleteJsonFailed:h.wasLastWaitIncompleteJsonFailed(),
      reason:h.getModelFallbackTriggerReason(),
      shouldRetry:h.shouldRetryModelFallback('${model}','plain',{expectJson:true,modelFallback:true,mode:'${model}'}),
      autoNoRetry:h.shouldRetryModelFallback('auto','plain',{expectJson:true,modelFallback:true,mode:'auto'})
    };
  })()`;
  run(["site", "notion/chat", "", model, "true", "true", "false"], 120000, tab);
  const raw = run(["eval", js], 60000, tab).stdout;
  const parsed = parseJson(raw);
  const result = parsed?.result ?? parsed?.data?.result ?? parsed;
  const ok =
    result?.rejected === "" &&
    result?.wasIncompleteJsonFailed === true &&
    result?.reason === "incomplete_json_failed" &&
    result?.shouldRetry === true &&
    result?.autoNoRetry === false;
  return {
    elapsedMs: 0,
    ok,
    data: result,
    modelFallback: ok ? { reason: "incomplete_json_failed", policy: true } : null,
  };
}

function runJsonStuckPolicyEval(tab) {
  const js = `(async function(){
    var h=globalThis.__notionAiChatHelpers;
    if(!h)return{error:'helpers not loaded',helpersVersion:null};
    document.body.innerHTML='<div class="layout-chat"><div class="content-editable-leaf-rtl">Return ONLY valid JSON</div><div class="notion-text-block"><div class="content-editable-leaf-rtl">{"query":"Fed interest rate</div></div></div>';
    var pending=h.waitForAssistantAnswer(0,'',{pollMs:50,maxWaitMs:5000,expectJson:true,query:'Return ONLY valid JSON',modelFallbackStuckMs:200,mode:'opus'});
    await new Promise(function(r){setTimeout(r,280);});
    var answer=await pending;
    return{
      helpersVersion:h.version,
      answer:answer,
      wasIncompleteJsonStuck:h.wasLastWaitIncompleteJsonStuck(),
      reason:h.getModelFallbackTriggerReason(),
      shouldRetry:h.shouldRetryModelFallback('opus','Return ONLY valid JSON',{modelFallback:true}),
      autoNoRetry:h.shouldRetryModelFallback('auto','Return ONLY valid JSON',{modelFallback:true})
    };
  })()`;
  run(["site", "notion/chat", "", "opus", "true", "true", "false"], 120000, tab);
  const raw = run(["eval", js], 60000, tab).stdout;
  const parsed = parseJson(raw);
  const result = parsed?.result ?? parsed?.data?.result ?? parsed;
  const ok =
    result?.answer === "" &&
    result?.wasIncompleteJsonStuck === true &&
    result?.reason === "incomplete_json_stuck" &&
    result?.shouldRetry === true &&
    result?.autoNoRetry === false;
  return {
    elapsedMs: 0,
    ok,
    data: result,
    modelFallback: ok ? { reason: "incomplete_json_stuck", policy: true } : null,
  };
}

let items = meta.prompts.map((p) => ({
  ...p,
  prompt: p.file ? readFileSync(join(SUITE_DIR, p.file), "utf8").trim() : "",
}));
if (promptFilter) items = items.filter((p) => p.id === promptFilter);

const status = run(["status"], 15000);
if (parseJson(status.stdout)?.running !== true) {
  console.error("bun-browser daemon not running");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];

console.log(`Fallback probe: ${items.length} item(s)\n`);

for (const item of items) {
  console.log(`--- ${item.id} ---`);
  let row;
  if (item.kind === "policy-eval") {
    const tab = openTab();
    const evalResult = runPolicyEval(tab, item);
    row = {
      id: item.id,
      kind: item.kind,
      tab,
      ok: evalResult.ok,
      modelFallback: evalResult.modelFallback,
      policy: evalResult.data,
      helpersVersion: evalResult.data?.helpersVersion ?? null,
    };
    console.log(
      `  ${row.ok ? "OK" : "FAIL"} | policy ${item.expectFallbackReason || "eval"} | helpers=v${row.helpersVersion ?? "?"} | reason=${evalResult.data?.reason ?? "?"}`,
    );
  } else {
    const { tab, runResult } = runChatWithRetries(item.prompt, item);
    const d = runResult.data || {};
    const reason = d.modelFallback?.reason ?? null;
    const expectReason = item.expectFallbackReason ?? null;
    const ok =
      expectReason === null
        ? !d.error && !d.modelFallback && !!(d.answerJson || d.answer)
        : reason === expectReason && !!(d.answer || d.answerJson);
    row = {
      id: item.id,
      kind: "live-chat",
      tab,
      elapsedMs: runResult.elapsedMs,
      ok,
      error: d.error || null,
      modelFallback: d.modelFallback || null,
      hasAnswerJson: !!d.answerJson,
      answerLen: d.answer ? String(d.answer).length : 0,
      expectFallbackReason: expectReason,
      actualFallbackReason: reason,
    };
    console.log(
      `  ${ok ? "OK" : "FAIL"} | ${d.error || "ok"} | fallback=${reason || "none"} | json=${row.hasAnswerJson} | len=${row.answerLen}`,
    );
  }
  results.push(row);
  console.log("");
  spawnSync("sleep", ["2"]);
}

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  passCount: results.filter((r) => r.ok).length,
  results,
};
const outPath = join(OUT_DIR, `run-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2));
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

console.log("=== Summary ===");
console.log(`  pass: ${summary.passCount}/${results.length}`);
console.log(`  report: ${outPath}`);
