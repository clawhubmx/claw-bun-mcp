#!/usr/bin/env bun
/**
 * Run grok/example/test2.txt on Notion AI across multiple browser tabs (parallel).
 *
 * Usage:
 *   bun notion/example/test-models-test2.mjs
 *   bun notion/example/test-models-test2.mjs --tabs 0,1,2 --models grok,gemini,deepseek
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const PROMPT_PATH = join(ROOT, "grok/example/test2.txt");
const OUT_PATH = join(__dirname, "test2-results.json");
const AI_URL = "https://app.notion.com/ai";

const MODELS = [
  { alias: "grok", title: "Grok 4.3" },
  { alias: "gemini", title: "Gemini 3.1 Pro" },
  { alias: "deepseek", title: "DeepSeek V4 Pro" },
  { alias: "sonnet", title: "Sonnet 4.6" },
  { alias: "gpt-5.4", title: "GPT-5.4" },
  { alias: "kimi", title: "Kimi K2.6" },
  { alias: "grok-build", title: "Grok Build 0.1" },
];

const args = process.argv.slice(2);
const tabsArg = args.includes("--tabs")
  ? args[args.indexOf("--tabs") + 1].split(",").map((s) => s.trim())
  : null;
const modelsArg = args.includes("--models")
  ? args[args.indexOf("--models") + 1].split(",").map((s) => s.trim())
  : null;
const tabCount = tabsArg ? tabsArg.length : 3;

const prompt = readFileSync(PROMPT_PATH, "utf8");
const CHAT_TIMEOUT_MS = 900000;

function runSync(argv, timeoutMs = 180000) {
  const full = ["bun", CLI, ...argv, "--json"];
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  return {
    cmd: full.join(" "),
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
      return parsed.success ? parsed.data : { error: parsed.error, hint: parsed.hint };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 500) };
  }
}

function unwrapEval(data) {
  if (data?.result && typeof data.result === "object") return data.result;
  return data;
}

function listTabs() {
  const data = parseJson(runSync(["tab", "list"], 30000).stdout);
  return data?.tabs || [];
}

function ensureTabs(count) {
  let tabs = listTabs();
  while (tabs.length < count) {
    console.log(`Opening tab ${tabs.length + 1}/${count}: ${AI_URL}`);
    runSync(["tab", "new", AI_URL], 30000);
    spawnSync("sleep", ["5"]);
    tabs = listTabs();
  }
  return tabs;
}

function resetAiLanding(tabRef) {
  runSync(["open", AI_URL, "--tab", tabRef], 30000);
  spawnSync("sleep", ["5"]);
}

function selectModel(tabRef, title) {
  const js = `(async function() {
    var KNOWN = ['Auto','Sonnet 4.6','Opus 4.7','Opus 4.8','Fable 5','Gemini 3.1 Pro','GPT-5.2','GPT-5.4','GPT-5.5','Grok 4.3','Grok Build 0.1','Kimi K2.6','DeepSeek V4 Pro'];
    var editor = document.querySelector('[contenteditable=true][role=textbox]');
    var picker = null;
    if (editor) {
      var node = editor.parentElement;
      for (var d = 0; d < 12 && node; d++) {
        var btns = Array.prototype.slice.call(node.querySelectorAll('button,[role=button]'));
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].innerText || btns[i].textContent || '').trim();
          if (KNOWN.indexOf(t) >= 0 && btns[i].offsetParent !== null) { picker = btns[i]; break; }
        }
        if (picker) break;
        node = node.parentElement;
      }
    }
    if (!picker) return { ok: false, error: 'picker not found' };
    var current = (picker.innerText || picker.textContent || '').trim();
    var target = ${JSON.stringify(title)};
    if (current === target) return { ok: true, modeTitle: target, label: target };
    picker.click();
    await new Promise(function(r) { setTimeout(r, 900); });
    var items = Array.prototype.slice.call(document.querySelectorAll('[role=menuitem],[role=option]'));
    var match = items.find(function(el) { return (el.innerText || el.textContent || '').trim() === target; });
    if (!match) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, error: 'menu item not found', target: target, menuItems: items.map(function(el) { return (el.innerText || '').trim(); }).slice(0, 20) };
    }
    match.click();
    await new Promise(function(r) { setTimeout(r, 500); });
    return { ok: true, modeTitle: target, label: target };
  })()`;
  return unwrapEval(parseJson(runSync(["eval", js, "--tab", tabRef], 30000).stdout));
}

function runChatOnce(tabRef, modelAlias) {
  const full = ["bun", CLI, "site", "notion/chat", prompt, "--model", modelAlias, "--newChat", "true", "--tab", tabRef, "--json"];
  return new Promise((resolve) => {
    const child = spawn(full[0], full.slice(1), {
      encoding: "utf8",
      timeout: CHAT_TIMEOUT_MS,
      maxBuffer: 30 * 1024 * 1024,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("close", (status, signal) => {
      resolve({
        cmd: full.join(" "),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        status,
        timedOut: signal === "SIGTERM",
        data: parseJson(stdout.trim()),
      });
    });
    child.on("error", (err) => {
      resolve({ data: { error: String(err) }, timedOut: false });
    });
  });
}

async function runChat(tabRef, modelAlias, title, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    resetAiLanding(tabRef);
    const selection = selectModel(tabRef, title);
    if (!selection?.ok) {
      if (attempt < maxAttempts) {
        console.log(`[tab ${tabRef}] picker retry ${attempt}/${maxAttempts - 1}`);
        spawnSync("sleep", ["3"]);
        continue;
      }
      return { tab: tabRef, selection, data: { error: selection?.error || "selection failed" }, attempt };
    }
    const chat = await runChatOnce(tabRef, modelAlias);
    const data = chat.data || {};
    const err = data.error;
    if (err === "Navigation required" && attempt < maxAttempts) {
      console.log(`[tab ${tabRef}] retry ${attempt}/${maxAttempts - 1} after navigation`);
      continue;
    }
    if (err === "Still generating" && data.conversationId) {
      console.log(`[tab ${tabRef}] still generating — polling with waitOnly`);
      const poll = await runChatWaitOnly(tabRef);
      if (poll.data?.answer) return { tab: tabRef, ...poll, selection, attempt };
    }
    return { tab: tabRef, ...chat, selection, attempt };
  }
  return { tab: tabRef, data: { error: "max attempts exceeded" } };
}

function runChatWaitOnly(tabRef) {
  const full = ["bun", CLI, "site", "notion/chat", "x", "auto", "true", "false", "true", "--tab", tabRef, "--json"];
  return new Promise((resolve) => {
    const child = spawn(full[0], full.slice(1), {
      encoding: "utf8",
      timeout: CHAT_TIMEOUT_MS,
      maxBuffer: 30 * 1024 * 1024,
    });
    let stdout = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.on("close", (status, signal) => {
      resolve({
        stdout: stdout.trim(),
        status,
        timedOut: signal === "SIGTERM",
        data: parseJson(stdout.trim()),
      });
    });
    child.on("error", (err) => resolve({ data: { error: String(err) } }));
  });
}

function resolveJobs(tabs) {
  const selectedTabs = tabsArg
    ? tabsArg.map((ref) => {
        const byShort = tabs.find((t) => t.tab === ref);
        const byIndex = tabs.find((t) => String(t.index) === ref);
        const tab = byShort || byIndex;
        if (!tab) throw new Error(`Tab not found: ${ref}`);
        return tab;
      })
    : tabs.slice(0, tabCount);

  const defaultModels = MODELS.slice(0, selectedTabs.length);
  const chosen = modelsArg
    ? modelsArg.map((alias) => {
        const m = MODELS.find((x) => x.alias === alias);
        if (!m) throw new Error(`Unknown model alias: ${alias}`);
        return m;
      })
    : defaultModels;

  if (chosen.length < selectedTabs.length) {
    throw new Error(`Need ${selectedTabs.length} models for ${selectedTabs.length} tabs`);
  }

  return selectedTabs.map((tab, i) => ({
    tabRef: tab.tab,
    tabIndex: tab.index,
    ...chosen[i],
  }));
}

async function main() {
  spawnSync("cp", ["-r", join(ROOT, "notion"), join(process.env.HOME, ".bun-browser/claw-bun-mcp/")]);

  const tabs = ensureTabs(tabCount);
  console.log(`Tabs (${tabs.length}):`, tabs.map((t) => `#${t.index} ${t.tab} ${t.url}`).join("\n  "));

  const jobs = resolveJobs(tabs);
  console.log(`\nTesting ${PROMPT_PATH} on ${jobs.length} tabs in parallel\n`);

  const results = {
    startedAt: new Date().toISOString(),
    promptFile: PROMPT_PATH,
    tabs: jobs.map((j) => ({ index: j.tabIndex, shortId: j.tabRef })),
    runs: [],
  };
  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));

  const settled = await Promise.all(
    jobs.map(async ({ tabRef, tabIndex, alias, title }) => {
      console.log(`[tab ${tabRef}/#${tabIndex}] starting ${alias} (${title})`);
      const chat = await runChat(tabRef, alias, title);
      const data = chat.data || {};
      const entry = {
        tab: tabRef,
        tabIndex,
        alias,
        title,
        attempt: chat.attempt,
        model: data.model,
        modeLabel: data.modeLabel,
        conversationId: data.conversationId,
        error: data.error,
        answer: data.answer,
        answerJson: data.answerJson,
        answerPreview: data.answer ? String(data.answer).slice(0, 400) : null,
        timedOut: chat.timedOut,
        selection: chat.selection,
      };
      console.log(
        `[tab ${tabRef}] ${entry.error ? `ERROR: ${entry.error}` : `OK (${(entry.answer || "").length} chars)`}`,
      );
      if (entry.answerPreview) console.log(`[tab ${tabRef}] ${entry.answerPreview.slice(0, 180)}...`);
      return entry;
    }),
  );

  results.runs = settled;
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
