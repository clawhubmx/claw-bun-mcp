#!/usr/bin/env bun
/**
 * Live clipboard capture validation on a foreground Notion tab.
 *
 * Validates that captureAnswerViaCopy (clipboard / copy-dialog) works when the tab
 * is visible, contrasting with background-tab runs that always fall back to dom.
 *
 * Usage:
 *   bun notion/scripts/test-capture-clipboard-live.mjs --tab <shortId>
 *   bun notion/scripts/test-capture-clipboard-live.mjs --tab <shortId> --require-visible
 *   bun notion/scripts/test-capture-clipboard-live.mjs --tab <shortId> --wait-for-visible 120000
 *
 * Before running: focus the Notion AI tab in Chrome (or use --wait-for-visible).
 *
 * Next step (not implemented here): activate tab via `bun-browser tab select --id`
 * before capture so background tabs can use the clipboard path too.
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
const OUT_DIR = join(ROOT, "notion/example/capture-clipboard-live/runs");

const MARKDOWN_LINK_PROMPT =
  'Reply with exactly one markdown link and nothing else: [Example](https://example.com)';

const COPY_SOURCES = new Set(["copy", "copy-dialog"]);

const args = process.argv.slice(2);
const tab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "auto";
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 45000;
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 2000;
const waitForVisibleMs = args.includes("--wait-for-visible")
  ? Number(args[args.indexOf("--wait-for-visible") + 1])
  : 0;
const requireVisible = args.includes("--require-visible");
const skipMarkdown = args.includes("--skip-markdown");

if (!tab) {
  console.error("Usage: bun notion/scripts/test-capture-clipboard-live.mjs --tab <shortId>");
  console.error("  --require-visible       fail if tab is hidden at start of each run");
  console.error("  --wait-for-visible MS   wait until tab becomes visible");
  console.error("  --skip-markdown         skip markdown-link prompt");
  process.exit(1);
}

const PLAN = [
  { id: "json-control", file: "prompt-01-control-json.txt", expectJson: true, kind: "json" },
  { id: "prose-token", file: "prompt-04-prose-token.txt", expectJson: false, kind: "prose" },
  {
    id: "markdown-link",
    inline: MARKDOWN_LINK_PROMPT,
    expectJson: false,
    kind: "markdown",
    optional: true,
  },
];

function hash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 12);
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

function unwrapEval(data) {
  if (data?.result && typeof data.result === "object") return data.result;
  if (data?.data?.result && typeof data.data.result === "object") return data.data.result;
  return data;
}

function run(argv, tabId, timeoutMs = maxWaitMs + 60000) {
  const full = ["bun", CLI, ...argv, "--tab", tabId, "--json"];
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
}

const visProbeJs = `(function(){
  return {
    hidden: document.hidden,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    url: location.href
  };
})()`;

function getTabVisibility(tabId) {
  return unwrapEval(parseCliJson(run(["eval", visProbeJs], tabId, 15000).stdout));
}

function waitUntilVisible(tabId, label, deadlineMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    const v = getTabVisibility(tabId);
    if (v && v.hidden === false && v.visibility === "visible") {
      console.log(`  ${label}: tab visible after ${Date.now() - t0}ms`);
      return { ok: true, waitedMs: Date.now() - t0, ...v };
    }
    spawnSync("sleep", ["1"]);
  }
  const v = getTabVisibility(tabId);
  return { ok: false, waitedMs: Date.now() - t0, ...v };
}

function ensureVisible(tabId, label) {
  let vis = getTabVisibility(tabId);
  if (vis && vis.hidden === false && vis.visibility === "visible") {
    return { ok: true, visibility: vis, waitedMs: 0 };
  }
  if (waitForVisibleMs > 0) {
    const waited = waitUntilVisible(tabId, label, waitForVisibleMs);
    return { ok: waited.ok, visibility: waited, waitedMs: waited.waitedMs };
  }
  if (requireVisible) {
    return { ok: false, visibility: vis, waitedMs: 0 };
  }
  return { ok: true, visibility: vis, waitedMs: 0, warning: "tab hidden" };
}

function runChat(prompt, tabId) {
  const t0 = Date.now();
  const chatRun = run(
    [
      "site",
      "notion/chat",
      prompt,
      model,
      "true",
      "false",
      "false",
      "",
      String(maxWaitMs),
    ],
    tabId,
    maxWaitMs + 60000,
  );
  let data = parseCliJson(chatRun.stdout);
  if (!data) {
    data = { error: "parse_failed", stdout: (chatRun.stdout || "").slice(0, 500) };
  }
  return {
    elapsedMs: Date.now() - t0,
    timedOut: chatRun.timedOut,
    data,
  };
}

function buildClipboardProbeJs(beforeCount, beforeText) {
  return `(async function(){
  var h = globalThis.__notionAiChatHelpers;
  if (!h) return { error: 'helpers not loaded' };
  var beforeCount = ${beforeCount};
  var beforeText = ${JSON.stringify(beforeText)};
  var copyBtn = h.findCopyButtonForTurn(beforeCount, beforeText);
  var tabState = h.getTabCaptureState();
  var copyText = '';
  var clipboardError = null;
  if (copyBtn) {
    try {
      copyText = await h.captureAnswerViaCopy(copyBtn);
    } catch (e) {
      clipboardError = String(e && e.message ? e.message : e);
    }
  }
  var copySource = h.getLastCaptureSource();
  var domText = h.captureAnswerFromTurnDom(beforeCount, beforeText);
  var domSource = h.getLastCaptureSource();
  return {
    helpersVersion: h.version,
    tabState: tabState,
    hasCopyBtn: !!copyBtn,
    copySource: copySource,
    domSourceAfterDomProbe: domSource,
    copyTextLen: copyText.length,
    domTextLen: domText.length,
    textsMatch: copyText.trim() === domText.trim(),
    copyPreview: copyText.slice(0, 120),
    domPreview: domText.slice(0, 120),
    clipboardAvailable: !!(navigator.clipboard && navigator.clipboard.readText),
    clipboardError: clipboardError,
    hasCompletedReplyActions: h.hasCompletedReplyActions()
  };
})()`;
}

function runClipboardProbe(tabId, beforeCount = 0, beforeText = "") {
  const js = buildClipboardProbeJs(beforeCount, beforeText);
  const probeRun = run(["eval", js], tabId, 30000);
  return unwrapEval(parseCliJson(probeRun.stdout));
}

function contentPass(item, answer, data) {
  if (!answer || !String(answer).trim()) return false;
  const text = String(answer);
  if (item.kind === "json") {
    return !!(data?.answerJson || text.includes('"status"'));
  }
  if (item.kind === "prose") {
    return text.includes("OK-NOTION-FLOW");
  }
  if (item.kind === "markdown") {
    return /\[.+?\]\(.+?\)/.test(text);
  }
  return true;
}

function copyTextValid(probe) {
  if (!probe || !COPY_SOURCES.has(probe.copySource)) return false;
  const preview = String(probe.copyPreview || "").trim();
  if (probe.copyTextLen < 10) return false;
  if (preview === "Copy response" || preview === "Copied") return false;
  return true;
}

function clipboardPathPass(entry) {
  const probe = entry.clipboardProbe;
  const vis = entry.visibilityBefore?.visibility || entry.visibilityBefore;
  const tabVisible = vis && vis.hidden === false && vis.visibility === "visible";
  const probeOk = probe && COPY_SOURCES.has(probe.copySource) && copyTextValid(probe);
  const chatOk = COPY_SOURCES.has(entry.captureSource) && copyTextValid({ ...probe, copySource: entry.captureSource, copyTextLen: entry.answerLen, copyPreview: entry.answerPreview });
  const sourcesMatch =
    !entry.captureSource ||
    !probe?.copySource ||
    entry.captureSource === probe.copySource ||
    (COPY_SOURCES.has(entry.captureSource) && COPY_SOURCES.has(probe.copySource));
  return (
    tabVisible &&
    probe?.hasCopyBtn === true &&
    probeOk &&
    chatOk &&
    sourcesMatch &&
    entry.contentPass
  );
}

const status = spawnSync("bun", [CLI, "status", "--json"], { encoding: "utf8" });
const daemon = parseCliJson(status.stdout || "");
if (daemon?.running !== true) {
  console.error("bun-browser daemon not running");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const runs = [];

const plan = PLAN.filter((item) => !(item.optional && skipMarkdown));

console.log(`Clipboard capture live | tab=${tab} model=${model} requireVisible=${requireVisible}\n`);

console.log("Bootstrapping helpers (selectOnly)...");
run(["site", "notion/chat", "--selectOnly", "true", "--model", "auto"], tab, 90000);

const initialVis = getTabVisibility(tab);
console.log(
  `Initial visibility: hidden=${initialVis?.hidden} visibility=${initialVis?.visibility} focus=${initialVis?.hasFocus}\n`,
);

if (requireVisible && (initialVis?.hidden || initialVis?.visibility !== "visible")) {
  if (waitForVisibleMs <= 0) {
    console.error(
      "Tab is hidden. Focus the Notion tab in Chrome and re-run, or pass --wait-for-visible 120000",
    );
    process.exit(1);
  }
  const waited = waitUntilVisible(tab, "initial", waitForVisibleMs);
  if (!waited.ok) {
    console.error("Tab did not become visible within deadline");
    process.exit(1);
  }
}

for (const item of plan) {
  const prompt = item.file
    ? readFileSync(join(PROBE_DIR, item.file), "utf8").trim()
    : item.inline;

  const visGate = ensureVisible(tab, item.id);
  if (!visGate.ok) {
    console.log(`SKIP ${item.id}: tab not visible (hidden=${visGate.visibility?.hidden})`);
    runs.push({
      id: item.id,
      promptFile: item.file || null,
      kind: item.kind,
      skipped: true,
      reason: "tab_not_visible",
      visibilityBefore: visGate.visibility,
      clipboardPathPass: false,
      contentPass: false,
    });
    continue;
  }

  process.stdout.write(`Running ${item.id}... `);
  const { elapsedMs, timedOut, data } = runChat(prompt, tab);
  const answer = data?.answer ?? null;
  const clipboardProbe = runClipboardProbe(tab, 0, "");
  const visAfter = getTabVisibility(tab);

  const entry = {
    id: item.id,
    promptFile: item.file || null,
    kind: item.kind,
    expectJson: item.expectJson,
    elapsedMs,
    timedOut,
    error: data?.error ?? null,
    captureWarning: data?.captureWarning ?? null,
    answerFormat: data?.answerFormat ?? null,
    captureSource: data?.captureSource ?? null,
    jsonRecovered: data?.jsonRecovered ?? false,
    answerLen: answer ? String(answer).length : 0,
    answerHash: hash(answer),
    answerPreview: answer ? String(answer).slice(0, 120) : null,
    answerJson: data?.answerJson ?? null,
    visibilityBefore: visGate.visibility,
    visibilityAfter: visAfter,
    visibilityGate: visGate,
    clipboardProbe,
    contentPass: contentPass(item, answer, data),
    captureSourceMismatch:
      data?.captureSource &&
      clipboardProbe?.copySource &&
      data.captureSource !== clipboardProbe.copySource,
  };
  entry.clipboardPathPass = clipboardPathPass(entry);
  entry.copyTextValid = copyTextValid(clipboardProbe);
  runs.push(entry);

  const srcChat = entry.captureSource || "?";
  const srcProbe = clipboardProbe?.copySource || "?";
  console.log(
    `${entry.clipboardPathPass ? "OK" : "FAIL"} | ${Math.round(elapsedMs / 1000)}s | chat=${srcChat} probe=${srcProbe} copyValid=${entry.copyTextValid ? "yes" : "no"} | content=${entry.contentPass ? "ok" : "fail"}${entry.error ? ` | err=${entry.error}` : ""}${visGate.warning ? " | hidden" : ""}`,
  );
  if (entry.captureSourceMismatch) {
    console.log(`  mismatch: chat captureSource=${srcChat} vs probe copySource=${srcProbe}`);
  }

  await new Promise((r) => setTimeout(r, pauseMs));
}

const clipboardPathPassCount = runs.filter((r) => r.clipboardPathPass).length;
const contentPassCount = runs.filter((r) => r.contentPass).length;
const copyTextValidCount = runs.filter((r) => r.copyTextValid).length;
const mismatches = runs.filter((r) => r.captureSourceMismatch);
const chatCaptureSources = [...new Set(runs.map((r) => r.captureSource).filter(Boolean))];
const probeCaptureSources = [...new Set(runs.map((r) => r.clipboardProbe?.copySource).filter(Boolean))];

const summary = {
  startedAt,
  tab,
  model,
  requireVisible,
  waitForVisibleMs: waitForVisibleMs || null,
  initialVisibility: initialVis,
  clipboardPathPassCount,
  contentPassCount,
  copyTextValidCount,
  totalRuns: runs.length,
  chatCaptureSources,
  probeCaptureSources,
  captureSourceMismatches: mismatches.length,
  nextStep:
    "Activate tab before capture: bun-browser tab select --id <shortId> (see test-tab-pool-title-watch.mjs selectTab)",
  runs,
};

const outPath = join(OUT_DIR, `run-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

console.log("\n--- Summary ---");
console.log(`Clipboard path: ${clipboardPathPassCount}/${runs.length} passed`);
console.log(`Copy text valid (probe): ${copyTextValidCount}/${runs.length}`);
console.log(`Content checks: ${contentPassCount}/${runs.length} passed`);
console.log(`Chat capture sources: ${chatCaptureSources.join(", ") || "none"}`);
console.log(`Probe capture sources: ${probeCaptureSources.join(", ") || "none"}`);
if (mismatches.length) {
  console.log(`Capture source mismatches: ${mismatches.length}`);
}
console.log(`Written: ${outPath}`);

process.exit(clipboardPathPassCount === runs.length && contentPassCount === runs.length ? 0 : 1);
