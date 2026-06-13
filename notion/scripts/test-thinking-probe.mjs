#!/usr/bin/env bun
/**
 * Thinking / long-prompt probe: 5 prompts with DOM anchor diagnostics.
 *
 * Usage:
 *   bun notion/scripts/test-thinking-probe.mjs
 *   bun notion/scripts/test-thinking-probe.mjs --tab d483 --model opus
 *   bun notion/scripts/test-thinking-probe.mjs --prompt t01-streaming-news --dry-run
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const PROBE_DIR = join(ROOT, "notion/example/thinking-probe");
const PROMPTS_META = join(PROBE_DIR, "prompts.json");
const OUT_DIR = join(PROBE_DIR, "runs");

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: bun notion/scripts/test-thinking-probe.mjs [options]

Options:
  --help              Show help
  --dry-run           Print plan only
  --tab <id>          Browser tab (opens fresh tab per prompt if omitted)
  --model <name>      Model alias (default: sonnet)
  --prompt <id>       Run one prompt id
  --maxPolls <n>      waitOnly polls (default: 4)
  --maxWaitMs <n>     Initial submit timeout
  --pollMaxWaitMs <n> Per-poll timeout
  --pauseMs <n>       Pause between prompts

Output: ${OUT_DIR}/summary.json and anchor-analysis.json
`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const promptFilter = args.includes("--prompt") ? args[args.indexOf("--prompt") + 1] : null;
const maxPollsArg = args.includes("--maxPolls") ? Number(args[args.indexOf("--maxPolls") + 1]) : null;
const pollMaxWaitMsArg = args.includes("--pollMaxWaitMs") ? Number(args[args.indexOf("--pollMaxWaitMs") + 1]) : null;
const maxWaitMsArg = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : null;
const pauseMsArg = args.includes("--pauseMs") ? Number(args[args.indexOf("--pauseMs") + 1]) : null;

const meta = JSON.parse(readFileSync(PROMPTS_META, "utf8"));
const defaults = meta.defaults || {};
const resolvedModel = model || defaults.model || "sonnet";
const maxPolls = maxPollsArg ?? defaults.maxPolls ?? 4;
const pauseMs = pauseMsArg ?? defaults.pauseMs ?? 2500;

function loadPromptItems() {
  let items = meta.prompts.map((p) => ({
    ...p,
    prompt: readFileSync(join(PROBE_DIR, p.file), "utf8").trim(),
    maxWaitMs: maxWaitMsArg ?? p.maxWaitMs ?? defaults.maxWaitMs ?? 180000,
    pollMaxWaitMs: pollMaxWaitMsArg ?? p.pollMaxWaitMs ?? defaults.pollMaxWaitMs ?? 60000,
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

function hashAnswer(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function parseJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object" && "success" in parsed) {
      return parsed.success
        ? parsed.data
        : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, action: parsed.action };
    }
    return parsed;
  } catch {
    return { error: "invalid json", raw: stdout.slice(0, 800) };
  }
}

function run(argv, timeoutMs = 120000, tab = null) {
  const full = ["bun", CLI, ...argv, "--json"];
  if (tab != null) full.push("--tab", tab);
  const result = spawnSync(full[0], full.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    cmd: full.join(" "),
    stdout: (result.stdout || "").trim(),
    status: result.status,
    timedOut: result.signal === "SIGTERM",
  };
}

function openFreshTab() {
  const opened = run(["tab", "new", "https://app.notion.com/ai"], 60000);
  const data = parseJson(opened.stdout);
  const shortId = data?.tab || String(data?.tabId || "").slice(-4).toLowerCase();
  if (!shortId) throw new Error("tab new failed");
  for (let i = 0; i < 20; i++) {
    spawnSync("sleep", ["1"]);
    const health = run(["site", "notion/health"], 30000, shortId);
    if (health.stdout && parseJson(health.stdout)?.ok) break;
  }
  spawnSync("sleep", ["2"]);
  run(["site", "notion/chat", "", resolvedModel, "true", "true", "false"], 120000, shortId);
  return shortId;
}

const anchorProbeJs = `(function(){
  var h=globalThis.__notionAiChatHelpers;
  if(!h)return{error:'helpers not loaded'};
  var chatRoot=document.querySelector('.layout-chat');
  var modelBtn=document.querySelector('[data-testid="unified-chat-model-button"][role="button"]');
  var copyAll=chatRoot?Array.prototype.slice.call(chatRoot.querySelectorAll('[aria-label="Copy response"]')):[];
  var scope=h.getLatestAssistantReplyScope?h.getLatestAssistantReplyScope():null;
  var msgs=h.getAssistantMessagesSinceLastUser();
  var beforeCount=0,beforeText='';
  var ans=msgs.length?h.getAssistantAnswerSince(msgs,beforeCount,beforeText,{skipScopeReady:true}):'';
  var genPlain=h.isGenerating();
  var genTurn=h.isGeneratingForTurn(beforeCount,beforeText);
  var inProg=h.isChatInProgress();
  var hasAct=h.hasCompletedReplyActions();
  var hasActTurn=h.hasCompletedReplyActionsForTurn(beforeCount,beforeText);
  var activity=h.getChatActivityText?h.getChatActivityText(4000):'';
  var lines=activity.split('\\n').filter(function(l){return String(l||'').trim();});
  var tail=lines.slice(-15);
  var statusLines=tail.filter(function(l){
    return /^(Searching|Reading|Browsing|Fetching|Thinking|Running|Brewing|Focusing|Exploring|Computing|Generating|Thought|Searched|Loaded|Called)\\b/i.test(String(l).trim());
  });
  var mismatches=[];
  if(!chatRoot)mismatches.push('layout_chat_missing');
  if(!modelBtn)mismatches.push('model_picker_testid_missing');
  if(modelBtn&&h.isInViewport&&!h.isInViewport(modelBtn))mismatches.push('model_picker_off_viewport');
  if(copyAll.length>1)mismatches.push('multiple_copy_buttons');
  if(hasAct&&genTurn)mismatches.push('toolbar_visible_while_generating_for_turn');
  if(hasAct&&!genPlain&&ans&&!h.looksLikeFinalAnswer(ans))mismatches.push('toolbar_visible_nonfinal_answer');
  if(!hasAct&&genPlain&&statusLines.length===0&&inProg)mismatches.push('generating_without_status_lines');
  if(hasAct&&!hasActTurn&&msgs.length)mismatches.push('toolbar_not_scoped_to_current_turn');
  if(scope&&copyAll.length&&!scope.querySelector('[aria-label="Copy response"]'))mismatches.push('reply_scope_missing_copy_in_scope');
  return{
    helpersVersion:h.version,
    anchors:{
      layoutChat:!!chatRoot,
      modelPicker:modelBtn?{text:(modelBtn.innerText||'').trim(),expanded:modelBtn.getAttribute('aria-expanded'),controls:modelBtn.getAttribute('aria-controls')}:null,
      copyButtonCount:copyAll.length,
      assistantLeafCount:msgs.length,
      replyScopeTag:scope?(scope.tagName+(scope.id?'#'+scope.id:'')):null
    },
    signals:{
      isGenerating:genPlain,
      isGeneratingForTurn:genTurn,
      isChatInProgress:inProg,
      hasCompletedReplyActions:hasAct,
      hasCompletedReplyActionsForTurn:hasActTurn,
      looksFinal:ans?h.looksLikeFinalAnswer(ans):null
    },
    statusLines:statusLines.slice(0,10),
    recentTail:tail.slice(-6),
    answerLen:ans.length,
    answerPreview:String(ans||'').slice(0,400),
    mismatches:mismatches
  };
})()`;

function probeTab(tab) {
  const r = run(["eval", anchorProbeJs], 45000, tab);
  const data = parseJson(r.stdout);
  return data?.result ?? data;
}

function runChat(prompt, maxWaitMs, mode, tab) {
  const t0 = Date.now();
  let argv;
  if (mode === "submit") {
    argv = ["site", "notion/chat", prompt, "--model", resolvedModel, "--newChat", "true", "--maxWaitMs", String(maxWaitMs)];
  } else {
    argv = ["site", "notion/chat", "x", resolvedModel, "true", "false", "true", "", String(maxWaitMs)];
  }
  const chatRun = run(argv, maxWaitMs + 60000, tab);
  const chatData = parseJson(chatRun.stdout);
  const anchor = probeTab(tab);
  const domAnswer = anchor?.answerPreview || "";
  return {
    mode,
    elapsedMs: Date.now() - t0,
    timedOut: chatRun.timedOut,
    chatError: chatData?.error || null,
    answer: chatData?.answer || null,
    answerJson: chatData?.answerJson || null,
    answerLen: anchor?.answerLen || (chatData?.answer ? String(chatData.answer).length : 0),
    answerHash: hashAnswer(chatData?.answer || domAnswer),
    anchor,
  };
}

function analyzeRuns(runs) {
  const mismatchCounts = {};
  const findings = [];

  for (const run of runs) {
    for (const step of run.steps) {
      for (const m of step.anchor?.mismatches || []) {
        mismatchCounts[m] = (mismatchCounts[m] || 0) + 1;
      }
    }
  }

  if (mismatchCounts.toolbar_visible_while_generating_for_turn) {
    findings.push({
      bug: "Stale reply toolbar treated as complete while new turn still generating",
      anchor: "hasCompletedReplyActions() + getLatestAssistantReplyScope()",
      evidence: `${mismatchCounts.toolbar_visible_while_generating_for_turn} step(s)`,
      fix: "Scope toolbar search to current turn only (data-testid on turn container or require hasCompletedReplyActionsForTurn before global isGenerating=false).",
    });
  }
  if (mismatchCounts.toolbar_not_scoped_to_current_turn) {
    findings.push({
      bug: "Copy/Save toolbar found but not attributed to current turn",
      anchor: "getLatestAssistantReplyScope() walks ancestors from last leaf",
      evidence: `${mismatchCounts.toolbar_not_scoped_to_current_turn} step(s)`,
      fix: "Anchor reply scope to unified-chat turn wrapper or aria-controls from composer; reject toolbars outside messages since last user.",
    });
  }
  if (mismatchCounts.multiple_copy_buttons) {
    findings.push({
      bug: "Multiple Copy response buttons in .layout-chat",
      anchor: ".layout-chat querySelectorAll [aria-label=Copy response]",
      evidence: `${mismatchCounts.multiple_copy_buttons} step(s)`,
      fix: "Pick copy button nearest to last user message (same as reply scope), not first/any in layout.",
    });
  }
  if (mismatchCounts.generating_without_status_lines) {
    findings.push({
      bug: "isGenerating true but no status lines in .layout-chat tail",
      anchor: "hasActiveAgentStatusLines() via getRecentChatLines",
      evidence: `${mismatchCounts.generating_without_status_lines} step(s)`,
      fix: "Add DOM anchors for agent status (data-testid) instead of parsing layout-chat innerText tail.",
    });
  }
  if (mismatchCounts.reply_scope_missing_copy_in_scope) {
    findings.push({
      bug: "Reply scope element lacks copy button descendant",
      anchor: "getLatestAssistantReplyScope parent walk",
      evidence: `${mismatchCounts.reply_scope_missing_copy_in_scope} step(s)`,
      fix: "Use Notion turn container test id when available; fall back to closest ancestor containing both leaf + toolbar.",
    });
  }

  findings.push({
    bug: "clickElement double-fires on toggles and menu items",
    anchor: "clickElement() used by ensureModelPickerSurface, findScrollToBottomButton",
    evidence: "code review (helpers v40)",
    fix: "Use clickOnce for aria-expanded controls; keep synthetic events only when native click fails.",
  });

  findings.push({
    bug: "Thought/reasoning content filtered by regex only, not DOM Thought sections",
    anchor: "looksLikeThoughtBlock() + .content-editable-leaf-rtl message list",
    evidence: "long prompts with agent reasoning",
    fix: "Exclude leaves under [data-section=thought] or role=region labeled Thought; do not rely on English regex stubs alone.",
  });

  return { mismatchCounts, findings };
}

const plan = loadPromptItems();

if (dryRun) {
  console.log(`Dry run: ${plan.length} prompt(s), model=${resolvedModel}\n`);
  for (const item of plan) {
    console.log(`  ${item.id} (${item.prompt.length} chars) — ${item.purpose.slice(0, 80)}...`);
  }
  process.exit(0);
}

const status = run(["status"], 15000);
if (parseJson(status.stdout)?.running !== true) {
  console.error("bun-browser daemon not running");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const results = {
  startedAt: new Date().toISOString(),
  suite: meta.suite,
  model: resolvedModel,
  maxPolls,
  runs: [],
};

console.log(`Thinking probe: ${plan.length} prompts, model=${resolvedModel}, maxPolls=${maxPolls}\n`);

for (const item of plan) {
  const tab = openFreshTab();
  console.log(`--- ${item.id} tab=${tab} ---`);
  console.log(`  ${item.purpose.slice(0, 100)}...`);

  const steps = [];
  steps.push(runChat(item.prompt, item.maxWaitMs, "submit", tab));
  console.log(
    `  submit: err=${steps[0].chatError || "none"} len=${steps[0].answerLen} gen=${steps[0].anchor?.signals?.isGenerating} mismatches=${(steps[0].anchor?.mismatches || []).join(",") || "none"}`,
  );

  let polls = 0;
  while (
    polls < maxPolls &&
    (steps[steps.length - 1].chatError === "Still generating" ||
      (item.expectJson && steps[steps.length - 1].answerLen > 0 && !steps[steps.length - 1].answerJson))
  ) {
    polls++;
    spawnSync("sleep", ["2"]);
    const poll = runChat(item.prompt, item.pollMaxWaitMs, "waitOnly", tab);
    poll.pollIndex = polls;
    steps.push(poll);
    console.log(
      `  poll ${polls}: err=${poll.chatError || "none"} len=${poll.answerLen} gen=${poll.anchor?.signals?.isGenerating} mismatches=${(poll.anchor?.mismatches || []).join(",") || "none"}`,
    );
    if (poll.answer && poll.chatError !== "Still generating") break;
  }

  const entry = {
    id: item.id,
    tab,
    expectJson: item.expectJson,
    steps: steps.map((s) => ({
      mode: s.mode,
      pollIndex: s.pollIndex ?? null,
      elapsedMs: s.elapsedMs,
      chatError: s.chatError,
      answerLen: s.answerLen,
      answerHash: s.answerHash,
      anchor: s.anchor,
      answerPreview: s.answer ? String(s.answer).slice(0, 200) : null,
    })),
    finalError: steps[steps.length - 1].chatError,
    finalLen: steps[steps.length - 1].answerLen,
    allMismatches: [...new Set(steps.flatMap((s) => s.anchor?.mismatches || []))],
  };
  results.runs.push(entry);
  writeFileSync(join(OUT_DIR, `run-${item.id}.json`), JSON.stringify(entry, null, 2));

  if (plan.indexOf(item) < plan.length - 1) spawnSync("sleep", [String(Math.ceil(pauseMs / 1000))]);
}

results.finishedAt = new Date().toISOString();
results.analysis = analyzeRuns(results.runs);
writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
writeFileSync(join(OUT_DIR, "anchor-analysis.json"), JSON.stringify(results.analysis, null, 2));

console.log("\n=== Anchor analysis ===");
for (const f of results.analysis.findings) {
  console.log(`• ${f.bug}`);
  console.log(`  anchor: ${f.anchor}`);
  console.log(`  fix: ${f.fix}\n`);
}
console.log(`Mismatch counts: ${JSON.stringify(results.analysis.mismatchCounts)}`);
console.log(`Output: ${OUT_DIR}/anchor-analysis.json`);

process.exit(0);
