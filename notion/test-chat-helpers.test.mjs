/**
 * Unit tests for Notion AI chat helpers.
 * Run: bun test notion/test-chat-helpers.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, test } from "bun:test";
import {
  isAbnormalResponse,
  looksLikeCompleteAnswer,
  modelTitleToId,
  NOTION_MODE_ALIASES,
  validateAnswerComplete,
} from "./api-schemas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helpersSource = readFileSync(join(__dirname, "chat-helpers.js"), "utf8");

const REPLY_ACTION_BUTTONS =
  '<button aria-label="Copy response"><svg></svg></button>' +
  '<button aria-label="Save to private pages"><svg></svg></button>';
const REPLY_ACTION_BUTTONS_UNIFIED =
  '<button aria-label="Copy response"><svg></svg></button>' +
  '<div role="button" tabindex="0" aria-label="Save"><svg></svg></div>';
const REPLY_ACTION_BUTTONS_WITH_FEEDBACK =
  REPLY_ACTION_BUTTONS +
  '<button aria-label="Share positive feedback"><svg></svg></button>' +
  '<button aria-label="Share negative feedback"><svg></svg></button>';

function installHelpersAt(url, opts = {}) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Node = dom.window.Node;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  if (typeof dom.window.document.execCommand !== "function") {
    dom.window.document.execCommand = () => false;
  }

  let hrefValue = url;
  const navigationLog = [];
  const locationMock = {
    get href() {
      return hrefValue;
    },
    set href(next) {
      navigationLog.push(next);
      hrefValue = next;
    },
    get pathname() {
      return new URL(hrefValue).pathname;
    },
  };
  globalThis.location = locationMock;
  dom.window.location = locationMock;

  const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
  const helpers = loadHelpers()();
  if (opts.trackNavigation) {
    helpers.__navigationLog = navigationLog;
  }
  return helpers;
}

function installHelpers() {
  return installHelpersAt("https://app.notion.com/ai");
}

function makeElementVisible(el) {
  if (!el) return;
  el.getBoundingClientRect = () => ({
    width: 32,
    height: 32,
    top: 10,
    left: 10,
    bottom: 42,
    right: 42,
  });
  Object.defineProperty(el, "offsetParent", { configurable: true, value: document.body });
}

function makeReplyToolbarVisible(root = document) {
  const nodes = root.querySelectorAll(
    '[aria-label="Copy response"], [aria-label="Save to private pages"], [aria-label="Save"], [aria-label="Share positive feedback"], [aria-label="Share negative feedback"]',
  );
  for (const el of nodes) makeElementVisible(el);
}

describe("notion chat helpers", () => {
  test("parseConversationId accepts dashed UUID", () => {
    const h = installHelpers();
    expect(h.parseConversationId("37b746ce-978e-8096-8d54-00a96c21f6ad")).toBe(
      "37b746ce-978e-8096-8d54-00a96c21f6ad",
    );
  });

  test("parseConversationId accepts compact chat URL", () => {
    const h = installHelpers();
    expect(
      h.parseConversationId(
        "https://app.notion.com/chat?t=37b746ce978e80968d5400a96c21f6ad&wfv=chat",
      ),
    ).toBe("37b746ce-978e-8096-8d54-00a96c21f6ad");
  });

  test("looksLikeFinalAnswer accepts normal prose", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("Hello there, Joseph.")).toBe(true);
  });

  test("looksLikeFinalAnswer accepts short numeric and one-word answers", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("7")).toBe(true);
    expect(h.looksLikeFinalAnswer("42")).toBe(true);
    expect(h.looksLikeFinalAnswer("Mars")).toBe(true);
    expect(h.looksLikeFinalAnswer("OK")).toBe(true);
  });

  test("looksLikeFinalAnswer rejects progress lines", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("Notion AI finished.")).toBe(false);
    expect(h.looksLikeFinalAnswer("Thinking")).toBe(false);
    expect(h.looksLikeFinalAnswer("42s")).toBe(false);
  });

  test("looksLikeFinalAnswer rejects model label only", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("Auto")).toBe(false);
  });

  test("looksLikeFinalAnswer accepts short token answers", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("OK-NOTION-FLOW")).toBe(true);
  });

  test("detectNotionPageAbnormal catches run out of free AI responses", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div role="alert">You\'ve run out of free AI responses.</div>';
    expect(h.detectNotionPageAbnormal()).toEqual({
      error: "Run out of free AI responses",
      kind: "credits_exhausted",
      hint: "This Notion workspace has used all free AI responses.",
      action: "wait and retry or upgrade plan",
    });
  });

  test("looksLikeFinalAnswer rejects free AI quota message", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("You've run out of free AI responses.")).toBe(false);
  });

  test("matchCreditsExhausted detects free quota wording", () => {
    const h = installHelpers();
    expect(h.matchCreditsExhausted("run out of free AI responses.")).toEqual({
      error: "Run out of free AI responses",
      kind: "credits_exhausted",
      hint: "This Notion workspace has used all free AI responses.",
      action: "wait and retry or upgrade plan",
    });
  });

  test("matchRateLimit detects explicit Notion rate-limit errors", () => {
    const h = installHelpers();
    expect(h.matchRateLimit("Rate limit reached. Please wait.")).toEqual({
      error: "Rate limit reached",
      kind: "rate_limit",
      hint: "Notion AI rate limit detected. Wait before retrying.",
      action: "wait and retry",
    });
    expect(h.matchRateLimit("Too many requests. Slow down.")).toEqual({
      error: "Rate limit reached",
      kind: "rate_limit",
      hint: "Notion AI rate limit detected. Wait before retrying.",
      action: "wait and retry",
    });
  });

  test("matchRateLimit ignores generic try again later wording", () => {
    const h = installHelpers();
    expect(h.matchRateLimit("Please try again later.")).toBeNull();
    expect(h.matchRateLimit("If it fails, try again later.")).toBeNull();
  });

  test("matchPromptRejected detects Notion prompt rejection message", () => {
    const h = installHelpers();
    expect(
      h.matchPromptRejected("44 steps\nThought\nAn error occurred, please try again\nShare feedback"),
    ).toEqual({
      error: "An error occurred, please try again.",
      kind: "prompt_rejected",
      hint: "Notion AI rejected the prompt. Retry with a shorter or simpler prompt.",
      action: "retry with a revised prompt",
    });
    expect(h.matchPromptRejected("An error occurred, please try again.")).toEqual({
      error: "An error occurred, please try again.",
      kind: "prompt_rejected",
      hint: "Notion AI rejected the prompt. Retry with a shorter or simpler prompt.",
      action: "retry with a revised prompt",
    });
    expect(h.matchPromptRejected("An error occurred please try again")).toEqual({
      error: "An error occurred, please try again.",
      kind: "prompt_rejected",
      hint: "Notion AI rejected the prompt. Retry with a shorter or simpler prompt.",
      action: "retry with a revised prompt",
    });
  });

  test("matchPromptRejected ignores unrelated prose mentioning errors", () => {
    const h = installHelpers();
    expect(
      h.matchPromptRejected("An error occurred in the pipeline. Please try again tomorrow."),
    ).toBeNull();
  });

  test("looksLikeFinalAnswer rejects Notion prompt rejection message", () => {
    const h = installHelpers();
    expect(h.looksLikeFinalAnswer("An error occurred, please try again.")).toBe(false);
  });

  test("findUrlTrustAllowButton prefers Allow always over Allow once", () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div id="trust-card">
        <div>Do you trust api.llama.fi?</div>
        <div>Allowing Notion AI to access untrusted URLs can be a security risk.</div>
        <button>Allow once</button>
        <button id="allow-always">Allow always</button>
        <button>Reject</button>
      </div>
    `;
    expect(h.isUrlTrustPromptVisible()).toBe(true);
    expect(h.acceptUrlTrustPrompt()).toBe(true);
    expect(h.getLastUrlTrustAccepts()[0]?.label).toBe("allow always");
  });

  test("drainUrlTrustPrompts accepts multiple trust dialogs", async () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div class="trust-a">
        <div>Do you trust api.llama.fi?</div>
        <button>Allow once</button>
      </div>
    `;
    const result = await h.drainUrlTrustPrompts({ maxRounds: 3, pauseMs: 0 });
    expect(result.accepted).toBe(1);
    expect(result.prompts[0]?.domain).toContain("api.llama.fi");
  });

  test("acceptUrlTrustPrompt clicks Allow once when trust dialog is visible", () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div>Do you trust api.llama.fi?</div>
      <div>Allowing Notion AI to access untrusted URLs can be a security risk.</div>
      <button id="allow-once">Allow once</button>
      <button>Reject</button>
    `;
    expect(h.isUrlTrustPromptVisible()).toBe(true);
    expect(h.acceptUrlTrustPrompt()).toBe(true);
  });

  test("acceptUrlTrustPrompt ignores pages without trust dialog", () => {
    const h = installHelpers();
    document.body.innerHTML = '<button>Allow once</button>';
    expect(h.isUrlTrustPromptVisible()).toBe(false);
    expect(h.acceptUrlTrustPrompt()).toBe(false);
  });

  test("isGenerating detects Computing agent status", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">What is 2+2?</div>' +
      "Computing\nComputing</div>";
    expect(h.isGenerating()).toBe(true);
  });

  test("isGenerating ignores Thought section header without live status", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' + "prompt ".repeat(1200) + "Computing\nThought</div>";
    expect(h.isGenerating()).toBe(false);
  });

  test("isGenerating is false when reply actions are visible", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Summarize this in one sentence.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Final report complete with enough detail for the user.</div>' +
      REPLY_ACTION_BUTTONS +
      '</div></div>';
    expect(h.isGenerating()).toBe(false);
    expect(h.isChatInProgress()).toBe(false);
    expect(h.hasCompletedReplyActions()).toBe(true);
  });

  test("isGenerating detects Brewing and Focusing status lines", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">What is 17+25?</div>' +
      "Focusing\nFocusing\nOpus 4.7</div>";
    expect(h.isGenerating()).toBe(true);
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">News search</div>' +
      "Brewing\nBrewing</div>";
    expect(h.isGenerating()).toBe(true);
  });

  test("isGenerating stays true when stale copy buttons exist but new turn is Brewing", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Old completed answer with enough detail.</div>' +
      REPLY_ACTION_BUTTONS +
      '</div>' +
      '<div class="content-editable-leaf-rtl">What is 17+25?</div>' +
      "Focusing\nFocusing</div>";
    expect(h.isGenerating()).toBe(true);
    expect(h.isChatInProgress()).toBe(true);
  });

  test("getAssistantMessagesSinceLastUser ignores metadata and pre-user assistant blocks", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">true</div></div>' +
      '<div class="content-editable-leaf-rtl">What is 17+25?</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">42</div></div>' +
      '</div>';
    expect(h.getAssistantMessages().length).toBe(1);
    expect(h.getAssistantMessagesSinceLastUser().length).toBe(1);
    expect(h.getAssistantText(h.getAssistantMessagesSinceLastUser()[0])).toBe("42");
  });

  test("isGenerating is false when Thought header remains after short answer", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Reply with only: OK</div>' +
      "4:08 PM\nThought\nOK\nSonnet 4.6</div>";
    expect(h.isGenerating()).toBe(false);
    expect(h.isChatInProgress()).toBe(false);
    expect(h.looksLikeFinalAnswer("OK")).toBe(true);
  });

  test("isGenerating ignores stale agent progress outside recent lines", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      ("Searching the web\nThought\nSearched the web\n").repeat(10) +
      ("Completed report line with enough detail.\n").repeat(40) +
      '</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Completed report line with enough detail.</div></div>';
    expect(h.isGenerating()).toBe(false);
    expect(h.isChatInProgress()).toBe(false);
  });

  test("isChatInProgress detects in-flight agent work", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">Searching the web\nThinking</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Let me check the latest chain TVL rankings.</div></div>';
    expect(h.isChatInProgress()).toBe(true);
  });

  test("isChatInProgress is false when reply action toolbar is visible", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Summarize this please.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Here is the completed answer with enough detail.</div>' +
      REPLY_ACTION_BUTTONS +
      '</div></div>';
    expect(h.isChatInProgress()).toBe(false);
    expect(h.hasCompletedReplyActions()).toBe(true);
  });

  test("isChatInProgress stays true when final-looking answer lacks reply toolbar", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">Notion AI finished.</div>' +
      '<div class="content-editable-leaf-rtl">Summarize this please.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Here is the completed answer with enough detail.</div></div>';
    expect(h.hasCompletedReplyActions()).toBe(false);
    expect(h.isChatInProgress()).toBe(true);
  });

  test("hasCompletedReplyActions requires copy and save with svg", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Question here.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Answer with enough detail here.</div>' +
      '<button aria-label="Copy response"><svg></svg></button>' +
      '<button aria-label="Save to private pages"><svg></svg></button>' +
      '</div></div>';
    expect(h.hasCompletedReplyActions()).toBe(true);

    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Question here.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Answer with enough detail here.</div>' +
      '<button aria-label="Copy response"><svg></svg></button>' +
      '<button aria-label="Share positive feedback"><svg></svg></button>' +
      '<button aria-label="Share negative feedback"><svg></svg></button>' +
      '</div></div>';
    expect(h.hasCompletedReplyActions()).toBe(false);
  });

  test("hasCompletedReplyActions rejects buttons without svg children", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Question here.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Answer with enough detail here.</div>' +
      '<button aria-label="Copy response"></button>' +
      '<button aria-label="Save to private pages"></button>' +
      '<button aria-label="Share positive feedback"></button>' +
      '<button aria-label="Share negative feedback"></button>' +
      '</div></div>';
    expect(h.hasCompletedReplyActions()).toBe(false);
  });

  test("hasCompletedReplyActions accepts unified Save div with Copy response", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Question here.</div>' +
      '<div class="assistant-turn" id="unified-save-scope">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Answer with enough detail here.</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS_UNIFIED + '</div>' +
      '</div></div>';
    makeReplyToolbarVisible();
    expect(h.findReplyActionButton(document.getElementById("unified-save-scope"), "save to private pages")).not.toBeNull();
    expect(h.hasCompletedReplyActions()).toBe(true);
    expect(h.getLatestAssistantReplyScope()?.id).toBe("unified-save-scope");
  });

  test("getLatestAssistantReplyScope prefers Save anchor over copy-only outer scope", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Question here.</div>' +
      '<div class="assistant-turn" id="outer-scope">' +
      '<button aria-label="Copy response"><svg></svg></button>' +
      '<div class="assistant-turn" id="inner-save-scope">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Nested answer text.</div></div>' +
      '<div role="button" tabindex="0" aria-label="Save"><svg></svg></div>' +
      '</div></div></div>';
    makeReplyToolbarVisible();
    expect(h.getLatestAssistantReplyScope()?.id).toBe("inner-save-scope");
    expect(h.findReplyActionButton(h.getLatestAssistantReplyScope(), "save to private pages")?.getAttribute("aria-label")).toBe("Save");
  });

  test("findUnifiedReplySaveButton prefers last visible Save in DOM", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div role="button" tabindex="0" aria-label="Save" id="save-old"><svg></svg></div>' +
      '<div role="button" tabindex="0" aria-label="Save" id="save-new"><svg></svg></div>' +
      '</div>';
    makeReplyToolbarVisible(document.querySelector(".layout-chat"));
    expect(h.findUnifiedReplySaveButton(document.querySelector(".layout-chat"))?.id).toBe("save-new");
    expect(h.REPLY_SAVE_SELECTOR).toBe('[role="button"][tabindex="0"][aria-label="Save"]');
  });

  test("hasCompletedReplyActions finds sibling toolbar outside text block", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Question here.</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Answer with enough detail here.</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div></div>';
    expect(h.hasCompletedReplyActions()).toBe(true);
  });

  test("hasCompletedReplyActionsForTurn ignores stale toolbar without new turn content", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">What is 17+25?</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">42</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div></div>';
    const msgs = h.getAssistantMessagesSinceLastUser();
    expect(h.hasCompletedReplyActions()).toBe(true);
    expect(h.hasCompletedReplyActionsForTurn(msgs.length, "42")).toBe(false);
    expect(h.tryExtractCompletedAnswer(msgs, msgs.length, "42", {})).toBeNull();
  });

  test("tryExtractCompletedAnswer requires final-looking answer with toolbar", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Reply with only: y</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">y</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div></div>';
    const msgs = h.getAssistantMessagesSinceLastUser();
    expect(h.looksLikeFinalAnswer("y")).toBe(false);
    expect(h.tryExtractCompletedAnswer(msgs, 0, "", {})).toBeNull();
  });

  test("toolbar with incomplete JSON answer is still generating", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Return ONLY valid JSON.</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">{</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS_WITH_FEEDBACK + '</div>' +
      '</div></div>';
    const msgs = h.getAssistantMessagesSinceLastUser();
    expect(h.hasCompletedReplyActions()).toBe(true);
    expect(h.hasCompletedReplyActionsForTurn(0, "")).toBe(false);
    expect(h.isGeneratingForTurn(0, "")).toBe(true);
    expect(h.isChatInProgress()).toBe(true);
    expect(h.looksLikeFinalAnswer("{")).toBe(false);
  });

  test("recoverCompletedAnswer returns full reply since last user", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Capital of Japan? One word.</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Tokyo</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div></div>';
    expect(h.recoverCompletedAnswer(0, "", {})).toBe("Tokyo");
  });

  test("ensureNewChatView clicks New chat when stale reply toolbar is visible", async () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div contenteditable="true" role="textbox">draft</div>' +
      '<div class="assistant-turn" id="stale-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">stale answer</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div>' +
      '<button aria-label="New chat">New chat</button>' +
      '</div>';
    const editor = document.querySelector('[role="textbox"]');
    const newBtn = document.querySelector('[aria-label="New chat"]');
    for (const el of [editor, newBtn]) {
      el.getBoundingClientRect = () => ({ width: 80, height: 32, top: 10, left: 10, bottom: 42, right: 90 });
      Object.defineProperty(el, "offsetParent", { configurable: true, value: document.body });
    }
    const staleTurn = document.getElementById("stale-turn");
    newBtn.addEventListener("click", () => {
      staleTurn.remove();
    });
    const result = await h.ensureNewChatView();
    expect(result.ok).toBe(true);
    expect(h.getAssistantMessagesSinceLastUser().length).toBe(0);
  });

  test("validateExtractedAnswer rejects partial JSON tails for JSON prompts", () => {
    const h = installHelpers();
    const opts = { query: 'Return JSON only: {"status":"ok"}. json format only', expectJson: true };
    const partial = '"sources": "reuters.com, bbc.com"\n}';
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">User prompt</div>' +
      '<div class="assistant-turn"><div class="content-editable-leaf-rtl">' + partial + '</div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div></div></div>';
    const msgs = h.getAssistantMessagesSinceLastUser();
    expect(h.tryExtractCompletedAnswer(msgs, 1, "Thinking", opts)).toBeNull();
  });

  test("getAssistantAnswerSince captures in-place reply updates when message count is unchanged", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">What is 17+25? Reply with just the number.</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">42</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div></div>';
    const msgs = h.getAssistantMessagesSinceLastUser();
    expect(msgs.length).toBe(1);
    expect(h.getAssistantAnswerSince(msgs, 1)).toBe("42");
    expect(h.hasNewTurnContent(msgs, 1, "Thinking")).toBe(true);
    expect(h.tryExtractCompletedAnswer(msgs, 1, "Thinking", {})).toBe("42");
  });

  test("getAssistantTextFromReplyScope reads text near sibling toolbar", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Capital?</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><span>Tokyo</span></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div></div>';
    expect(h.getAssistantTextFromReplyScope()).toBe("Tokyo");
  });

  test("hasSubmitFlightSignals detects composer cleared after submit", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div contenteditable="true" role="textbox" class="notion-text-block">What is 17+25? Reply with just the number.</div>' +
      '</div>';
    expect(h.hasSubmitFlightSignals(0, "", "What is 17+25? Reply with just the number.")).toBe(false);
    document.querySelector('[role="textbox"]').textContent = "";
    expect(h.hasSubmitFlightSignals(0, "", "What is 17+25? Reply with just the number.")).toBe(true);
  });

  test("waitForSubmitAck returns ok when progress lines appear", async () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat"><div class="content-editable-leaf-rtl">Thinking</div></div>';
    const ack = await h.waitForSubmitAck(0, "", "Name one planet. One word only.", {
      ackWaitMs: 200,
      submitAckPollMs: 50,
    });
    expect(ack.ok).toBe(true);
  });

  test("waitForSubmitAck returns silent_no_signals when nothing changes", async () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div contenteditable="true" role="textbox">Name one planet. One word only.</div>' +
      '</div>';
    const ack = await h.waitForSubmitAck(0, "", "Name one planet. One word only.", {
      ackWaitMs: 200,
      submitAckPollMs: 50,
    });
    expect(ack.ok).toBe(false);
    expect(ack.reason).toBe("silent_no_signals");
  });

  test("getTabCaptureState reports hidden document", () => {
    const h = installHelpers();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const state = h.getTabCaptureState();
    expect(state.hidden).toBe(true);
    expect(state.captureReliable).toBe(false);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  test("isReplyFinishBlocked is reserved for future UI hooks", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div role="button" aria-label="Wait for the response to finish before sharing"><svg></svg></div>' +
      '</div>';
    expect(h.isReplyFinishBlocked()).toBe(false);
  });

  test("waitForAssistantAnswer returns once reply toolbar appears", async () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Summarize this please.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Final report complete with enough detail for the user.</div></div>' +
      '</div>';
    const pending = h.waitForAssistantAnswer(0, "", { pollMs: 20, maxWaitMs: 300, stableNeeded: 2 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Summarize this please.</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Final report complete with enough detail for the user.</div>' +
      REPLY_ACTION_BUTTONS +
      '</div></div>';
    const answer = await pending;
    expect(answer).toBe("Final report complete with enough detail for the user.");
  });

  test("getChatActivityText keeps tail where agent status appears", () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div class="layout-chat">${"prompt ".repeat(1200)}
Loaded web page: api.llama.fi/chains</div>
    `;
    expect(h.getChatActivityText(200)).toContain("Loaded web page");
    expect(h.getChatActivityText(200)).not.toMatch(/^prompt/);
    expect(h.isGenerating()).toBe(true);
  });

  test("looksLikeThoughtBlock rejects reasoning stubs", () => {
    const h = installHelpers();
    expect(h.looksLikeThoughtBlock("The user wants me to perform a massive on-chain security research task. I need to:")).toBe(true);
    expect(h.looksLikeThoughtBlock("Fetch top 10 Ethereum protocols")).toBe(true);
    expect(h.looksLikeThoughtBlock("| Chain | Protocol | Risk |")).toBe(false);
  });

  test("looksLikeInProgressAnswer rejects short agent intro stubs", () => {
    const h = installHelpers();
    expect(
      h.looksLikeInProgressAnswer(
        "I\u2019ll start by pulling the public DefiLlama data for top chains and recent hacks, then assess what Arkham Intel data is actually reachable without authentication.",
      ),
    ).toBe(true);
    expect(
      h.looksLikeInProgressAnswer(
        "I'll start by pulling the public DefiLlama data for top chains and recent hacks, then assess what Arkham Intel data is actually reachable without authentication.",
      ),
    ).toBe(true);
    expect(h.looksLikeInProgressAnswer("Let me check the latest chain TVL rankings.")).toBe(
      true,
    );
    expect(
      h.looksLikeInProgressAnswer(
        "I see you\u2019ve queued two distinct assignments. I\u2019ll prioritize the DeFi exploit-hunter task (latest) and begin the DefiLlama \u2192 Arkham workflow now.",
      ),
    ).toBe(true);
  });

  test("looksLikeInProgressAnswer accepts completed multi-block answers", () => {
    const h = installHelpers();
    const completed =
      "I'll start by pulling DefiLlama data.\n\n| Chain | Protocol | Risk |\n| Ethereum | Aave | Low |\n\nNo major exploitable contracts found today.";
    expect(h.looksLikeInProgressAnswer(completed)).toBe(false);
    expect(h.looksLikeFinalAnswer(completed)).toBe(true);
  });

  test("getCurrentReplyAssistantStartCount finds turn after last user prompt", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">First user prompt</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">First reply.</div></div>' +
      '<div class="content-editable-leaf-rtl">Second user prompt</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Second block A.</div></div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Second block B.</div></div>' +
      "</div>";
    expect(h.getCurrentReplyAssistantStartCount()).toBe(1);
    expect(h.getAssistantAnswerSince(h.getAssistantMessages(), h.getCurrentReplyAssistantStartCount())).toBe(
      "Second block A.\nSecond block B.",
    );
  });

  test("getAssistantAnswerSince joins all new assistant blocks", () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div class="notion-text-block"><div class="content-editable-leaf-rtl">First block.</div></div>
      <div class="notion-text-block"><div class="content-editable-leaf-rtl">Second block.</div></div>
      <div class="notion-text-block"><div class="content-editable-leaf-rtl">Third block.</div></div>
    `;
    const messages = h.getAssistantMessages();
    expect(messages).toHaveLength(3);
    expect(h.getAssistantAnswerSince(messages, 1)).toBe("Second block.\nThird block.");
    expect(h.getAssistantAnswerSince(messages, 0)).toBe(
      "First block.\nSecond block.\nThird block.",
    );
  });

  test("clickScrollToBottomButton clicks floating down-arrow FAB", () => {
    const h = installHelpers();
    let clicked = false;
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<button aria-label="Scroll to bottom" style="position:fixed;bottom:20px;right:20px;width:40px;height:40px;border-radius:50%">' +
      '<svg><path d="M6 10 L12 16 L18 10"></path></svg></button>' +
      "</div>";
    const fab = document.querySelector('button[aria-label="Scroll to bottom"]');
    fab.getBoundingClientRect = () => ({
      left: 900,
      top: 700,
      width: 40,
      height: 40,
      right: 940,
      bottom: 740,
      x: 900,
      y: 700,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    fab.addEventListener("click", () => {
      clicked = true;
      fab.remove();
    });
    const result = h.clickScrollToBottomButton();
    expect(result.clicked).toBe(true);
    expect(result.found).toBe(true);
    expect(clicked).toBe(true);
  });

  test("getAssistantTextFromReplyScope reads reply scope after revealLatestReplyInView", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Prefix line</div></div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Tail JSON block</div></div>' +
      REPLY_ACTION_BUTTONS +
      "</div>" +
      '<button aria-label="Scroll to bottom" style="position:fixed;bottom:20px;right:20px;width:40px;height:40px">' +
      '<svg><path d="M6 10 L12 16"></path></svg></button>' +
      "</div>";
    const text = h.getAssistantTextFromReplyScope();
    expect(text).toContain("Tail JSON block");
  });

  test("scrollToLatestReply returns click stats", async () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<button aria-label="Jump to bottom" style="position:fixed;bottom:24px;right:24px;width:36px;height:36px">' +
      '<svg><path d="M4 8 L12 16"></path></svg></button>' +
      "</div>";
    const fab = document.querySelector("button");
    fab.getBoundingClientRect = () => ({
      left: 900,
      top: 720,
      width: 36,
      height: 36,
      right: 936,
      bottom: 756,
      x: 900,
      y: 720,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    fab.addEventListener("click", () => fab.remove());
    const result = await h.scrollToLatestReply({ maxClicks: 2, pauseMs: 0 });
    expect(result.clicks).toBeGreaterThan(0);
    expect(result.scrolled).toBe(true);
  });

  test("scrollToLatestReply does not click New chat plus when no scroll FAB", async () => {
    const h = installHelpers();
    let newChatClicked = false;
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">completed answer</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + '</div>' +
      '</div>' +
      '<button aria-label="New chat" style="position:fixed;bottom:24px;right:24px;width:36px;height:36px">' +
      '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"></path></svg></button>' +
      '</div>';
    const newBtn = document.querySelector('[aria-label="New chat"]');
    newBtn.getBoundingClientRect = () => ({
      left: 900,
      top: 720,
      width: 36,
      height: 36,
      right: 936,
      bottom: 756,
      x: 900,
      y: 720,
    });
    Object.defineProperty(newBtn, "offsetParent", { configurable: true, value: document.body });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    newBtn.addEventListener("click", () => {
      newChatClicked = true;
    });
    expect(h.findScrollToBottomButton()).toBeNull();
    const result = await h.scrollToLatestReply({ maxClicks: 2, pauseMs: 0 });
    expect(newChatClicked).toBe(false);
    expect(result.clicks).toBe(0);
    expect(result.scrolled).toBe(false);
  });

  test("findScrollToBottomButton must not match Give context plus button", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div contenteditable="true" role="textbox" id="editor" style="position:fixed;bottom:80px;left:40px;width:600px;height:40px">draft</div>' +
      '<button aria-label="Submit AI message" id="submit" style="position:fixed;bottom:80px;right:120px;width:36px;height:36px">Send</button>' +
      '<button aria-label="Give context" id="giveCtx" style="position:fixed;bottom:80px;right:72px;width:36px;height:36px">' +
      '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"></path></svg></button>' +
      "</div>";
    const giveBtn = document.getElementById("giveCtx");
    giveBtn.getBoundingClientRect = () => ({
      left: 900,
      top: 764,
      width: 36,
      height: 36,
      right: 936,
      bottom: 800,
      x: 900,
      y: 764,
    });
    Object.defineProperty(giveBtn, "offsetParent", { configurable: true, value: document.body });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    expect(h.findScrollToBottomButton()).toBeNull();
  });

  test("getAssistantAnswerSince must not open Give context during prior-turn toolbar poll", () => {
    const h = installHelpers();
    let giveContextClicked = 0;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Follow-up user prompt</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Prior completed answer.</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + "</div>" +
      "</div>" +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Thinking</div></div>' +
      '<div contenteditable="true" role="textbox" id="editor" style="position:fixed;bottom:80px;left:40px;width:600px;height:40px">draft</div>' +
      '<button aria-label="Submit AI message" id="submit" style="position:fixed;bottom:80px;right:120px;width:36px;height:36px">Send</button>' +
      '<button aria-label="Give context" id="giveCtx" style="position:fixed;bottom:80px;right:72px;width:36px;height:36px">' +
      '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"></path></svg></button>' +
      "</div>";
    const giveBtn = document.getElementById("giveCtx");
    giveBtn.getBoundingClientRect = () => ({
      left: 900,
      top: 764,
      width: 36,
      height: 36,
      right: 936,
      bottom: 800,
      x: 900,
      y: 764,
    });
    Object.defineProperty(giveBtn, "offsetParent", { configurable: true, value: document.body });
    giveBtn.addEventListener("click", () => {
      giveContextClicked++;
      giveBtn.setAttribute("aria-expanded", "true");
    });

    const beforeCount = h.getCurrentReplyAssistantStartCount();
    const msgs = h.getAssistantMessagesSinceLastUser();
    const existing = h.getAssistantMessages();
    const beforeText =
      beforeCount < existing.length ? h.getAssistantText(existing[beforeCount]) : "Prior completed answer.";
    expect(h.hasCompletedReplyActions()).toBe(true);

    for (let i = 0; i < 3; i++) {
      h.getAssistantAnswerSince(msgs, beforeCount, beforeText);
    }

    expect(giveContextClicked).toBe(0);
    expect(giveBtn.getAttribute("aria-expanded")).not.toBe("true");
  });

  test("helpers version is 52", () => {
    const h = installHelpers();
    expect(h.version).toBe(52);
  });

  test("isStaleChatThread detects assistant messages and reply toolbar", () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">stale</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS_UNIFIED + '</div></div>';
    makeReplyToolbarVisible();
    expect(h.isStaleChatThread()).toBe(true);
  });

  test("shouldRunRevealSideEffect throttles reveal side effects during wait polling", () => {
    const h = installHelpers();
    expect(h.NOTION_REVEAL_THROTTLE_MS).toBe(2000);
    const throttle = { lastAt: 0 };
    expect(h.shouldRunRevealSideEffect(throttle)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(h.shouldRunRevealSideEffect(throttle)).toBe(false);
    }
    throttle.lastAt = Date.now() - h.NOTION_REVEAL_THROTTLE_MS;
    expect(h.shouldRunRevealSideEffect(throttle)).toBe(true);
  });

  test("getAssistantAnswerSince throttles revealLatestReplyInView during wait poll capture", () => {
    const h = installHelpers();
    let scrollClicks = 0;
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Follow-up user prompt</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Prior completed answer.</div></div>' +
      '<div class="reply-toolbar">' + REPLY_ACTION_BUTTONS + "</div>" +
      "</div>" +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Streaming JSON partial</div></div>' +
      '<button aria-label="Scroll to bottom" id="scrollFab" style="position:fixed;bottom:20px;right:20px;width:40px;height:40px">' +
      '<svg><path d="M6 10 L12 16 L18 10"></path></svg></button>' +
      "</div>";
    const fab = document.getElementById("scrollFab");
    fab.getBoundingClientRect = () => ({
      left: 900,
      top: 700,
      width: 40,
      height: 40,
      right: 940,
      bottom: 740,
      x: 900,
      y: 700,
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    fab.addEventListener("click", () => {
      scrollClicks++;
    });

    const beforeCount = h.getCurrentReplyAssistantStartCount();
    const msgs = h.getAssistantMessagesSinceLastUser();
    const existing = h.getAssistantMessages();
    const beforeText =
      beforeCount < existing.length ? h.getAssistantText(existing[beforeCount]) : "Prior completed answer.";
    const revealThrottle = { lastAt: 0 };
    const clicksPerPoll = [];

    for (let i = 0; i < 10; i++) {
      const before = scrollClicks;
      h.getAssistantAnswerSince(msgs, beforeCount, beforeText, { revealThrottle });
      clicksPerPoll.push(scrollClicks - before);
    }

    expect(clicksPerPoll[0]).toBeGreaterThan(0);
    expect(clicksPerPoll.slice(1).every((count) => count === 0)).toBe(true);
  });

  test("isUrlTrustPromptVisible finds dialog below long page prefix", () => {
    const h = installHelpers();
    const prefix = "sidebar ".repeat(2000);
    document.body.innerHTML =
      prefix +
      '<div id="trust-card"><div>Do you trust api.llama.fi?</div><button>Allow once</button></div>';
    expect(h.isUrlTrustPromptVisible()).toBe(true);
    expect(h.acceptUrlTrustPrompt()).toBe(true);
  });

  test("detectNotionPageAbnormal ignores chat transcript mentioning rate limits", () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div class="layout-chat">
        <div class="content-editable-leaf-rtl">API rate limits are common. Try again later if needed.</div>
        <div contenteditable="true" role="textbox" id="editor">draft prompt</div>
        <button aria-label="Submit AI message">Send</button>
      </div>
    `;
    expect(h.detectNotionPageAbnormal()).toBeNull();
  });

  test("detectNotionPageAbnormal catches rate-limit alerts outside transcript", () => {
    const h = installHelpers();
    document.body.innerHTML = `
      <div class="layout-chat">
        <div class="content-editable-leaf-rtl">Normal answer text.</div>
        <div contenteditable="true" role="textbox" id="editor"></div>
        <button aria-label="Submit AI message">Send</button>
      </div>
      <div role="alert">Rate limit reached. Please wait before retrying.</div>
    `;
    expect(h.detectNotionPageAbnormal()).toEqual({
      error: "Rate limit reached",
      kind: "rate_limit",
      hint: "Notion AI rate limit detected. Wait before retrying.",
      action: "wait and retry",
    });
  });

  test("resolveNotionMode maps aliases", () => {
    const h = installHelpers();
    expect(h.resolveNotionMode("sonnet")).toBe("Sonnet 4.6");
    expect(h.resolveNotionMode("auto")).toBe("Auto");
    expect(h.resolveNotionMode("sonnet-4-6")).toBe("Sonnet 4.6");
  });

  test("resolveNotionMode maps every MODE_ALIASES key", () => {
    const h = installHelpers();
    for (const [alias, title] of Object.entries(h.MODE_ALIASES)) {
      expect(h.resolveNotionMode(alias)).toBe(title);
    }
  });

  test("resolveNotionBehaviorMode maps behavior aliases", () => {
    const h = installHelpers();
    expect(h.resolveNotionBehaviorMode("ask")).toBe("Ask");
    expect(h.resolveNotionBehaviorMode("research")).toBe("Research");
    for (const [alias, title] of Object.entries(h.BEHAVIOR_MODE_ALIASES)) {
      expect(h.resolveNotionBehaviorMode(alias)).toBe(title);
    }
  });

  test("modelTitleToId derives stable slugs", () => {
    const h = installHelpers();
    expect(h.modelTitleToId("Sonnet 4.6")).toBe("sonnet-4-6");
    expect(h.modelTitleToId("GPT-5.4")).toBe("gpt-5-4");
    expect(modelTitleToId("Grok Build 0.1")).toBe("grok-build-0-1");
  });

  test("isModelTitleMapped flags known and unknown titles", () => {
    const h = installHelpers();
    expect(h.isModelTitleMapped("Auto")).toBe(true);
    expect(h.isModelTitleMapped("Brand New Model 9.9")).toBe(false);
  });

  test("isLikelyModelMenuTitle rejects chat history sidebar entries", () => {
    const h = installHelpers();
    expect(h.isLikelyModelMenuTitle("Search news on protest\n1h")).toBe(false);
    expect(h.isLikelyModelMenuTitle("Sonnet 4.6")).toBe(true);
  });

  test("readModelMenuItemTitle reads role=presentation under role=dialog menuitem only", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div role="dialog" id="models">
          <div role="menuitem" id="flat">Sonnet 4.6</div>
          <div role="menuitem" id="nested">
            <div role="presentation"></div>
            <div role="presentation">Sonnet 4.6</div>
            <div role="presentation">Fast</div>
          </div>
          <div role="menuitem" id="subtitle">Sonnet 4.6\nRecommended for coding</div>
        </div>
        <div role="menuitem" id="outside">
          <div role="presentation">Sonnet 4.6 Recommended</div>
        </div>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    expect(h.readModelMenuItemTitle(document.getElementById("flat"))).toBe("");
    expect(h.readModelMenuItemTitle(document.getElementById("nested"))).toBe("Sonnet 4.6");
    expect(h.readModelMenuItemTitle(document.getElementById("subtitle"))).toBe("");
    expect(h.readModelMenuItemTitle(document.getElementById("outside"))).toBe("");
  });

  test("findModelMenuItem matches nested presentation labels in role=dialog", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div id="models" role="dialog">
          <div role="menuitem">
            <div role="presentation"></div>
            <div role="presentation">Auto</div>
          </div>
          <div role="menuitem">
            <div role="presentation"></div>
            <div role="presentation">Sonnet 4.6</div>
            <div role="presentation">Fast</div>
          </div>
        </div>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();
    const surface = document.getElementById("models");

    expect(h.findModelMenuItem(surface, "Sonnet 4.6")?.getAttribute("role")).toBe("menuitem");
    expect(h.findModelMenuItem(surface, "Missing Model")).toBeNull();
  });

  test("findModelPickerButton anchors unified-chat-model-button test id", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div role="button" tabindex="0" data-testid="unified-chat-model-button" aria-expanded="false">Auto</div>
        <button id="sidebar-model">Auto</button>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    Object.defineProperty(window, "innerWidth", { value: 1125, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    const picker = document.querySelector('[data-testid="unified-chat-model-button"]');
    const sidebar = document.getElementById("sidebar-model");
    for (const el of [picker, sidebar]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    }
    picker.getBoundingClientRect = () => ({
      left: 600,
      top: 300,
      width: 120,
      height: 28,
      right: 720,
      bottom: 328,
      x: 600,
      y: 300,
    });
    sidebar.getBoundingClientRect = () => ({
      left: 20,
      top: 100,
      width: 80,
      height: 28,
      right: 100,
      bottom: 128,
      x: 20,
      y: 100,
    });

    expect(h.findModelPickerButton()).toBe(picker);
    expect(h.readNotionModeLabel()).toBe("Auto");
  });

  test("findModelPickerSurface prefers in-viewport model menu near picker", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <button id="picker">Sonnet 4.6</button>
        <div id="sidebar" role="menu">
          <div role="menuitem">Search news on protest\n1h</div>
          <div role="menuitem">Auto</div>
          <div role="menuitem">Sonnet 4.6</div>
        </div>
        <div id="models" role="dialog">
          <div role="menuitem"><div role="presentation">Auto</div></div>
          <div role="menuitem"><div role="presentation">Sonnet 4.6</div></div>
          <div role="menuitem"><div role="presentation">Opus 4.7</div></div>
        </div>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    Object.defineProperty(window, "innerWidth", { value: 1125, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    const picker = document.getElementById("picker");
    const sidebar = document.getElementById("sidebar");
    const models = document.getElementById("models");
    for (const el of [picker, sidebar, models]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    }
    picker.getBoundingClientRect = () => ({
      left: 600,
      top: 300,
      width: 120,
      height: 28,
      right: 720,
      bottom: 328,
      x: 600,
      y: 300,
    });
    sidebar.getBoundingClientRect = () => ({
      left: -250,
      top: 100,
      width: 270,
      height: 400,
      right: 20,
      bottom: 500,
      x: -250,
      y: 100,
    });
    models.getBoundingClientRect = () => ({
      left: 580,
      top: 340,
      width: 288,
      height: 300,
      right: 868,
      bottom: 640,
      x: 580,
      y: 340,
    });

    expect(h.findModelPickerSurface(picker)?.id).toBe("models");
    const knownTitles = [...new Set(Object.values(h.MODE_ALIASES))];
    expect(h.scoreModelPickerSurface(sidebar, picker, knownTitles)).toBeLessThan(
      h.scoreModelPickerSurface(models, picker, knownTitles),
    );
  });

  test("findBehaviorModeSurface prefers in-viewport behavior mode menu near settings entry", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div id="modeEntry" role="menuitem">Mode Default</div>
        <div id="sidebar" role="menu">
          <div role="menuitemradio">Default</div>
          <div role="menuitemradio">Ask</div>
        </div>
        <div id="behaviorMenu" role="menu">
          <div role="menuitemradio">Default\nCan search, edit, and more</div>
          <div role="menuitemradio">Ask\nAnswers only</div>
          <div role="menuitemradio">Plan\nPlans first</div>
          <div role="menuitemradio">Research\nThink deeper</div>
        </div>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    const modeEntry = document.getElementById("modeEntry");
    const sidebar = document.getElementById("sidebar");
    const behaviorMenu = document.getElementById("behaviorMenu");
    for (const el of [modeEntry, sidebar, behaviorMenu]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    }
    modeEntry.getBoundingClientRect = () => ({ left: 140, top: 250, width: 272, height: 28, right: 412, bottom: 278, x: 140, y: 250 });
    sidebar.getBoundingClientRect = () => ({ left: -250, top: 100, width: 270, height: 120, right: 20, bottom: 220, x: -250, y: 100 });
    behaviorMenu.getBoundingClientRect = () => ({ left: 412, top: 165, width: 280, height: 205, right: 692, bottom: 370, x: 412, y: 165 });

    const knownTitles = h.getKnownBehaviorModeTitles ? h.getKnownBehaviorModeTitles() : Object.values(h.BEHAVIOR_MODE_ALIASES);
    expect(h.findBehaviorModeSurface(modeEntry)?.id).toBe("behaviorMenu");
    expect(h.scoreBehaviorModeSurface(sidebar, modeEntry, knownTitles)).toBeLessThan(
      h.scoreBehaviorModeSurface(behaviorMenu, modeEntry, knownTitles),
    );
  });

  test("findGiveContextButton prefers in-viewport button near editor and submit", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <div id="composer">
          <div contenteditable="true" role="textbox" id="editor"></div>
          <button aria-label="Give context" id="ctxNear"></button>
          <button aria-label="Submit AI message" id="submit"></button>
        </div>
        <button aria-label="Give context" id="ctxFar"></button>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    const editor = document.getElementById("editor");
    const ctxNear = document.getElementById("ctxNear");
    const ctxFar = document.getElementById("ctxFar");
    const submit = document.getElementById("submit");
    for (const el of [editor, ctxNear, ctxFar, submit]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    }
    editor.getBoundingClientRect = () => ({ left: 100, top: 300, width: 400, height: 40, right: 500, bottom: 340, x: 100, y: 300 });
    submit.getBoundingClientRect = () => ({ left: 600, top: 319, width: 32, height: 32, right: 632, bottom: 351, x: 600, y: 319 });
    ctxNear.getBoundingClientRect = () => ({ left: 108, top: 319, width: 28, height: 28, right: 136, bottom: 347, x: 108, y: 319 });
    ctxFar.getBoundingClientRect = () => ({ left: 50, top: 50, width: 28, height: 28, right: 78, bottom: 78, x: 50, y: 50 });

    expect(h.findGiveContextButton()?.id).toBe("ctxNear");
    expect(h.scoreGiveContextButton(ctxFar, editor, submit)).toBeLessThan(
      h.scoreGiveContextButton(ctxNear, editor, submit),
    );
  });

  test("scoreGiveContextSurface ranks Give context menu above Settings menu", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <button id="anchor" aria-label="Give context"></button>
        <div id="settingsMenu" role="dialog">
          <div role="menuitem">Web access</div>
          <div role="menuitem">My sources</div>
          <div role="menuitem">Add sources</div>
        </div>
        <div id="giveMenu" role="dialog">
          <div role="menuitem">Add photos and files</div>
          <div role="menuitem">Mention pages or people</div>
          <div role="menuitem">Create image</div>
        </div>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    const anchor = document.getElementById("anchor");
    const settingsMenu = document.getElementById("settingsMenu");
    const giveMenu = document.getElementById("giveMenu");
    for (const el of [anchor, settingsMenu, giveMenu]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    }
    anchor.getBoundingClientRect = () => ({ left: 108, top: 319, width: 28, height: 28, right: 136, bottom: 347, x: 108, y: 319 });
    settingsMenu.getBoundingClientRect = () => ({ left: 136, top: 155, width: 280, height: 160, right: 416, bottom: 315, x: 136, y: 155 });
    giveMenu.getBoundingClientRect = () => ({ left: 108, top: 222, width: 230, height: 120, right: 338, bottom: 342, x: 108, y: 222 });

    expect(h.findGiveContextSurface(anchor)?.id).toBe("giveMenu");
    expect(h.scoreGiveContextSurface(settingsMenu, anchor)).toBe(-1);
    expect(h.scoreGiveContextSurface(giveMenu, anchor)).toBeGreaterThan(0);
  });

  test("scorePagePickerSurface prefers option list near Give context anchor", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <button id="anchor" aria-label="Give context"></button>
        <div id="settingsMenu" role="dialog">
          <div role="menuitem">Web access</div>
        </div>
        <div id="pagePicker" role="dialog">
          <input placeholder="Search…" />
          <div role="option">E2E Complete (Edited)</div>
          <div role="option">My Notion AI</div>
        </div>
      </body></html>`,
      { url: "https://app.notion.com/ai" },
    );
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
    const h = loadHelpers()();

    const anchor = document.getElementById("anchor");
    const settingsMenu = document.getElementById("settingsMenu");
    const pagePicker = document.getElementById("pagePicker");
    for (const el of [anchor, settingsMenu, pagePicker]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    }
    anchor.getBoundingClientRect = () => ({ left: 108, top: 319, width: 28, height: 28, right: 136, bottom: 347, x: 108, y: 319 });
    settingsMenu.getBoundingClientRect = () => ({ left: 140, top: 155, width: 280, height: 80, right: 420, bottom: 235, x: 140, y: 155 });
    pagePicker.getBoundingClientRect = () => ({ left: 112, top: 180, width: 260, height: 200, right: 372, bottom: 380, x: 112, y: 180 });

    expect(h.findPagePickerSurface(anchor)?.id).toBe("pagePicker");
    expect(h.scorePagePickerSurface(settingsMenu, anchor)).toBe(-1);
    expect(h.scorePagePickerSurface(pagePicker, anchor)).toBeGreaterThan(0);
  });

  test("parsePageReferences extracts search terms from URLs and comma lists", () => {
    const h = installHelpers();
    const refs = h.parsePageReferences("My Notion AI, E2E Complete (Edited)", "Quick Notes");
    expect(refs.map((r) => r.title)).toEqual(["Quick Notes", "My Notion AI", "E2E Complete (Edited)"]);

    const fromUrl = h.normalizePageReference(
      "https://www.notion.so/My-Workspace/E2E-Complete-Edited-abc123def4567890abcdef1234567890",
    );
    expect(fromUrl.search.toLowerCase()).toContain("e2e");
  });

  test("prepareNotionAttachmentPlan merges context, files, and pages", () => {
    const h = installHelpers();
    const plan = h.prepareNotionAttachmentPlan({
      query: "Summarize",
      context: "Background info",
      fileName: "notes.txt",
      fileContent: "hello",
      page: "My Notion AI",
    });
    expect(plan.hasAttachments).toBe(true);
    expect(plan.hasFiles).toBe(true);
    expect(plan.hasPages).toBe(true);
    expect(plan.query).toContain("--- External context ---");
    expect(plan.query).toContain("Summarize");
    expect(plan.files[0].fileName).toBe("notes.txt");
    expect(plan.pages[0].title).toBe("My Notion AI");
  });

  test("prepareNotionAttachmentPlan decodes base64 file bytes", () => {
    const h = installHelpers();
    const bytes = h.decodeNotionBase64("aGVsbG8=");
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
    expect(h.guessNotionMimeType("doc.pdf")).toBe("application/pdf");
  });

  test("buildConversationUrl returns chat URL", () => {
    const h = installHelpers();
    expect(h.buildConversationUrl("37b746ce-978e-8096-8d54-00a96c21f6ad")).toBe(
      "https://app.notion.com/chat?t=37b746ce978e80968d5400a96c21f6ad&wfv=chat",
    );
  });

  test("ensureAiLandingPage returns ok on /ai", async () => {
    const h = installHelpersAt("https://app.notion.com/ai");
    await expect(h.ensureAiLandingPage()).resolves.toEqual({
      ok: true,
      via: "ai-landing",
    });
  });

  test("ensureAiLandingPage returns ok on /chat", async () => {
    const h = installHelpersAt(
      "https://app.notion.com/chat?t=37b746ce978e80968d5400a96c21f6ad&wfv=chat",
    );
    await expect(h.ensureAiLandingPage()).resolves.toEqual({
      ok: true,
      via: "chat-view",
    });
  });

  test("ensureAiLandingPage redirects workspace home to /ai", async () => {
    const h = installHelpersAt("https://app.notion.com/", { trackNavigation: true });
    const result = await h.ensureAiLandingPage();
    expect(result).toEqual({
      ok: false,
      needsRetry: true,
      error: "Navigation required",
      hint: "Re-run the same command after Notion opens the AI landing page.",
      action: "retry same command",
    });
    expect(h.__navigationLog).toEqual(["https://app.notion.com/ai"]);
    expect(sessionStorage.getItem("__notionAiPendingLanding")).toBe("1");
  });

  test("ensureNewChatView redirects non-AI pages to /ai", async () => {
    const h = installHelpersAt("https://app.notion.com/", { trackNavigation: true });
    const result = await h.ensureNewChatView();
    expect(result.ok).toBe(false);
    expect(result.needsRetry).toBe(true);
    expect(h.__navigationLog).toEqual(["https://app.notion.com/ai"]);
  });

  test("queryExpectsJson detects JSON-only prompt instructions", () => {
    const h = installHelpers();
    expect(h.queryExpectsJson("Return ONLY valid JSON with this structure")).toBe(true);
    expect(h.queryExpectsJson("Respond with only JSON: {\"ok\":true}")).toBe(true);
    expect(h.queryExpectsJson("Return JSON only. json format only")).toBe(true);
    expect(h.queryExpectsJson("show me the unique topics in JSON format only")).toBe(true);
    expect(h.queryExpectsJson("Say hello in three words")).toBe(false);
  });

  test("isOpusMode recognizes opus aliases and titles", () => {
    const h = installHelpers();
    expect(h.isOpusMode("opus")).toBe(true);
    expect(h.isOpusMode("opus-4.7")).toBe(true);
    expect(h.isOpusMode("Opus 4.7")).toBe(true);
    expect(h.isOpusMode("sonnet")).toBe(false);
    expect(h.isOpusMode("auto")).toBe(false);
  });

  test("shouldModelFallbackOnJsonStuck requires opus JSON and enabled fallback", () => {
    const h = installHelpers();
    const jsonQuery = "Return ONLY valid JSON with this structure";
    expect(h.shouldModelFallbackOnJsonStuck("opus", jsonQuery, {})).toBe(true);
    expect(h.shouldModelFallbackOnJsonStuck("sonnet", jsonQuery, {})).toBe(false);
    expect(h.shouldModelFallbackOnJsonStuck("opus", "plain prose please", {})).toBe(false);
    expect(h.shouldModelFallbackOnJsonStuck("opus", jsonQuery, { modelFallback: false })).toBe(false);
    expect(h.shouldModelFallbackOnJsonStuck("opus", "plain prose", { expectJson: true })).toBe(true);
    expect(h.resolveModelFallbackTarget("opus", {})).toBe("Auto");
    expect(h.resolveModelFallbackTarget("opus", { modelFallbackTo: "sonnet" })).toBe("Sonnet 4.6");
  });

  test("incomplete JSON with expectJson triggers fallback to auto", () => {
    const h = installHelpers();
    const opts = { expectJson: true, modelFallback: true, mode: "grok" };
    const partial = '{"query":"Fed interest rate';
    expect(h.isIncompleteJsonFailedAnswer(partial, opts)).toBe(true);
    expect(h.rejectIncompleteJsonFailedAnswer(partial, opts)).toBe("");
    expect(h.wasLastWaitIncompleteJsonFailed()).toBe(true);
    expect(h.getModelFallbackTriggerReason()).toBe("incomplete_json_failed");
    expect(h.shouldRetryModelFallback("grok", "plain", opts)).toBe(true);
    expect(h.shouldModelFallbackOnIncompleteJson("auto", opts)).toBe(false);
    expect(h.rejectIncompleteJsonFailedAnswer('{"ok":true}', opts)).toBe('{"ok":true}');
  });

  test("buildWaitOpts maps bun-browser --json to expectJson", () => {
    const h = installHelpers();
    const opts = h.buildWaitOpts({ json: true, query: "Summarize this article" });
    expect(opts.expectJson).toBe(true);
  });

  test("buildWaitOpts reads maxWaitMs from positional index 6", () => {
    const h = installHelpers();
    const opts = h.buildWaitOpts({
      _positional: ["Reply", "auto", "true", "false", "false", "", "5000"],
    });
    expect(opts.maxWaitMs).toBe(5000);
  });

  test("buildWaitOpts prefers named maxWaitMs over positional", () => {
    const h = installHelpers();
    const opts = h.buildWaitOpts({
      maxWaitMs: 8000,
      _positional: ["Reply", "auto", "true", "false", "false", "", "5000"],
    });
    expect(opts.maxWaitMs).toBe(8000);
  });

  test("buildJsonAnswerFields honors expectJson without JSON phrasing in query", () => {
    const h = installHelpers();
    const answer = '{"status":"ok","code":"PING-1"}';
    expect(h.buildJsonAnswerFields(answer, "Summarize this article")).toBeNull();
    expect(h.buildJsonAnswerFields(answer, "Summarize this article", { expectJson: true })).not.toBeNull();
  });

  test("single-char failed response triggers fallback for opus sonnet fable only", () => {
    const h = installHelpers();
    expect(h.isSingleCharModelResponse("x")).toBe(true);
    expect(h.isSingleCharModelResponse("OK")).toBe(false);
    expect(h.isSingleCharModelResponse(" ")).toBe(false);
    expect(h.isPremiumFallbackModel("opus")).toBe(true);
    expect(h.isPremiumFallbackModel("sonnet")).toBe(true);
    expect(h.isPremiumFallbackModel("fable")).toBe(true);
    expect(h.isPremiumFallbackModel("auto")).toBe(false);
    expect(h.shouldModelFallbackOnSingleCharFailed("opus", {})).toBe(true);
    expect(h.shouldModelFallbackOnSingleCharFailed("auto", {})).toBe(false);
    expect(h.rejectSingleCharFailedAnswer("?", { mode: "opus" })).toBe("");
    expect(h.wasLastWaitSingleCharFailed()).toBe(true);
    expect(h.getModelFallbackTriggerReason()).toBe("single_char_failed");
    expect(h.shouldRetryModelFallback("opus", "plain", { modelFallback: true })).toBe(true);
    expect(h.rejectSingleCharFailedAnswer("?", { mode: "auto" })).toBe("?");
    expect(h.shouldRetryModelFallback("auto", "plain", {})).toBe(false);
  });

  test("waitForAssistantAnswer rejects single-char premium model reply for fallback", async () => {
    const h = installHelpers();
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">hello</div>' +
      '<div class="assistant-turn">' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">?</div></div>' +
      '<div class="reply-toolbar">' +
      REPLY_ACTION_BUTTONS_UNIFIED +
      "</div></div></div>";
    makeReplyToolbarVisible();
    const pending = h.waitForAssistantAnswer(0, "", {
      pollMs: 50,
      maxWaitMs: 1000,
      mode: "sonnet",
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const answer = await pending;
    expect(answer).toBe("");
    expect(h.wasLastWaitSingleCharFailed()).toBe(true);
  });

  test("waitForAssistantAnswer flags incomplete JSON stuck after stable threshold", async () => {
    const h = installHelpers();
    const partial = '{"query":"Fed interest rate';
    document.body.innerHTML =
      '<div class="layout-chat">' +
      '<div class="content-editable-leaf-rtl">Return ONLY valid JSON</div>' +
      '<div class="notion-text-block"><div class="content-editable-leaf-rtl">' +
      partial +
      "</div></div></div>";
    const pending = h.waitForAssistantAnswer(0, "", {
      pollMs: 50,
      maxWaitMs: 5000,
      expectJson: true,
      query: "Return ONLY valid JSON",
      modelFallbackStuckMs: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 280));
    const answer = await pending;
    expect(answer).toBe("");
    expect(h.wasLastWaitIncompleteJsonStuck()).toBe(true);
  });

  test("looksLikeFinalAnswer rejects incomplete streaming JSON", () => {
    const h = installHelpers();
    const partial =
      '{"query": "moving the all of 4T USD into onchain", "time_period": "from: 2026-06-10T14:30:00Z", "unique_topics": ["Stand';
    expect(h.looksLikeJsonAnswerAttempt(partial)).toBe(true);
    expect(h.hasParsedJsonAnswer(partial)).toBe(false);
    expect(h.looksLikeFinalAnswer(partial)).toBe(false);
  });

  test("looksLikeFinalAnswer accepts complete JSON object", () => {
    const h = installHelpers();
    const complete =
      '{"query":"moving the all of 4T USD into onchain","time_period":"from: 2026-06-10T14:30:00Z","unique_topics":["Stablecoin"],"sources":"reuters.com"}';
    expect(h.looksLikeFinalAnswer(complete)).toBe(true);
    expect(h.hasParsedJsonAnswer(complete)).toBe(true);
  });

  test("extractJsonBlock uses balanced braces with preamble", () => {
    const h = installHelpers();
    const answer =
      'Note: use {braces} carefully.\n{"status":"ok","code":"PING-1"}';
    expect(h.extractJsonBlock(answer)).toBe('{"status":"ok","code":"PING-1"}');
    expect(h.parseAnswerJson(answer)).toEqual({ status: "ok", code: "PING-1" });
  });

  test("extractJsonBlock parses fenced json blocks", () => {
    const h = installHelpers();
    const answer = 'Here you go:\n```json\n{"topic_times":[]}\n```';
    expect(h.parseAnswerJson(answer)).toEqual({ topic_times: [] });
  });

  test("buildJsonAnswerFields recovers compact JSON from Opus-style preamble", () => {
    const h = installHelpers();
    const query = "Return ONLY valid JSON with topic_times.";
    const answer =
      "I researched each topic across the publisher set.\n" +
      '{\n"topic_times": [\n{"topic": "SpaceX IPO", "most_recent_occurred_at": "2026-06-09T00:00:00Z"}\n]\n}';
    const fields = h.buildJsonAnswerFields(answer, query);
    expect(fields).not.toBeNull();
    expect(fields.answerFormat).toBe("json");
    expect(fields.jsonRecovered).toBe(true);
    expect(fields.answer).toBe(
      JSON.stringify({
        topic_times: [{ topic: "SpaceX IPO", most_recent_occurred_at: "2026-06-09T00:00:00Z" }],
      }),
    );
    expect(fields.answerJson).toEqual({
      topic_times: [{ topic: "SpaceX IPO", most_recent_occurred_at: "2026-06-09T00:00:00Z" }],
    });
  });

  test("buildJsonAnswerFields returns null when query does not expect JSON", () => {
    const h = installHelpers();
    const answer = '{"status":"ok"}';
    expect(h.buildJsonAnswerFields(answer, "Summarize this article")).toBeNull();
    expect(h.parseAnswerJson(answer)).toEqual({ status: "ok" });
  });

  test("buildJsonAnswerFields returns null for invalid JSON", () => {
    const h = installHelpers();
    const query = "Return ONLY valid JSON.";
    expect(h.buildJsonAnswerFields('{"status":', query)).toBeNull();
    expect(h.buildJsonAnswerFields("Still generating...", query)).toBeNull();
  });

  test("buildJsonAnswerFields omits jsonRecovered when answer already compact", () => {
    const h = installHelpers();
    const query = "Return ONLY valid JSON.";
    const compact = '{"status":"ok"}';
    const fields = h.buildJsonAnswerFields(compact, query);
    expect(fields).not.toBeNull();
    expect(fields.answer).toBe(compact);
    expect(fields.jsonRecovered).toBeUndefined();
  });

  test("ensureNewChatView returns ok on /ai with chat input", async () => {
    const h = installHelpersAt("https://app.notion.com/ai");
    document.body.innerHTML =
      '<div contenteditable="true" role="textbox" id="editor"></div>';
    const editor = document.getElementById("editor");
    Object.defineProperty(editor, "offsetParent", { value: document.body, configurable: true });
    editor.getBoundingClientRect = () => ({
      left: 100,
      top: 300,
      width: 400,
      height: 40,
      right: 500,
      bottom: 340,
      x: 100,
      y: 300,
    });
    await expect(h.ensureNewChatView()).resolves.toEqual({
      ok: true,
      via: "ai-landing",
    });
  });

  test("ensureNotionModelListView returns ok when model picker is already visible", async () => {
    const h = installHelpersAt("https://www.notion.so/my-workspace");
    document.body.innerHTML =
      '<div role="button" data-testid="unified-chat-model-button">Sonnet 4.6</div>';
    const picker = document.querySelector('[data-testid="unified-chat-model-button"]');
    Object.defineProperty(picker, "offsetParent", { value: document.body, configurable: true });
    picker.getBoundingClientRect = () => ({
      left: 600,
      top: 300,
      width: 120,
      height: 28,
      right: 720,
      bottom: 328,
      x: 600,
      y: 300,
    });
    await expect(h.ensureNotionModelListView()).resolves.toEqual({
      ok: true,
      via: "model-picker",
    });
  });

  test("focusChatInput focuses visible composer", () => {
    const h = installHelpersAt("https://app.notion.com/ai");
    document.body.innerHTML =
      '<div contenteditable="true" role="textbox" id="editor"></div>';
    const editor = document.getElementById("editor");
    Object.defineProperty(editor, "offsetParent", { value: document.body, configurable: true });
    editor.getBoundingClientRect = () => ({
      left: 100,
      top: 300,
      width: 400,
      height: 40,
      right: 500,
      bottom: 340,
      x: 100,
      y: 300,
    });
    expect(h.focusChatInput()).toBe(true);
    expect(document.activeElement).toBe(editor);
  });

  test("closeModelPickerSurface dismisses open model menu and restores composer focus", async () => {
    const h = installHelpersAt("https://app.notion.com/ai");
    document.body.innerHTML = `
      <div contenteditable="true" role="textbox" id="editor"></div>
      <div role="button" data-testid="unified-chat-model-button" aria-expanded="true">Auto</div>
      <div id="models" role="dialog">
        <div role="menuitem"><div role="presentation">Auto</div></div>
        <div role="menuitem"><div role="presentation">Sonnet 4.6</div></div>
        <div role="menuitem"><div role="presentation">Opus 4.7</div></div>
      </div>`;
    const editor = document.getElementById("editor");
    const picker = document.querySelector('[data-testid="unified-chat-model-button"]');
    const models = document.getElementById("models");
    for (const el of [editor, picker, models]) {
      Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
      el.getBoundingClientRect = () => ({
        left: 580,
        top: 300,
        width: 288,
        height: 300,
        right: 868,
        bottom: 600,
        x: 580,
        y: 300,
      });
    }
    expect(h.isModelPickerMenuOpen(picker)).toBe(true);
    await h.closeModelPickerSurface(picker);
    picker.setAttribute("aria-expanded", "false");
    models.remove();
    expect(h.isModelPickerMenuOpen(picker)).toBe(false);
    expect(document.activeElement).toBe(editor);
  });
});

describe("notion api-schemas", () => {
  test("validateAnswerComplete accepts prose", () => {
    const result = validateAnswerComplete("Hello there, Joseph.");
    expect(result.ok).toBe(true);
  });

  test("validateAnswerComplete rejects progress-only answers", () => {
    expect(validateAnswerComplete("Thinking").ok).toBe(false);
    expect(validateAnswerComplete("Notion AI finished.").ok).toBe(false);
  });

  test("looksLikeCompleteAnswer matches helper heuristics", () => {
    expect(looksLikeCompleteAnswer("OK-NOTION-FLOW")).toBe(true);
    expect(looksLikeCompleteAnswer("Auto")).toBe(false);
  });

  test("NOTION_MODE_ALIASES covers all helper alias keys", () => {
    const h = installHelpers();
    expect(Object.keys(NOTION_MODE_ALIASES).sort()).toEqual(
      Object.keys(h.MODE_ALIASES).sort(),
    );
  });

  test("isAbnormalResponse recognizes free AI quota error", () => {
    expect(
      isAbnormalResponse({
        error: "Run out of free AI responses",
        kind: "credits_exhausted",
      }),
    ).toBe(true);
  });

  test("isAbnormalResponse recognizes prompt rejection error", () => {
    expect(
      isAbnormalResponse({
        error: "An error occurred, please try again.",
        kind: "prompt_rejected",
      }),
    ).toBe(true);
  });
});
