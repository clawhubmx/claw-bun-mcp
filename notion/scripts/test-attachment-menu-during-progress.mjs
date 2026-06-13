#!/usr/bin/env bun
/**
 * Reproduce / monitor Notion "Give context" / file-attachment menu opening
 * during waitForAssistantAnswer polling (passive observer / waitOnly).
 *
 * Root cause under test: findScrollToBottomButton() scores the composer
 * "Give context" plus button as a scroll FAB; revealLatestReplyInView /
 * scrollToLatestReply click it on every poll when a prior-turn reply toolbar
 * is still in the DOM.
 *
 * Usage:
 *   bun notion/scripts/test-attachment-menu-during-progress.mjs --fixture
 *   bun notion/scripts/test-attachment-menu-during-progress.mjs --tab <TAB_ID>
 *   bun notion/scripts/test-attachment-menu-during-progress.mjs --tab <TAB_ID> --submit
 *   bun notion/scripts/test-attachment-menu-during-progress.mjs --dry-run
 *
 * Live flow (--tab):
 *   1. Probe current DOM (scroll candidate, Give context state)
 *   2. Optionally submit a slow follow-up (--submit) with short maxWaitMs
 *   3. Run instrumented poll loop mirroring waitForAssistantAnswer side effects
 *   4. Report menu openings and misclick risk
 *
 * Fixture flow (--fixture):
 *   Runs the same DOM fixture as notion/test-chat-helpers.test.mjs without a browser.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const HELPERS_SOURCE = readFileSync(join(__dirname, "../chat-helpers.js"), "utf8");
const OUT_DIR = join(ROOT, "notion/example/attachment-menu-during-progress-runs");

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Usage: bun notion/scripts/test-attachment-menu-during-progress.mjs [options]

Options:
  --help          Show this help
  --dry-run       Print plan only
  --fixture       Run DOM fixture reproducer (no bun-browser)
  --tab <id>      Live Notion tab id (bun-browser tab list --json)
  --submit        With --tab: submit a slow follow-up before monitoring
  --polls <n>     Instrumented poll iterations (default: 10)
  --pollMs <n>    Pause between polls (default: 250)
  --maxWaitMs <n> maxWaitMs for optional --submit (default: 8000)

Output: ${OUT_DIR}/run-<timestamp>.json
`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const fixture = args.includes("--fixture");
const activeTab = args.includes("--tab") ? args[args.indexOf("--tab") + 1] : null;
const doSubmit = args.includes("--submit");
const polls = args.includes("--polls") ? Number(args[args.indexOf("--polls") + 1]) : 10;
const pollMs = args.includes("--pollMs") ? Number(args[args.indexOf("--pollMs") + 1]) : 250;
const maxWaitMs = args.includes("--maxWaitMs") ? Number(args[args.indexOf("--maxWaitMs") + 1]) : 8000;

const SLOW_PROMPT =
  "Think step by step about three ways to organize a weekly team recap. " +
  "Use at least 6 sentences. Do not use bullet lists. End with one summary sentence.";

const REPLY_ACTION_BUTTONS =
  '<button aria-label="Copy response"><svg></svg></button>' +
  '<button aria-label="Save to private pages"><svg></svg></button>';

function run(argv, tabId, timeoutMs = 120000) {
  const full = ["bun", CLI, ...argv];
  if (tabId) full.push("--tab", tabId);
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
      return parsed.success
        ? parsed.data
        : { error: parsed.error, hint: parsed.hint, kind: parsed.kind, action: parsed.action };
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

function installHelpers() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://app.notion.com/chat?t=fixture",
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.location = dom.window.location;
  const load = new Function(`${HELPERS_SOURCE}\nreturn installNotionAiChatHelpers;`);
  return load()();
}

function fixtureRect(el, top = 720) {
  el.getBoundingClientRect = () => ({
    left: 900,
    top,
    width: 36,
    height: 36,
    right: 936,
    bottom: top + 36,
    x: 900,
    y: top,
  });
  Object.defineProperty(el, "offsetParent", { configurable: true, value: document.body });
}

function buildAttachmentProbeJs(pollCount, pollPauseMs) {
  return `(async function(){
  var h = globalThis.__notionAiChatHelpers;
  if (!h) return { error: 'helpers not loaded' };

  var existing = h.getAssistantMessages();
  var beforeCount = h.getCurrentReplyAssistantStartCount();
  var beforeText = beforeCount < existing.length ? h.getAssistantText(existing[beforeCount]) : '';

  function attachmentState(label) {
    var anchor = h.findGiveContextButton();
    var scrollBtn = h.findScrollToBottomButton();
    var surface = anchor ? h.findGiveContextSurface(anchor) : null;
    var markerHits = surface && h.countGiveContextMarkerHits ? h.countGiveContextMarkerHits(surface) : 0;
    return {
      label: label,
      t: Date.now(),
      helpersVersion: h.version,
      beforeCount: beforeCount,
      hasToolbar: h.hasCompletedReplyActions(),
      isGeneratingForTurn: h.isGeneratingForTurn(beforeCount, beforeText),
      isChatInProgress: h.isChatInProgress(),
      giveContextExpanded: !!(anchor && anchor.getAttribute('aria-expanded') === 'true'),
      menuVisible: !!(surface && markerHits >= 2),
      menuMarkerHits: markerHits,
      scrollCandidateLabel: scrollBtn ? (scrollBtn.getAttribute('aria-label') || scrollBtn.innerText || '').trim() : null,
      misclickRisk: !!(scrollBtn && (scrollBtn.getAttribute('aria-label') || '').trim() === 'Give context'),
      callSite: null
    };
  }

  var log = [];
  log.push(attachmentState('start'));

  for (var i = 0; i < ${pollCount}; i++) {
    var msgs = h.getAssistantMessagesSinceLastUser();
    var snapBefore = attachmentState('poll-' + i + '-before-getAssistantAnswerSince');
    snapBefore.callSite = 'getAssistantAnswerSince → getAssistantTextFromReplyScope → revealLatestReplyInView';
    log.push(snapBefore);

    h.getAssistantAnswerSince(msgs, beforeCount);

    var snapAfter = attachmentState('poll-' + i + '-after-getAssistantAnswerSince');
    snapAfter.callSite = 'getAssistantAnswerSince (same chain if hasCompletedReplyActions)';
    log.push(snapAfter);

    if (i === 2) {
      var scrollSnapBefore = attachmentState('scrollToLatestReply-before');
      scrollSnapBefore.callSite = 'waitForAssistantAnswer JSON path → scrollToLatestReply';
      log.push(scrollSnapBefore);
      await h.scrollToLatestReply({ maxClicks: 1, pauseMs: 0 });
      var scrollSnapAfter = attachmentState('scrollToLatestReply-after');
      scrollSnapAfter.callSite = 'scrollToLatestReply → clickScrollToBottomButton';
      log.push(scrollSnapAfter);
    }

    await new Promise(function(r) { setTimeout(r, ${pollPauseMs}); });
  }

  var bugSignals = log.filter(function(e) {
    return e.misclickRisk || e.giveContextExpanded || e.menuVisible;
  });

  return {
    beforeCount: beforeCount,
    beforeText: beforeText,
    conversationId: h.getConversationId(),
    tabHidden: document.hidden,
    tabVisibility: document.visibilityState,
    log: log,
    bugDetected: bugSignals.length > 0,
    bugSignals: bugSignals,
    expected: 'No Give context menu / misclick during passive poll',
    actual: bugSignals.length
      ? 'Attachment menu risk detected during poll side effects'
      : 'No attachment menu signals in this snapshot window'
  };
})()`;
}

function runFixtureProbe() {
  const h = installHelpers();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });

  let giveContextClicked = 0;
  document.body.innerHTML =
    '<div class="layout-chat">' +
    '<div class="content-editable-leaf-rtl">Follow-up user prompt while new reply generates</div>' +
    '<div class="assistant-turn">' +
    '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Prior completed answer with toolbar.</div></div>' +
    '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + "</div>" +
    "</div>" +
    '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Thinking about your question</div></div>' +
    '<div contenteditable="true" role="textbox" id="editor" style="position:fixed;bottom:80px;left:40px;width:600px;height:40px">draft</div>' +
    '<button aria-label="Submit AI message" id="submit" style="position:fixed;bottom:80px;right:120px;width:36px;height:36px">Send</button>' +
    '<button aria-label="Give context" id="giveCtx" style="position:fixed;bottom:80px;right:72px;width:36px;height:36px">' +
    '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"></path></svg></button>' +
    "</div>";

  const giveBtn = document.getElementById("giveCtx");
  const editor = document.getElementById("editor");
  const submit = document.getElementById("submit");
  fixtureRect(giveBtn, 764);
  fixtureRect(submit, 764);
  fixtureRect(editor, 760);
  editor.getBoundingClientRect = () => ({
    left: 40,
    top: 760,
    width: 600,
    height: 40,
    right: 640,
    bottom: 800,
    x: 40,
    y: 760,
  });

  giveBtn.addEventListener("click", () => {
    giveContextClicked++;
    giveBtn.setAttribute("aria-expanded", "true");
    const menu = document.createElement("div");
    menu.id = "giveMenu";
    menu.setAttribute("role", "menu");
    menu.innerHTML =
      '<div role="menuitem">Add photos and files</div>' +
      '<div role="menuitem">Mention pages or people</div>' +
      '<div role="menuitem">Create image</div>';
    document.body.appendChild(menu);
    menu.getBoundingClientRect = () => ({
      left: 820,
      top: 700,
      width: 260,
      height: 180,
      right: 1080,
      bottom: 880,
      x: 820,
      y: 700,
    });
  });

  const existing = h.getAssistantMessages();
  const beforeCount = h.getCurrentReplyAssistantStartCount();
  const beforeText = beforeCount < existing.length ? h.getAssistantText(existing[beforeCount]) : "";

  const log = [];
  const snap = (label, callSite) => {
    const anchor = h.findGiveContextButton();
    const scrollBtn = h.findScrollToBottomButton();
    const surface = anchor ? h.findGiveContextSurface(anchor) : null;
    const markerHits = surface ? h.countGiveContextMarkerHits(surface) : 0;
    log.push({
      label,
      callSite,
      hasToolbar: h.hasCompletedReplyActions(),
      isGeneratingForTurn: h.isGeneratingForTurn(beforeCount, beforeText),
      scrollCandidateLabel: scrollBtn?.getAttribute("aria-label") || null,
      misclickRisk: scrollBtn?.getAttribute("aria-label") === "Give context",
      giveContextExpanded: giveBtn.getAttribute("aria-expanded") === "true",
      menuVisible: markerHits >= 2,
      giveContextClicks: giveContextClicked,
    });
  };

  snap("start", null);
  for (let i = 0; i < polls; i++) {
    const msgs = h.getAssistantMessagesSinceLastUser();
    snap(`poll-${i}-before`, "getAssistantAnswerSince → revealLatestReplyInView");
    h.getAssistantAnswerSince(msgs, beforeCount);
    snap(`poll-${i}-after`, "getAssistantAnswerSince (toolbar from prior turn)");
    if (i === 2) {
      snap("scroll-before", "waitForAssistantAnswer → scrollToLatestReply");
      h.scrollToLatestReply({ maxClicks: 1, pauseMs: 0 });
      snap("scroll-after", "scrollToLatestReply → clickScrollToBottomButton");
    }
  }

  const bugSignals = log.filter((e) => e.misclickRisk || e.menuVisible || e.giveContextClicks > 0);

  return {
    mode: "fixture",
    beforeCount,
    beforeText,
    giveContextClicked,
    scrollMisidentifiesGiveContext: h.findScrollToBottomButton()?.id === "giveCtx",
    log,
    bugDetected: bugSignals.length > 0 || giveContextClicked > 0,
    bugSignals,
    expected: "Passive poll must not open Give context / file menu",
    actual:
      giveContextClicked > 0
        ? `Give context clicked ${giveContextClicked} time(s) during poll simulation`
        : bugSignals.length
          ? "Misclick risk detected without menu open in fixture"
          : "No bug signals",
    rootCause: {
      files: ["notion/chat-helpers.js"],
      functions: [
        "findScrollToBottomButton",
        "clickScrollToBottomButton",
        "revealLatestReplyInView",
        "scrollToLatestReply",
        "getAssistantTextFromReplyScope",
        "getAssistantAnswerSince",
        "waitForAssistantAnswer",
      ],
      why:
        "findScrollToBottomButton scores plus-icon composer buttons (Give context, New chat) as scroll FABs via isDownArrowSvg; " +
        "getAssistantAnswerSince calls revealLatestReplyInView on every poll when hasCompletedReplyActions() is true (stale prior-turn toolbar during new generation).",
    },
    suggestedFix:
      "Exclude aria-label Give context / New chat / Submit from findScrollToBottomButton; only call reveal/scroll when capture is needed and turn is not generating; prefer scrollChatContainerToBottom without clicking composer buttons.",
  };
}

async function runLiveProbe(tabId) {
  mkdirSync(OUT_DIR, { recursive: true });
  const phases = [];

  const stateJs = `(function(){
    var h=globalThis.__notionAiChatHelpers;
    if(!h)return{error:'helpers not loaded'};
    var anchor=h.findGiveContextButton();
    var scrollBtn=h.findScrollToBottomButton();
    var surface=anchor?h.findGiveContextSurface(anchor):null;
    return{
      helpersVersion:h.version,
      url:location.href,
      conversationId:h.getConversationId(),
      hasToolbar:h.hasCompletedReplyActions(),
      isGenerating:h.isGenerating(),
      isChatInProgress:h.isChatInProgress(),
      giveContextExpanded:!!(anchor&&anchor.getAttribute('aria-expanded')==='true'),
      menuVisible:!!(surface&&h.countGiveContextMarkerHits(surface)>=2),
      scrollCandidateLabel:scrollBtn?(scrollBtn.getAttribute('aria-label')||'').trim():null,
      misclickRisk:!!(scrollBtn&&(scrollBtn.getAttribute('aria-label')||'').trim()==='Give context')
    };
  })()`;

  phases.push({
    phase: "initial-state",
    data: unwrapEval(parseJson(run(["eval", stateJs], tabId, 30000).stdout)),
  });

  if (doSubmit) {
    const convId = phases[0].data?.conversationId;
    const submitArgv = convId
      ? ["site", "notion/chatfollow", convId, SLOW_PROMPT, "--model", "auto", "--maxWaitMs", String(maxWaitMs)]
      : [
          "site",
          "notion/chat",
          SLOW_PROMPT,
          "--model",
          "auto",
          "--newChat",
          "false",
          "--maxWaitMs",
          String(maxWaitMs),
        ];
    const submitRun = run(submitArgv, tabId, maxWaitMs + 60000);
    phases.push({
      phase: "submit",
      cmd: submitRun.cmd,
      data: parseJson(submitRun.stdout),
      stillGenerating: parseJson(submitRun.stdout)?.error === "Still generating",
    });
  }

  const probeRun = run(["eval", buildAttachmentProbeJs(polls, pollMs)], tabId, polls * pollMs + 60000);
  const probe = unwrapEval(parseJson(probeRun.stdout));
  phases.push({ phase: "instrumented-poll", data: probe });

  const result = {
    mode: "live",
    tabId,
    polls,
    pollMs,
    maxWaitMs: doSubmit ? maxWaitMs : null,
    phases,
    bugDetected: !!probe?.bugDetected,
    bugSignals: probe?.bugSignals || [],
    expected: probe?.expected,
    actual: probe?.actual,
    rootCause: {
      files: ["notion/chat-helpers.js"],
      functions: [
        "findScrollToBottomButton",
        "clickScrollToBottomButton",
        "revealLatestReplyInView",
        "scrollToLatestReply",
        "getAssistantTextFromReplyScope",
        "getAssistantAnswerSince",
        "waitForAssistantAnswer",
      ],
      callSitesDuringWait: [
        "waitForAssistantAnswer poll → getAssistantAnswerSince → getAssistantTextFromReplyScope → revealLatestReplyInView",
        "waitForAssistantAnswer JSON incomplete → scrollToLatestReply",
        "recoverCompletedAnswer → revealLatestReplyInView",
      ],
    },
    suggestedFix:
      "Exclude composer controls from findScrollToBottomButton; gate revealLatestReplyInView on isGeneratingForTurn / only when scrolling is required.",
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(OUT_DIR, `run-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, outPath }, null, 2));
  return result;
}

if (dryRun) {
  console.log("Plan:");
  console.log(`  fixture=${fixture} tab=${activeTab || "(none)"} submit=${doSubmit}`);
  console.log(`  polls=${polls} pollMs=${pollMs} maxWaitMs=${maxWaitMs}`);
  console.log(`  output: ${OUT_DIR}/run-<timestamp>.json`);
  process.exit(0);
}

if (fixture) {
  const result = runFixtureProbe();
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(OUT_DIR, `fixture-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, outPath }, null, 2));
  process.exit(result.bugDetected ? 1 : 0);
}

if (!activeTab) {
  console.error("Provide --tab <id> for live probe, or --fixture for DOM-only repro.");
  printHelp();
  process.exit(1);
}

const live = await runLiveProbe(activeTab);
process.exit(live.bugDetected ? 1 : 0);
