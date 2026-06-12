#!/usr/bin/env bun
/**
 * Measure how fast reply capture can be: 3 prompts in one tab eval (no per-prompt CLI spawn).
 *
 * Usage:
 *   bun notion/scripts/test-fast-capture-timing.mjs
 *   bun notion/scripts/test-fast-capture-timing.mjs --tab 4518
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const OUT_DIR = join(ROOT, "notion/example/fast-capture-runs");

const PROMPTS = [
  "What is 17+25? Reply with just the number.",
  "Name one planet. One word only.",
  "Capital of Japan? One word.",
];

const args = process.argv.slice(2);
let activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 60000;
const pollMs = args.includes("--pollMs") ? Number(args[args.indexOf("--pollMs") + 1]) : 200;

mkdirSync(OUT_DIR, { recursive: true });

function run(argv, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv];
  if (activeTab != null) full.push("--tab", activeTab);
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
    return { error: "invalid json", raw: stdout.slice(0, 800) };
  }
}

function unwrapEval(data) {
  if (data?.result && typeof data.result === "object") return data.result;
  return data;
}

const evalJs = `(async function(){
  var h = globalThis.__notionAiChatHelpers;
  if (!h) return { error: 'helpers missing', hint: 'Run notion/chat --selectOnly true on this tab first' };

  var prompts = ${JSON.stringify(PROMPTS)};
  var maxWaitMs = ${maxWaitMs};
  var pollMs = ${pollMs};
  var runs = [];

  async function runOne(query, isFollow) {
    var t0 = Date.now();
    var milestones = [];

    function mark(label) {
      milestones.push({ label: label, ms: Date.now() - t0 });
    }

    if (!isFollow) {
      var newChat = await h.ensureNewChatView({ maxWaitMs: 15000 });
      if (!newChat.ok) return { error: newChat.error || 'new chat failed', milestones: milestones };
      mark('newChat');
      var mode = await h.setNotionMode('auto');
      if (!mode.ok) return { error: mode.error || 'mode failed', milestones: milestones };
      mark('mode');
    }

    await h.drainUrlTrustPrompts();
    mark('drainTrust');

    var beforeCount = h.getAssistantMessagesSinceLastUser().length;
    var beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\\n');

    if (!h.setChatInput(query)) return { error: 'input not found', milestones: milestones };
    mark('inputFilled');
    await h.sleep(150);
    if (!h.clickSubmit()) return { error: 'submit failed', milestones: milestones };
    mark('submitted');

    var waitStart = Date.now();
    var captured = await h.waitForAssistantAnswer(beforeCount, beforeText, { query: query, maxWaitMs: maxWaitMs, pollMs: pollMs });
    var captureMs = Date.now() - t0;
    milestones.push({ label: 'waitForAssistantAnswer', ms: captureMs, waitLoopMs: Date.now() - waitStart });

    return {
      query: query,
      answer: captured || '',
      ok: !!captured,
      totalMs: Date.now() - t0,
      captureMs: captureMs,
      milestones: milestones,
      conversationId: h.getConversationId(),
      tabHidden: document.hidden,
    };
  }

  var results = [];
  for (var i = 0; i < prompts.length; i++) {
    results.push(await runOne(prompts[i], i > 0));
    await h.sleep(800);
  }
  return {
    helpersVersion: h.version || null,
    pollMs: pollMs,
    maxWaitMs: maxWaitMs,
    results: results,
  };
})()`;

if (!activeTab) {
  const open = run(["open", "https://app.notion.com/ai"], 60000);
  const openData = unwrapEval(parseJson(open.stdout));
  activeTab = openData?.tabId || openData?.id;
  if (!activeTab) {
    console.error("Failed to open tab:", open.stderr || open.stdout);
    process.exit(1);
  }
  console.log("Opened tab:", activeTab);
  await Bun.sleep(10000);
}

console.log("Bootstrapping helpers (selectOnly)...");
const boot = run(["site", "notion/chat", "--selectOnly", "true", "--model", "auto"], 90000);
const bootData = unwrapEval(parseJson(boot.stdout));
if (bootData?.error) {
  console.error("Bootstrap failed:", bootData.error, bootData.hint || "");
  process.exit(1);
}

console.log(`Running 3-prompt fast capture on tab ${activeTab} (pollMs=${pollMs})...`);
const tStart = Date.now();
const evalResult = run(["eval", evalJs], maxWaitMs * 3 + 120000);
const wallMs = Date.now() - tStart;
const data = unwrapEval(parseJson(evalResult.stdout));

const out = {
  tab: activeTab,
  wallMs,
  pollMs,
  maxWaitMs,
  status: evalResult.status,
  timedOut: evalResult.timedOut,
  data,
  stderr: evalResult.stderr || null,
};

writeFileSync(join(OUT_DIR, "timing.json"), JSON.stringify(out, null, 2));

if (data?.results) {
  console.log("\n=== Fast capture timing ===");
  console.log(`helpers v${data.helpersVersion ?? "?"}  poll=${pollMs}ms  wall=${wallMs}ms\n`);
  for (const r of data.results) {
    const status = r.ok ? "OK" : "FAIL";
    console.log(
      `[${status}] ${r.captureMs ?? r.totalMs}ms capture | tabHidden=${r.tabHidden ?? "?"} | ${JSON.stringify(r.answer?.slice(0, 40))}`
    );
    if (r.error) console.log("  error:", r.error);
  }
} else {
  console.error("Eval failed:", data?.error || evalResult.stderr || evalResult.stdout?.slice(0, 500));
  process.exit(1);
}
