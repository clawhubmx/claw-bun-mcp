#!/usr/bin/env bun
/**
 * Live test: notion/models and notion/chat/chatfollow close the model picker
 * and restore composer focus after each step.
 *
 * Flow:
 *   1. notion/models
 *   2. notion/chat (new chat, auto)
 *   3. notion/chatfollow x3 (auto follow-ups in same thread)
 *
 * Usage:
 *   bun notion/scripts/test-models-focus-live.mjs
 *   bun notion/scripts/test-models-focus-live.mjs --no-sync
 *   bun notion/scripts/test-models-focus-live.mjs --tab ab12
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INSTALL_NOTION = join(process.env.HOME || "", ".bun-browser/claw-bun-mcp/notion");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const AI_URL = "https://app.notion.com/ai";
const OUT_DIR = join(ROOT, "example/models-focus-live/runs");

const INITIAL_PROMPT = "What is 17+25? Reply with just the number.";
const FOLLOW_UP_PROMPTS = [
  "Add 10 to that result. Reply with just the number.",
  "Multiply that by 2. Reply with just the number.",
  "Is the result even? Reply yes or no only.",
];

const args = process.argv.slice(2);
const noSync = args.includes("--no-sync");
const tabArg = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 90000;

const HELPERS_VERSION = Number(
  readFileSync(join(ROOT, "chat-helpers.js"), "utf8").match(/HELPERS_VERSION = (\d+)/)?.[1] || 0,
);

const ADAPTER_FILES = ["models.js", "chat.js", "chatfollow.js", "mode.js", "tab-probe.js"];

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

function run(parts, timeoutMs = 180000, tab = null) {
  const argv = ["bun", CLI, ...parts, "--json"];
  if (tab != null) argv.push("--tab", String(tab));
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  return {
    argv: argv.join(" "),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
    stderr,
    data: parseCliJson(stdout),
    raw: stdout,
  };
}

function syncAdaptersToInstall() {
  if (!existsSync(INSTALL_NOTION)) {
    throw new Error(`Install dir missing: ${INSTALL_NOTION}. Run: bun-browser site update`);
  }
  for (const file of ADAPTER_FILES) {
    cpSync(join(ROOT, file), join(INSTALL_NOTION, file));
  }
  const installed = Number(
    readFileSync(join(INSTALL_NOTION, "models.js"), "utf8").match(/HELPERS_VERSION = (\d+)/)?.[1] || 0,
  );
  if (installed !== HELPERS_VERSION) {
    throw new Error(`Sync failed: install models.js v${installed}, workspace v${HELPERS_VERSION}`);
  }
}

function findNotionTab() {
  const listed = run(["tab", "list"], 30000);
  const tabs = listed.data?.tabs || [];
  const match = tabs.find((t) => {
    try {
      const host = new URL(t.url).hostname;
      return host === "app.notion.com" || host.endsWith(".notion.so");
    } catch {
      return false;
    }
  });
  return match?.tab || match?.tabId || null;
}

function openNotionTab() {
  const opened = run(["tab", "new", AI_URL], 60000);
  const shortId = opened.data?.tab || String(opened.data?.tabId || "").slice(-4).toLowerCase();
  if (!shortId) throw new Error("tab new did not return tab id");
  for (let i = 0; i < 25; i++) {
    spawnSync("sleep", ["1"]);
    const health = run(["site", "notion/health"], 30000, shortId);
    if (health.data?.ok === true || health.data?.loggedIn === true) break;
  }
  spawnSync("sleep", ["2"]);
  return shortId;
}

const FOCUS_PROBE = `(function() {
  var h = globalThis.__notionAiChatHelpers;
  var picker = h && h.findModelPickerButton ? h.findModelPickerButton() : document.querySelector('[data-testid="unified-chat-model-button"]');
  var editor = h && h.getChatInput ? h.getChatInput() : null;
  var active = document.activeElement;
  var pickerFocused = !!(picker && (active === picker || picker.contains(active)));
  var editorFocused = !!(editor && (active === editor || editor.contains(active)));
  var menuOpen = h && h.isModelPickerMenuOpen ? h.isModelPickerMenuOpen(picker) : false;
  return {
    helpersVersion: h ? h.version : null,
    menuOpen: menuOpen,
    pickerFocused: pickerFocused,
    editorFocused: editorFocused,
    hasPicker: !!picker,
    hasEditor: !!editor,
    activeTag: active ? active.tagName : null,
    activeTestId: active ? active.getAttribute('data-testid') : null,
    pickerExpanded: picker ? picker.getAttribute('aria-expanded') : null,
    url: location.href
  };
})()`;

function unwrapEvalData(data) {
  if (data && typeof data === "object" && data.result != null && typeof data.result === "object") {
    return data.result;
  }
  return data;
}

function validateModels(data) {
  const errors = [];
  if (data?.error) errors.push(String(data.error));
  if (!Array.isArray(data?.models) || data.models.length < 2) {
    errors.push("models list too short");
  }
  return { ok: errors.length === 0, errors };
}

function validateChat(data) {
  const errors = [];
  if (data?.error) errors.push(String(data.error));
  if (!data?.conversationId) errors.push("missing conversationId");
  if (!String(data?.answer || "").trim()) errors.push("empty answer");
  return { ok: errors.length === 0, errors };
}

function validateFocusProbe(probe) {
  const errors = [];
  if (probe?.error) errors.push(String(probe.error));
  if (probe?.helpersVersion !== HELPERS_VERSION) {
    errors.push(`helpersVersion expected ${HELPERS_VERSION}, got ${probe?.helpersVersion}`);
  }
  if (probe?.menuOpen) errors.push("model picker menu still open");
  if (probe?.pickerFocused) errors.push("model picker still focused");
  if (probe?.pickerExpanded === "true") errors.push('picker aria-expanded still "true"');
  if (probe?.hasEditor && !probe?.editorFocused) {
    errors.push("chat composer not focused");
  }
  return { ok: errors.length === 0, errors };
}

function runFocusProbe(tab, stepName, report) {
  spawnSync("sleep", ["0.5"]);
  const probeRun = run(["eval", FOCUS_PROBE], 60000, tab);
  const probe = unwrapEvalData(probeRun.data || { error: probeRun.error || "empty probe" });
  const probeVal = validateFocusProbe(probe);
  report.steps.push({
    name: stepName,
    status: probeVal.ok ? "pass" : "fail",
    errors: probeVal.errors,
    probe,
    argv: probeRun.argv,
  });
  if (!probeVal.ok) throw new Error(`${stepName}: ${probeVal.errors.join("; ")}`);
  return probe;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const runId = `MODELS-FOCUS-${Date.now().toString(36).toUpperCase()}`;
  const report = {
    runId,
    at: new Date().toISOString(),
    helpersVersion: HELPERS_VERSION,
    synced: !noSync,
    model: "auto",
    prompts: [INITIAL_PROMPT, ...FOLLOW_UP_PROMPTS],
    steps: [],
  };

  try {
    if (!noSync) {
      syncAdaptersToInstall();
      report.steps.push({ name: "sync-adapters", status: "pass", installDir: INSTALL_NOTION });
    }

    let tab = tabArg || findNotionTab();
    if (!tabArg) {
      tab = openNotionTab();
      report.steps.push({ name: "open-fresh-tab", status: "pass", tab, url: AI_URL });
    } else {
      report.steps.push({ name: "resolve-tab", status: "pass", tab });
    }
    report.tab = tab;

    const modelsRun = run(["site", "notion/models"], 120000, tab);
    const modelsVal = validateModels(modelsRun.data || { error: modelsRun.error || "empty" });
    report.steps.push({
      name: "notion/models",
      status: modelsVal.ok ? "pass" : "fail",
      errors: modelsVal.errors,
      modelCount: modelsRun.data?.models?.length || 0,
      current: modelsRun.data?.current || null,
      argv: modelsRun.argv,
    });
    if (!modelsVal.ok) throw new Error(modelsVal.errors.join("; "));
    runFocusProbe(tab, "focus-probe-after-models", report);

    const chatRun = run(
      ["site", "notion/chat", INITIAL_PROMPT, "--model", "auto", "--maxWaitMs", String(maxWaitMs)],
      maxWaitMs + 60000,
      tab,
    );
    const chatVal = validateChat(chatRun.data || { error: chatRun.error || "empty chat" });
    report.steps.push({
      name: "notion/chat",
      status: chatVal.ok ? "pass" : "fail",
      errors: chatVal.errors,
      conversationId: chatRun.data?.conversationId || null,
      answerPreview: String(chatRun.data?.answer || "").slice(0, 120),
      argv: chatRun.argv,
    });
    if (!chatVal.ok) throw new Error(chatVal.errors.join("; "));
    runFocusProbe(tab, "focus-probe-after-chat", report);

    let conversationId = chatRun.data.conversationId;
    for (let i = 0; i < FOLLOW_UP_PROMPTS.length; i++) {
      const prompt = FOLLOW_UP_PROMPTS[i];
      const followRun = run(
        ["site", "notion/chatfollow", conversationId, prompt, "--model", "auto", "--maxWaitMs", String(maxWaitMs)],
        maxWaitMs + 60000,
        tab,
      );
      const followVal = validateChat(followRun.data || { error: followRun.error || "empty follow-up" });
      report.steps.push({
        name: `notion/chatfollow-${i + 1}`,
        status: followVal.ok ? "pass" : "fail",
        errors: followVal.errors,
        conversationId: followRun.data?.conversationId || conversationId,
        answerPreview: String(followRun.data?.answer || "").slice(0, 120),
        argv: followRun.argv,
      });
      if (!followVal.ok) throw new Error(`chatfollow ${i + 1}: ${followVal.errors.join("; ")}`);
      if (followRun.data?.conversationId) conversationId = followRun.data.conversationId;
      runFocusProbe(tab, `focus-probe-after-chatfollow-${i + 1}`, report);
    }

    report.conversationId = conversationId;
    report.ok = true;
    report.summary =
      "notion/models plus chat with 3 auto follow-ups closed picker and restored composer focus after each step";
  } catch (err) {
    report.ok = false;
    report.error = err instanceof Error ? err.message : String(err);
    report.summary = "live focus test failed";
  }

  const outPath = join(OUT_DIR, `${runId}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  process.exit(report.ok ? 0 : 1);
}

main();
