#!/usr/bin/env bun
/**
 * Run grok/example/test1.txt against multiple Notion AI models.
 *
 * Usage:
 *   bun notion/example/test-models-test1.mjs --tab 9240
 *   bun notion/example/test-models-test1.mjs --tab 9240 --models sonnet,grok,gemini
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const PROMPT_PATH = join(ROOT, "grok/example/test1.txt");
const OUT_PATH = join(__dirname, "test1-results.json");

const MODELS = [
  { alias: "sonnet", title: "Sonnet 4.6" },
  { alias: "opus", title: "Opus 4.7" },
  { alias: "grok", title: "Grok 4.3" },
  { alias: "gemini", title: "Gemini 3.1 Pro" },
  { alias: "gpt-5.4", title: "GPT-5.4" },
  { alias: "kimi", title: "Kimi K2.6" },
  { alias: "deepseek", title: "DeepSeek V4 Pro" },
];

const args = process.argv.slice(2);
const tabIdx = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const modelsArg = args.includes("--models")
  ? args[args.indexOf("--models") + 1].split(",").map((s) => s.trim())
  : null;
const models = modelsArg
  ? MODELS.filter((m) => modelsArg.includes(m.alias))
  : MODELS;

const prompt = readFileSync(PROMPT_PATH, "utf8");
const CHAT_TIMEOUT_MS = 900000; // 15 min

function run(argv, timeoutMs = 180000) {
  const full = ["bun", CLI, ...argv];
  if (tabIdx != null) full.push("--tab", tabIdx);
  full.push("--json");
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

function resetAiLanding() {
  run(["open", "https://app.notion.com/ai"], 30000);
  spawnSync("sleep", ["4"]);
}

function selectModel(title) {
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
  return unwrapEval(parseJson(run(["eval", js], 30000).stdout));
}

function runChatOnce(modelAlias) {
  const runResult = run(
    ["site", "notion/chat", prompt, "--model", modelAlias, "--newChat", "true"],
    CHAT_TIMEOUT_MS,
  );
  return { run: runResult, data: parseJson(runResult.stdout) };
}

function runChat(modelAlias, title, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    resetAiLanding();
    const selection = selectModel(title);
    if (!selection?.ok) {
      return { selection, data: { error: selection?.error || "selection failed" }, attempt };
    }
    const chat = runChatOnce(modelAlias);
    const err = chat.data?.error;
    if (err === "Navigation required" && attempt < maxAttempts) {
      console.log(`  retry ${attempt}/${maxAttempts - 1} after navigation`);
      continue;
    }
    return { ...chat, selection, attempt };
  }
  return { data: { error: "max attempts exceeded" } };
}

const results = {
  startedAt: new Date().toISOString(),
  promptFile: PROMPT_PATH,
  tab: tabIdx,
  models: [],
};

console.log(`Testing ${models.length} models with ${PROMPT_PATH}\n`);

for (const { alias, title } of models) {
  console.log(`\n=== ${alias} (${title}) ===`);
  const chat = runChat(alias, title);
  const data = chat.data || {};
  if (chat.selection) console.log("select:", JSON.stringify(chat.selection));
  const entry = {
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
    timedOut: chat.run?.timedOut,
  };
  results.models.push(entry);
  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(entry.error ? `ERROR: ${entry.error}` : `OK (${(entry.answer || "").length} chars)`);
  if (entry.answerPreview) console.log(entry.answerPreview.slice(0, 200) + "...");
}

results.finishedAt = new Date().toISOString();
writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
console.log(`\nResults written to ${OUT_PATH}`);
