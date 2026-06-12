/**
 * Unit tests for grok chat completion heuristics (stuck-at-96% scenarios).
 * Run: bun test grok/test-chat-helpers.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, test, beforeEach } from "bun:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helpersSource = readFileSync(join(__dirname, "chat-helpers.js"), "utf8");

const TOPIC_JSON = JSON.stringify(
  {
    topic_id: "t1",
    cluster_id: "c17",
    topic_primary_event: "Company reported earnings.",
    event_type: "Earnings",
  },
  null,
  2,
);

function installHelpers() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://grok.com/",
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Node = dom.window.Node;
  globalThis.sessionStorage = dom.window.sessionStorage;
  const loadHelpers = new Function(`${helpersSource}\nreturn installGrokChatHelpers;`);
  return loadHelpers()();
}

function assistantMessage({ innerHTML, innerText, streaming = false }) {
  const el = document.createElement("div");
  el.setAttribute("data-testid", "assistant-message");
  el.innerHTML = innerHTML;
  if (innerText != null) {
    Object.defineProperty(el, "innerText", {
      configurable: true,
      get: () => innerText,
    });
  }
  if (streaming) {
    const pulse = document.createElement("span");
    pulse.className = "animate-pulse";
    el.appendChild(pulse);
  }
  document.body.appendChild(el);
  return el;
}

function stopButton(enabled = true) {
  const btn = document.createElement("button");
  btn.setAttribute("aria-label", "Stop generating");
  btn.disabled = !enabled;
  document.body.appendChild(btn);
  return btn;
}

describe("grok chat completion detection", () => {
  let h;

  beforeEach(() => {
    h = installHelpers();
    document.body.innerHTML = "";
  });

  test("hasParsedJsonAnswer accepts fenced JSON", () => {
    const wrapped = "```json\n" + TOPIC_JSON + "\n```";
    expect(h.hasParsedJsonAnswer(wrapped)).toBe(true);
  });

  test("isGrokGenerating is false when valid JSON is visible but stop button remains", () => {
    assistantMessage({
      innerHTML: "<pre><code>" + TOPIC_JSON + "</code></pre>",
      innerText: "Thought for 47s\n" + TOPIC_JSON,
    });
    stopButton(true);
    expect(h.isGrokGenerating()).toBe(false);
  });

  test("isGrokReplyPending is false when JSON is in code block with streaming UI", () => {
    assistantMessage({
      innerHTML: "<pre><code>" + TOPIC_JSON + "</code></pre>",
      innerText: "Thought for 47s\n" + TOPIC_JSON,
      streaming: true,
    });
    stopButton(true);
    expect(h.isGrokReplyPending(0, "")).toBe(false);
  });

  test("isGrokReplyPending stays true for incomplete brace-only raw text", () => {
    assistantMessage({
      innerHTML: "<p>{ incomplete",
      innerText: "Thought for 12s\n{ incomplete",
    });
    expect(h.isGrokReplyPending(0, "")).toBe(true);
  });

  test("looksLikeFinalAnswer rejects computer-use Open page narration", () => {
    const openPage = "Open page https://example.com/news/article";
    expect(h.looksLikeFinalAnswer(openPage)).toBe(false);
    expect(h.isProgressText(openPage)).toBe(true);
  });

  test("isGrokReplyPending stays true when only Open page text is visible", () => {
    assistantMessage({
      innerHTML: "<p>Open page https://example.com</p>",
      innerText: "Thought for 8s\nOpen page https://example.com",
    });
    expect(h.isGrokReplyPending(0, "")).toBe(true);
  });

  test("cleanAssistantText strips Open page lines and keeps the final prose", () => {
    const cleaned = h.cleanAssistantText(
      "Thought for 20s\nOpen page https://example.com\nHere is the final answer with enough detail.",
    );
    expect(cleaned).toBe("Here is the final answer with enough detail.");
    expect(h.looksLikeFinalAnswer(cleaned)).toBe(true);
  });

  test("waitForAssistantAnswer returns JSON without waiting for generating UI to clear", async () => {
    assistantMessage({
      innerHTML: "<pre><code>" + TOPIC_JSON + "</code></pre>",
      innerText: "Thought for 47s\n" + TOPIC_JSON,
      streaming: true,
    });
    stopButton(true);

    const answer = await h.waitForAssistantAnswer(0, "", {
      pollMs: 20,
      maxWaitMs: 500,
      stableNeeded: 2,
    });

    expect(answer).toBe(TOPIC_JSON);
    expect(h.wasLastWaitPending()).toBe(false);
  });

  test("looksLikeFinalAnswer rejects Grok unable-to-reply error", () => {
    const err = "Grok was unable to reply to your last message.";
    expect(h.detectGrokUnableToReply(err)).toBe(true);
    expect(h.looksLikeFinalAnswer(err)).toBe(false);
  });

  test("detectGrokResponseBlock catches unable-to-reply with Retry button", () => {
    const el = assistantMessage({
      innerHTML: "<p>Grok was unable to reply to your last message.</p>",
      innerText: "Grok was unable to reply to your last message.",
    });
    const btn = document.createElement("button");
    btn.textContent = "Retry";
    el.appendChild(btn);

    const block = h.detectGrokResponseBlock("Grok was unable to reply to your last message.", el);
    expect(block).not.toBeNull();
    expect(block.kind).toBe("transient_error");
    expect(block.canRetry).toBe(true);
  });

  test("verifyChatInput accepts full composer text", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const host = document.createElement("div");
    host.setAttribute("data-testid", "chat-input");
    host.appendChild(editor);
    document.body.appendChild(host);

    const long = "HEAD_" + "x".repeat(500) + "_TAIL";
    editor.textContent = long;
    const check = h.verifyChatInput(long);
    expect(check.ok).toBe(true);
    expect(check.actualLen).toBe(long.length);
  });

  test("verifyChatInput flags short insert", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "partial";
    const host = document.createElement("div");
    host.setAttribute("data-testid", "chat-input");
    host.appendChild(editor);
    document.body.appendChild(host);

    const expected = "START_" + "y".repeat(200) + "_END";
    const check = h.verifyChatInput(expected);
    expect(check.ok).toBe(false);
    expect(check.kind).toBe("truncated");
  });

  test("checkGrokAnswerBlocked detects unable-to-reply from page text without assistant-message", () => {
    const banner = document.createElement("div");
    banner.innerHTML = "<p>Grok was unable to reply to your last message.</p>";
    const btn = document.createElement("button");
    btn.textContent = "Retry";
    banner.appendChild(btn);
    document.body.appendChild(banner);

    const block = h.checkGrokAnswerBlocked("");
    banner.remove();

    expect(block).not.toBeNull();
    expect(block.kind).toBe("transient_error");
    expect(block.canRetry).toBe(true);
  });
});
