#!/usr/bin/env bun
/**
 * End-to-end flow test for notion site adapters.
 *
 * Prerequisites:
 *   bun-browser daemon running, app.notion.com logged in
 *
 * Usage:
 *   bun notion/scripts/run-api-flow.mjs
 *   bun notion/scripts/run-api-flow.mjs --json-out /tmp/notion-flow.json
 *   bun notion/scripts/run-api-flow.mjs --chat-models auto,sonnet,gemini --tab 0
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  findStaleAliases,
  findUnmappedModels,
  isAbnormalResponse,
  validateChatResponse,
  validateHealth,
  validateModelSelection,
  validateModels,
  validateSearchResponse,
} from "../api-schemas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json-out")
  ? args[args.indexOf("--json-out") + 1]
  : join(ROOT, ".api-flow-results.json");
const tabIdx = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : "0";
const chatModelsArg = args.includes("--chat-models")
  ? args[args.indexOf("--chat-models") + 1]
  : "auto,sonnet,gemini";
const CHAT_MODELS = chatModelsArg.split(",").map((s) => s.trim()).filter(Boolean);

const FLOW_ID = `NOTION-FLOW-${Date.now().toString(36).toUpperCase()}`;
const EXACT_TOKEN = `OK-${FLOW_ID}`;
const FOLLOW_EXACT = `FOLLOW-${FLOW_ID}`;
const CHAT_TIMEOUT_MS = 300000;
const NAV_RE = /navigation required/i;

function runBunBrowser(parts, opts = {}) {
  const timeoutMs = opts.timeoutMs || 180000;
  const argv = ["bun", CLI, ...parts];
  if (opts.json) argv.push("--json");
  if (opts.tab != null) argv.push("--tab", String(opts.tab));
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    argv: argv.join(" "),
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
}

function runSiteCli(name, positional = [], timeoutMs = 180000) {
  return runBunBrowser(["site", name, ...positional], {
    json: true,
    tab: tabIdx,
    timeoutMs,
  });
}

function parseSiteJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint, kind: parsed.kind };
    }
    return parsed;
  } catch {
    return null;
  }
}

function runSite(name, positional = [], opts = {}) {
  const run = runSiteCli(name, positional, opts.timeoutMs || CHAT_TIMEOUT_MS);
  const data = parseSiteJson(run.stdout);
  return {
    name,
    positional,
    run,
    data,
    error: data?.error || (run.timedOut ? "timeout" : run.status !== 0 ? run.stderr.slice(0, 300) : null),
  };
}

function runSiteWithRetry(name, positional = [], opts = {}) {
  const attempts = opts.retries != null ? opts.retries + 1 : 2;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) settleApp();
    last = runSite(name, positional, opts);
    const errText = String(last.error || last.data?.error || "");
    if (!NAV_RE.test(errText)) return last;
  }
  return last;
}

function settleApp(ms = 2500) {
  runBunBrowser(["open", "https://app.notion.com/ai", "--tab", tabIdx], { timeoutMs: 30000 });
  spawnSync("sleep", [String(Math.ceil(ms / 1000))]);
}

function chatPositional(query, model = "auto", opts = {}) {
  return [
    query,
    model,
    opts.newChat === false ? "false" : "true",
    opts.selectOnly ? "true" : "false",
    opts.waitOnly ? "true" : "false",
    "",
    opts.maxWaitMs != null ? String(opts.maxWaitMs) : "",
  ];
}

function retryExactIfGenerating(model, expectedText, timeoutMs = 240000) {
  const base = chatPositional(`Reply with exactly: ${expectedText}`, model, { maxWaitMs: timeoutMs });
  let run = runSite("notion/chat", base, { timeoutMs });
  let val = validateChatResponse(run.data || { error: run.error }, {
    expectExact: true,
    exactText: expectedText,
  });
  if (val.ok) return { run, val };

  const errText = String(run.data?.error || run.error || "");
  if (!errText.includes("Still generating")) return { run, val };

  const waitPos = chatPositional(`Reply with exactly: ${expectedText}`, model, {
    waitOnly: true,
    maxWaitMs: timeoutMs,
  });
  run = runSite("notion/chat", waitPos, { timeoutMs });
  val = validateChatResponse(run.data || { error: run.error }, {
    expectExact: true,
    exactText: expectedText,
  });
  return { run, val };
}

function recordStep(steps, step) {
  steps.push(step);
  const label = step.status.toUpperCase();
  const detail = step.errors?.length
    ? step.errors.join("; ")
    : step.skipReason || step.note || "";
  console.log(`${label.padEnd(6)} ${step.name}${detail ? ` — ${detail}` : ""}`);
  return step;
}

const steps = [];
let conversationId = null;
let chatBlocked = false;

console.log(`notion API flow (${FLOW_ID})\n`);

const statusRun = runBunBrowser(["status"], { timeoutMs: 15000 });
if (statusRun.status !== 0 || !/Daemon running:\s*yes/i.test(statusRun.stdout)) {
  recordStep(steps, {
    name: "bun-browser status",
    status: "fail",
    errors: ["bun-browser daemon is not running. Start with: bun-browser start"],
  });
  writeReport(steps);
  process.exit(1);
}
recordStep(steps, { name: "bun-browser status", status: "pass" });

settleApp(3000);

const health = runSite("notion/health", [], { timeoutMs: 60000 });
const healthVal = validateHealth(health.data || { error: health.error || "empty response" });
recordStep(steps, {
  name: "notion/health",
  status: healthVal.ok ? "pass" : "fail",
  errors: healthVal.errors,
  data: healthVal.data,
});

if (isAbnormalResponse(health.data)) chatBlocked = true;

settleApp(2000);

const models = runSiteWithRetry("notion/models", [], { timeoutMs: 120000 });
const modelsVal = validateModels(models.data || { error: models.error || "empty response" });
const unmapped = findUnmappedModels(models.data?.models);
const staleAliases = findStaleAliases(models.data?.models);
recordStep(steps, {
  name: "notion/models",
  status: modelsVal.ok ? "pass" : "fail",
  errors: modelsVal.errors,
  data: modelsVal.data,
  note:
    unmapped.length || staleAliases.length
      ? `unmapped: [${unmapped.join(", ")}]; stale aliases: [${staleAliases.join(", ")}]`
      : undefined,
});

const modelRows = models.data?.models || [];

for (const model of modelRows) {
  const selectRun = runSiteWithRetry(
    "notion/chat",
    chatPositional("", model.id, { selectOnly: true }),
    { timeoutMs: 120000 },
  );
  const selectVal = validateModelSelection(selectRun.data || { error: selectRun.error }, model.title);
  const abnormal = isAbnormalResponse(selectRun.data);
  recordStep(steps, {
    name: `notion/chat select (${model.id})`,
    status: selectVal.ok ? "pass" : abnormal ? "skip" : "fail",
    errors: selectVal.ok ? [] : selectVal.errors?.length ? selectVal.errors : selectRun.error ? [selectRun.error] : [],
    skipReason: abnormal ? String(selectRun.data?.error || selectRun.error) : undefined,
    data: selectRun.data,
  });
}

if (chatBlocked) {
  for (const model of CHAT_MODELS) {
    recordStep(steps, {
      name: `notion/chat exact (${model})`,
      status: "skip",
      skipReason: "abnormal preflight from health",
    });
  }
} else {
  for (const model of CHAT_MODELS) {
    const chatResult = retryExactIfGenerating(model, EXACT_TOKEN);
    if (chatResult.val.ok && chatResult.val.data?.conversationId && !conversationId) {
      conversationId = chatResult.val.data.conversationId;
    }
    const abnormal = isAbnormalResponse(chatResult.run.data);
    if (abnormal) chatBlocked = true;
    recordStep(steps, {
      name: `notion/chat exact (${model})`,
      status: chatResult.val.ok ? "pass" : abnormal ? "skip" : "fail",
      errors: chatResult.val.errors?.length
        ? chatResult.val.errors
        : chatResult.run.error
          ? [chatResult.run.error]
          : [],
      skipReason: abnormal ? String(chatResult.run.data?.error) : undefined,
      data: chatResult.val.data,
      conversationId: chatResult.val.data?.conversationId,
    });
    if (chatBlocked) break;
    settleApp(2000);
  }
}

if (!conversationId || chatBlocked) {
  recordStep(steps, {
    name: "notion/chatfollow (exact)",
    status: "skip",
    skipReason: chatBlocked ? "chat blocked by abnormal response" : "no conversationId from chat",
  });
} else {
  const followPos = [
    conversationId,
    `Reply with exactly: ${FOLLOW_EXACT}`,
    "auto",
    "false",
    "",
    "180000",
  ];
  let followRun = runSite("notion/chatfollow", followPos, { timeoutMs: 240000 });
  let followVal = validateChatResponse(followRun.data || { error: followRun.error }, {
    expectExact: true,
    exactText: FOLLOW_EXACT,
  });
  if (!followVal.ok && String(followRun.data?.error || "").includes("Still generating")) {
    followPos[3] = "true";
    followRun = runSite("notion/chatfollow", followPos, { timeoutMs: 240000 });
    followVal = validateChatResponse(followRun.data || { error: followRun.error }, {
      expectExact: true,
      exactText: FOLLOW_EXACT,
    });
  }
  recordStep(steps, {
    name: "notion/chatfollow (exact)",
    status: followVal.ok ? "pass" : "fail",
    errors: followVal.errors?.length ? followVal.errors : followRun.error ? [followRun.error] : [],
    data: followVal.data,
  });
}

const search = runSiteWithRetry("notion/search", [FLOW_ID, "10"], { timeoutMs: 120000 });
const searchVal = validateSearchResponse(search.data || { error: search.error });
recordStep(steps, {
  name: "notion/search",
  status: searchVal.ok ? "pass" : "fail",
  errors: searchVal.errors,
  data: searchVal.data,
});

writeReport(steps);

function writeReport(allSteps) {
  const summary = {
    flowId: FLOW_ID,
    testedAt: new Date().toISOString(),
    chatModels: CHAT_MODELS,
    conversationId,
    unmappedModels: unmapped,
    staleAliases,
    total: allSteps.length,
    pass: allSteps.filter((s) => s.status === "pass").length,
    fail: allSteps.filter((s) => s.status === "fail").length,
    skip: allSteps.filter((s) => s.status === "skip").length,
    steps: allSteps,
  };

  writeFileSync(jsonOut, JSON.stringify(summary, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(`PASS:  ${summary.pass}`);
  console.log(`FAIL:  ${summary.fail}`);
  console.log(`SKIP:  ${summary.skip}`);
  console.log(`Report: ${jsonOut}`);

  if (summary.fail > 0) {
    console.log("\nFailed steps:");
    for (const step of allSteps.filter((s) => s.status === "fail")) {
      console.log(`- ${step.name}: ${(step.errors || []).join("; ")}`);
    }
    process.exit(1);
  }
}
