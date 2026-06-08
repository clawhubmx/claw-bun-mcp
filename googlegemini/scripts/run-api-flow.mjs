#!/usr/bin/env bun
/**
 * End-to-end flow test for all googlegemini site adapters.
 *
 * Prerequisites:
 *   bun-browser daemon running, gemini.google.com logged in (recommended)
 *
 * Usage:
 *   bun googlegemini/scripts/run-api-flow.mjs
 *   bun googlegemini/scripts/run-api-flow.mjs --json-out /tmp/gemini-flow.json
 *   bun googlegemini/scripts/run-api-flow.mjs --skip-attach --tab 0
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validateBranchResponse,
  validateChatResponse,
  validateHealth,
  validateLibraryResponse,
  validateModes,
  validateSearchResponse,
} from "../api-schemas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const ATTACH_FILE = join(ROOT, ".test-attach.txt");

const args = process.argv.slice(2);
const jsonOut = args.includes("--json-out")
  ? args[args.indexOf("--json-out") + 1]
  : join(ROOT, ".api-flow-results.json");
const skipAttach = args.includes("--skip-attach");
const tabIdx = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : "0";

const FLOW_ID = `GEMINI-FLOW-${Date.now().toString(36).toUpperCase()}`;
const EXACT_TOKEN = `OK-${FLOW_ID}`;
const JSON_TEST_ID = `JSON-${FLOW_ID}`;
const FOLLOW_EXACT = `FOLLOW-${FLOW_ID}`;
const CHAT_TIMEOUT_MS = 300000;
const NAV_RE = /navigated or closed/i;

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
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint };
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

function settleApp(ms = 2500) {
  runBunBrowser(["open", "https://gemini.google.com/app", "--tab", tabIdx], { timeoutMs: 30000 });
  spawnSync("sleep", [String(Math.ceil(ms / 1000))]);
}

function openConversation(id) {
  runBunBrowser(["open", `https://gemini.google.com/app/${id}`, "--tab", tabIdx], { timeoutMs: 30000 });
  spawnSync("sleep", ["4"]);
}

function openGeminiPath(path) {
  runBunBrowser(["open", `https://gemini.google.com${path}`, "--tab", tabIdx], { timeoutMs: 30000 });
  spawnSync("sleep", ["3"]);
}

function waitForSubmitReady(maxSeconds = 90) {
  for (let i = 0; i < maxSeconds; i += 3) {
    const health = runSite("googlegemini/health", [], { timeoutMs: 30000 });
    if (health.data?.submitEnabled) return true;
    spawnSync("sleep", ["3"]);
  }
  return false;
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

function retryExactIfGenerating(siteName, positional, expectedText, timeoutMs = 180000) {
  let run = runSite(siteName, positional, { timeoutMs });
  let val = validateChatResponse(run.data || { error: run.error }, {
    expectExact: true,
    exactText: expectedText,
  });
  if (val.ok) return { run, val };

  const errText = String(run.data?.error || run.error || "");
  if (!errText.includes("Still generating")) return { run, val };

  const waitPos = positional.slice();
  while (waitPos.length < 4) waitPos.push("");
  waitPos[3] = "true";
  while (waitPos.length < 9) waitPos.push("");
  waitPos[8] = String(timeoutMs);

  run = runSite(siteName, waitPos, { timeoutMs });
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
let branchedConversationId = null;

console.log(`googlegemini API flow (${FLOW_ID})\n`);

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

runBunBrowser(["open", "https://gemini.google.com/app", "--tab", tabIdx], { timeoutMs: 30000 });
spawnSync("sleep", ["3"]);

const health = runSite("googlegemini/health");
const healthVal = validateHealth(health.data || { error: health.error || "empty response" });
recordStep(steps, {
  name: "googlegemini/health",
  status: healthVal.ok ? "pass" : "fail",
  errors: healthVal.errors,
  data: healthVal.data,
});

const modes = runSite("googlegemini/modes");
const modesVal = validateModes(modes.data || { error: modes.error || "empty response" });
recordStep(steps, {
  name: "googlegemini/modes",
  status: modesVal.ok ? "pass" : "fail",
  errors: modesVal.errors,
  data: modesVal.data,
});

settleApp(4000);
waitForSubmitReady(120);

let chatExactResult = retryExactIfGenerating(
  "googlegemini/chat",
  [`Reply with exactly: ${EXACT_TOKEN}`, "flash", "true", "false", "", "", "", "", "120000"],
  EXACT_TOKEN,
);
if (!chatExactResult.val.ok) {
  chatExactResult = retryExactIfGenerating(
    "googlegemini/chat",
    [`Reply with exactly: ${EXACT_TOKEN}`, "flash", "false", "false", "", "", "", "", "120000"],
    EXACT_TOKEN,
  );
}
let chatExactVal = chatExactResult.val;
let chatExact = chatExactResult.run;
if (chatExactVal.ok && chatExactVal.data?.conversationId) {
  conversationId = chatExactVal.data.conversationId;
}
recordStep(steps, {
  name: "googlegemini/chat (exact)",
  status: chatExactVal.ok ? "pass" : "fail",
  errors: chatExactVal.errors?.length ? chatExactVal.errors : chatExact.error ? [chatExact.error] : [],
  data: chatExactVal.data,
  conversationId,
});

if (!conversationId) {
  openGeminiPath("/search");
  const fallbackSearch = runSite("googlegemini/search", ["*", "5", "1"], { timeoutMs: 120000 });
  const fallbackId = fallbackSearch.data?.results?.find((row) => row.conversationId)?.conversationId;
  if (fallbackId) {
    conversationId = fallbackId;
    recordStep(steps, {
      name: "conversation fallback (search)",
      status: "pass",
      note: `using ${conversationId} from search`,
    });
  }
}

if (!conversationId) {
  recordStep(steps, {
    name: "googlegemini/chatfollow (exact)",
    status: "skip",
    skipReason: "no conversationId from chat",
  });
  recordStep(steps, {
    name: "googlegemini/chatfollow (json)",
    status: "skip",
    skipReason: "no conversationId from chat",
  });
} else {
  openConversation(conversationId);
  waitForSubmitReady();

  const followExactResult = retryExactIfGenerating(
    "googlegemini/chatfollow",
    [
      conversationId,
      `Reply with exactly: ${FOLLOW_EXACT}`,
      "flash",
      "false",
      "",
      "",
      "",
      "",
      "120000",
    ],
    FOLLOW_EXACT,
  );
  const followExactVal = followExactResult.val;
  recordStep(steps, {
    name: "googlegemini/chatfollow (exact)",
    status: followExactVal.ok ? "pass" : "fail",
    errors: followExactVal.errors?.length
      ? followExactVal.errors
      : followExactResult.run.error
        ? [followExactResult.run.error]
        : [],
    data: followExactVal.data,
  });

  openConversation(conversationId);
  waitForSubmitReady();

  const followJsonPrompt =
    `Reply with ONLY a JSON object and no other text. ` +
    `Keys: "testId" (string), "phase" (string). ` +
    `Set testId to "${JSON_TEST_ID}" and phase to "follow".`;
  const followJson = runSiteWithRetry("googlegemini/chatfollow", [
    conversationId,
    followJsonPrompt,
    "flash",
    "false",
    "",
    "",
    "",
    "",
    "120000",
  ]);
  const followJsonVal = validateChatResponse(followJson.data || { error: followJson.error }, {
    expectJson: true,
    jsonShape: { testId: "string", phase: "string" },
    jsonValues: { testId: JSON_TEST_ID, phase: "follow" },
  });
  recordStep(steps, {
    name: "googlegemini/chatfollow (json)",
    status: followJsonVal.ok ? "pass" : "fail",
    errors: followJsonVal.errors?.length ? followJsonVal.errors : followJson.error ? [followJson.error] : [],
    data: followJsonVal.data,
  });
}

if (skipAttach) {
  recordStep(steps, {
    name: "googlegemini/chat (attachment)",
    status: "skip",
    skipReason: "--skip-attach",
  });
} else {
  const attachContent = readFileSync(ATTACH_FILE, "utf8");
  const attachChat = runSite(
    "googlegemini/chat",
    [
      "Reply with exactly: ATTACH-OK",
      "flash",
      "true",
      "false",
      "",
      "notes.txt",
      attachContent,
    ],
    240000,
  );
  const attachVal = validateChatResponse(attachChat.data || { error: attachChat.error }, {
    expectExact: true,
    exactText: "ATTACH-OK",
    expectAttachments: true,
  });
  recordStep(steps, {
    name: "googlegemini/chat (attachment)",
    status: attachVal.ok ? "pass" : "fail",
    errors: attachVal.errors,
    data: attachVal.data,
  });
}

settleApp();
openGeminiPath("/search");

const searchRecent = runSiteWithRetry("googlegemini/search", ["", "5", "0"], { timeoutMs: 120000 });
const searchRecentVal = validateSearchResponse(
  searchRecent.data || { error: searchRecent.error },
  { mode: "recent" },
);
recordStep(steps, {
  name: "googlegemini/search (recent)",
  status: searchRecentVal.ok ? "pass" : "fail",
  errors: searchRecentVal.errors,
  data: searchRecentVal.data,
});

const searchResolve = runSiteWithRetry("googlegemini/search", ["*", "5", "1"], { timeoutMs: 120000 });
const searchResolveVal = validateSearchResponse(
  searchResolve.data || { error: searchResolve.error },
  { mode: "recent", expectResolvedId: true },
);
recordStep(steps, {
  name: "googlegemini/search (* resolve)",
  status: searchResolveVal.ok ? "pass" : "fail",
  errors: searchResolveVal.errors,
  data: searchResolveVal.data,
});

settleApp();
openGeminiPath("/library");

const library = runSiteWithRetry("googlegemini/library", ["all", "5"], { timeoutMs: 120000 });
const libraryVal = validateLibraryResponse(library.data || { error: library.error });
recordStep(steps, {
  name: "googlegemini/library",
  status: libraryVal.ok ? "pass" : "fail",
  errors: libraryVal.errors,
  data: libraryVal.data,
});

if (!conversationId) {
  recordStep(steps, {
    name: "googlegemini/branch",
    status: "skip",
    skipReason: "no conversationId from chat",
  });
} else {
  runBunBrowser(["open", `https://gemini.google.com/app/${conversationId}`, "--tab", tabIdx], {
    timeoutMs: 30000,
  });
  spawnSync("sleep", ["3"]);

  const branch = runSiteWithRetry("googlegemini/branch", [conversationId], { timeoutMs: 90000 });
  const branchVal = validateBranchResponse(branch.data || { error: branch.error }, {
    sourceConversationId: conversationId,
  });
  if (branchVal.ok && branchVal.data?.conversationId) {
    branchedConversationId = branchVal.data.conversationId;
  }
  recordStep(steps, {
    name: "googlegemini/branch",
    status: branchVal.ok ? "pass" : "fail",
    errors: branchVal.errors,
    data: branchVal.data,
    branchedConversationId,
  });

  if (branchedConversationId) {
    openConversation(branchedConversationId);
    waitForSubmitReady();

    const branchFollowResult = retryExactIfGenerating(
      "googlegemini/chatfollow",
      [
        branchedConversationId,
        `Reply with exactly: BRANCH-${FLOW_ID}`,
        "flash",
        "false",
        "",
        "",
        "",
        "",
        "120000",
      ],
      `BRANCH-${FLOW_ID}`,
    );
    const branchFollowVal = branchFollowResult.val;
    recordStep(steps, {
      name: "googlegemini/chatfollow (branched)",
      status: branchFollowVal.ok ? "pass" : "fail",
      errors: branchFollowVal.errors?.length
        ? branchFollowVal.errors
        : branchFollowResult.run.error
          ? [branchFollowResult.run.error]
          : [],
      data: branchFollowVal.data,
    });
  }
}

writeReport(steps);

function writeReport(allSteps) {
  const summary = {
    flowId: FLOW_ID,
    testedAt: new Date().toISOString(),
    conversationId,
    branchedConversationId,
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
