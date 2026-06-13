#!/usr/bin/env bun
/**
 * Model selection batch: 10 models, fresh Notion AI tab each.
 *
 * Default (--selectOnly, implicit): open chat, select model, validate modeLabel only.
 * Optional --withChat: after selection, submit a prompt and check answer token (uses positional maxWaitMs).
 *
 * Usage:
 *   bun notion/scripts/test-model-selection-10.mjs
 *   bun notion/scripts/test-model-selection-10.mjs --maxWaitMs 5000 --withChat
 *   bun notion/scripts/test-model-selection-10.mjs --dry-run
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT_DIR = join(ROOT, "example/model-selection-runs");
const AI_URL = "https://app.notion.com/ai";
const HELPERS_VERSION = Number(
  readFileSync(join(ROOT, "chat-helpers.js"), "utf8").match(/HELPERS_VERSION = (\d+)/)?.[1] || 0,
);

const MODELS = [
  { alias: "auto", title: "Auto" },
  { alias: "sonnet", title: "Sonnet 4.6" },
  { alias: "opus", title: "Opus 4.7" },
  { alias: "fable", title: "Fable 5" },
  { alias: "gemini", title: "Gemini 3.1 Pro" },
  { alias: "gpt-5.2", title: "GPT-5.2" },
  { alias: "gpt-5.4", title: "GPT-5.4" },
  { alias: "grok", title: "Grok 4.3" },
  { alias: "kimi", title: "Kimi K2.6" },
  { alias: "deepseek", title: "DeepSeek V4 Pro" },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const withChat = args.includes("--withChat");
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 90000;
const pauseMs = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : 1500;

const RUN_ID = `MODEL-SEL-${Date.now().toString(36).toUpperCase()}`;

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
  return {
    argv: argv.join(" "),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
    data: parseCliJson(stdout),
  };
}

function openFreshNotionTab() {
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

function answerContainsToken(answer, token) {
  const text = String(answer || "").replace(/\s+/g, "");
  const want = String(token || "").replace(/\s+/g, "");
  return text.includes(want);
}

function validateSelectOnly(data, expectedTitle) {
  const errors = [];
  if (data?.error) errors.push(String(data.error));
  if (!data?.selected) errors.push("selected missing");
  if (expectedTitle && data?.modeLabel !== expectedTitle) {
    errors.push(`modeLabel must be "${expectedTitle}", got "${data?.modeLabel}"`);
  }
  return { ok: errors.length === 0, errors };
}

function validateChat(data, expectedTitle, token) {
  const errors = [];
  if (data?.error) errors.push(String(data.error));
  if (!data?.answer) errors.push("answer missing");
  if (expectedTitle && data?.modeLabel !== expectedTitle) {
    errors.push(`modeLabel must be "${expectedTitle}", got "${data?.modeLabel}"`);
  }
  if (!answerContainsToken(data?.answer, token)) {
    errors.push(`answer must contain token "${token}"`);
  }
  return { ok: errors.length === 0, errors };
}

function runSelectOnly(tab, alias) {
  // query → model → newChat → selectOnly → waitOnly
  return run(["site", "notion/chat", "", alias, "true", "true", "false"], 120000, tab);
}

function runChat(tab, prompt, alias) {
  // maxWaitMs at positional index 6 (index 5 reserved empty)
  return run(
    ["site", "notion/chat", prompt, alias, "true", "false", "false", "", String(maxWaitMs)],
    maxWaitMs + 120000,
    tab,
  );
}

if (dryRun) {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Dry run (${RUN_ID}) — ${MODELS.length} models, selectOnly=${!withChat ? "yes" : "with --withChat"}\n`);
  for (const [i, m] of MODELS.entries()) {
    console.log(`${i + 1}. ${m.alias} (${m.title})${withChat ? ` → "OK-${String(i + 1).padStart(2, "0")}"` : ""}`);
  }
  process.exit(0);
}

const status = run(["status"], 15000);
if (status.status !== 0 || status.data?.running !== true) {
  console.error("bun-browser daemon is not running. Start with: bun-browser start");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];

console.log(
  `Model selection batch (${RUN_ID}) selectOnly=${withChat ? "no+chat" : "yes"} maxWaitMs=${withChat ? maxWaitMs : "n/a"}\n`,
);

for (let i = 0; i < MODELS.length; i++) {
  const m = MODELS[i];
  const token = `OK-${String(i + 1).padStart(2, "0")}`;
  const prompt = `Reply with exactly: ${token}`;
  const row = {
    index: i + 1,
    alias: m.alias,
    expectedTitle: m.title,
    token: withChat ? token : null,
    tab: null,
    select: null,
    chat: null,
    ok: false,
  };

  console.log(`[${i + 1}/${MODELS.length}] ${m.alias} — opening tab`);
  row.tab = openFreshNotionTab();

  console.log(`[${i + 1}/${MODELS.length}] ${m.alias} — selectOnly (${row.tab})`);
  const selectRun = runSelectOnly(row.tab, m.alias);
  const selectVal = validateSelectOnly(
    selectRun.data || { error: selectRun.timedOut ? "timeout" : "empty" },
    m.title,
  );
  row.select = {
    modeLabel: selectRun.data?.modeLabel,
    modeTitle: selectRun.data?.modeTitle,
    selected: selectRun.data?.selected,
    error: selectRun.data?.error || (selectRun.timedOut ? "timeout" : null),
    errors: selectVal.errors,
  };

  let chatVal = { ok: true, errors: [] };
  if (withChat) {
    console.log(`[${i + 1}/${MODELS.length}] ${m.alias} — chat (${row.tab})`);
    const chatRun = runChat(row.tab, prompt, m.alias);
    chatVal = validateChat(
      chatRun.data || { error: chatRun.timedOut ? "timeout" : "empty" },
      m.title,
      token,
    );
    row.chat = {
      modeLabel: chatRun.data?.modeLabel,
      answer: chatRun.data?.answer?.slice?.(0, 200) || chatRun.data?.answer,
      error: chatRun.data?.error || (chatRun.timedOut ? "timeout" : null),
      errors: chatVal.errors,
    };
  }

  row.ok = selectVal.ok && chatVal.ok;
  const detail = row.select.error || row.chat?.error || row.select.modeLabel || row.chat?.answer || "";
  console.log(`  ${row.ok ? "PASS" : "FAIL"} select=${row.select.modeLabel || "?"}${withChat ? ` chat=${row.chat?.modeLabel || "?"}` : ""} ${detail}\n`);

  results.push(row);
  if (pauseMs > 0 && i < MODELS.length - 1) spawnSync("sleep", [String(Math.ceil(pauseMs / 1000))]);
}

const summary = {
  runId: RUN_ID,
  startedAt,
  finishedAt: new Date().toISOString(),
  helpersVersion: HELPERS_VERSION,
  withChat,
  maxWaitMs: withChat ? maxWaitMs : null,
  totals: {
    pass: results.filter((r) => r.ok).length,
    total: results.length,
  },
  results,
};

const outPath = join(OUT_DIR, `run-${startedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log("Summary");
console.log(`  pass: ${summary.totals.pass}/${summary.totals.total}`);
console.log(`  report: ${outPath}`);

process.exit(summary.totals.pass === summary.totals.total ? 0 : 1);
