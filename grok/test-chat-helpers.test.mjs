/**
 * Unit tests for grok chat completion heuristics (stuck-at-96% scenarios).
 * Run: bun test grok/test-chat-helpers.test.mjs
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
  globalThis.Event = dom.window.Event;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.ClipboardEvent = dom.window.ClipboardEvent;
  globalThis.DataTransfer = dom.window.DataTransfer;
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

function grokActionButton(label, withSvg = true) {
  const btn = document.createElement("button");
  btn.setAttribute("aria-label", label);
  if (withSvg) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    btn.appendChild(svg);
  }
  return btn;
}

function appendGrokActionBar(el, labels) {
  const bar = document.createElement("div");
  for (const label of labels) {
    bar.appendChild(grokActionButton(label));
  }
  el.appendChild(bar);
  return bar;
}

const GROK_ACTION_LABELS = [
  "Copy",
  "Create share link",
  "Like",
  "Dislike",
  "Regenerate",
  "More actions",
];

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

  test("setChatInput fills test1-length prompt via textContent fallback", () => {
    installChatInput("");
    const test1 = readFileSync(join(__dirname, "example/test1.txt"), "utf8");
    expect(h.setChatInput(test1)).toBe(true);
    expect(h.verifyChatInput(test1).ok).toBe(true);
  });

  test("fillChatInput accepts test1-length prompt", async () => {
    installChatInput("");
    const test1 = readFileSync(join(__dirname, "example/test1.txt"), "utf8");
    const fill = await h.fillChatInput(test1);
    expect(fill.ok).toBe(true);
    expect(fill.inputCheck.ok).toBe(true);
  });

  test("setChatInput uses chunked insert when single insertText truncates", () => {
    installChatInput("");
    const long = "HEAD_" + "z".repeat(5200) + "_TAIL";
    const originalExec = document.execCommand;
    let insertCalls = 0;
    document.execCommand = (cmd, _showUi, arg) => {
      if (cmd === "selectAll" || cmd === "delete") return true;
      if (cmd !== "insertText") return false;
      insertCalls += 1;
      const editor = h.getChatInput();
      if (!editor) return false;
      if (typeof arg === "string" && arg.length > 600) {
        editor.textContent = (editor.textContent || "") + arg.slice(0, 450);
        return true;
      }
      editor.textContent = (editor.textContent || "") + arg;
      return true;
    };

    expect(h.setChatInput(long)).toBe(true);
    expect(insertCalls).toBeGreaterThan(1);
    expect(h.verifyChatInput(long).ok).toBe(true);

    if (originalExec) document.execCommand = originalExec;
    else delete document.execCommand;
  });

  test("verifyChatInput accepts NBSP-only blank lines after composer collapse", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const host = document.createElement("div");
    host.setAttribute("data-testid", "chat-input");
    host.appendChild(editor);
    document.body.appendChild(host);

    const expected = "Line one.\n\u00a0\nLine two.\n\u00a0\n\"\"\"";
    editor.textContent = "Line one.  Line two.  \"\"\"";
    const check = h.verifyChatInput(expected);
    expect(check.ok).toBe(true);
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

  test("hasGrokReplyActionBar is true when all six action buttons with svg are present", () => {
    const el = assistantMessage({
      innerHTML: "<p>Done.</p>",
      innerText: "Done.",
    });
    appendGrokActionBar(el, GROK_ACTION_LABELS);
    expect(h.hasGrokReplyActionBar(el)).toBe(true);
    expect(h.hasGrokReplyActionBar()).toBe(true);
  });

  test("hasGrokReplyActionBar accepts share/regenerate label variants", () => {
    const el = assistantMessage({ innerHTML: "<p>Done.</p>", innerText: "Done." });
    appendGrokActionBar(el, [
      "copy",
      "Share link",
      "Like response",
      "Dislike response",
      "Regenerate response",
      "More actions",
    ]);
    expect(h.hasGrokReplyActionBar(el)).toBe(true);
  });

  test("hasGrokReplyActionBar is false when buttons lack svg", () => {
    const el = assistantMessage({ innerHTML: "<p>Done.</p>", innerText: "Done." });
    const bar = document.createElement("div");
    for (const label of GROK_ACTION_LABELS) {
      bar.appendChild(grokActionButton(label, false));
    }
    el.appendChild(bar);
    expect(h.hasGrokReplyActionBar(el)).toBe(false);
  });

  test("hasGrokReplyActionBar is false when only partial actions are present", () => {
    const el = assistantMessage({ innerHTML: "<p>Done.</p>", innerText: "Done." });
    appendGrokActionBar(el, GROK_ACTION_LABELS.slice(0, 4));
    expect(h.hasGrokReplyActionBar(el)).toBe(false);
  });

  test("isGrokReplyPending is false when action bar present despite streaming UI", () => {
    const el = assistantMessage({
      innerHTML: "<p>Here is the final answer with enough detail.</p>",
      innerText: "Here is the final answer with enough detail.",
      streaming: true,
    });
    appendGrokActionBar(el, GROK_ACTION_LABELS);
    stopButton(true);
    expect(h.isGrokGenerating()).toBe(false);
    expect(h.isGrokReplyPending(0, "")).toBe(false);
  });

  test("waitForAssistantAnswer returns prose when action bar present with streaming UI", async () => {
    const prose = "Here is the final answer with enough detail.";
    assistantMessage({
      innerHTML: "<p>" + prose + "</p>",
      innerText: prose,
      streaming: true,
    });
    appendGrokActionBar(document.querySelector('[data-testid="assistant-message"]'), GROK_ACTION_LABELS);
    stopButton(true);

    const answer = await h.waitForAssistantAnswer(0, "", {
      pollMs: 20,
      maxWaitMs: 500,
      stableNeeded: 2,
    });

    expect(answer).toBe(prose);
    expect(h.wasLastWaitPending()).toBe(false);
  });
});

function pad(len, ch = "x") {
  return ch.repeat(Math.max(0, len));
}

function buildLongPrompt(run, marker) {
  const head = `RUN_${run}_HEAD_${marker}_ `;
  const tail = ` _TAIL_${run}_${marker}`;
  const bodyLen = 800 + (run % 5) * 1200;
  return (
    head +
    pad(bodyLen) +
    tail +
    '\nRespond ONLY with JSON: {"run":' +
    run +
    ',"marker":"' +
    marker +
    '","body_len":' +
    bodyLen +
    '}. No markdown.'
  );
}

function buildLongJsonAnswer(run, marker, bodyLen) {
  const itemCount = 5 + (run % 8);
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${run}-${i}`,
    text: pad(50 + ((i * 17) % 200), "a"),
    tags: [`tag-${i}`, `run-${run}`],
  }));
  return JSON.stringify({
    run,
    marker,
    body_len: bodyLen,
    padding: pad(300 + (run % 5) * 500, "z"),
    items,
    meta: { generated: true, index: run },
  });
}

function wrapReplyText(json, format) {
  switch (format) {
    case 0:
      return json;
    case 1:
      return "```json\n" + json + "\n```";
    case 2:
      return "Thought for 12s\n" + json;
    case 3:
      return "Searched web\n3 results\nEvaluating data • 2s\n" + json;
    default:
      return json;
  }
}

function replyDomHtml(json) {
  return `<pre><code>${json}</code></pre>`;
}

function installChatInput(text) {
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.textContent = text;
  const host = document.createElement("div");
  host.setAttribute("data-testid", "chat-input");
  host.appendChild(editor);
  document.body.appendChild(host);
  return editor;
}

describe("long prompt reply capture (100 runs)", () => {
  let h;

  beforeEach(() => {
    h = installHelpers();
    document.body.innerHTML = "";
  });

  test("verifyChatInput accepts all 100 long prompts", () => {
    installChatInput("");
    for (let run = 1; run <= 100; run++) {
      const marker = `M${String(run).padStart(3, "0")}`;
      const prompt = buildLongPrompt(run, marker);
      const editor = h.getChatInput();
      editor.textContent = prompt;
      const check = h.verifyChatInput(prompt);
      expect(check.ok).toBe(true);
      expect(check.actualLen).toBeGreaterThanOrEqual(prompt.length - 3);
    }
  });

  for (let run = 1; run <= 100; run++) {
    const marker = `M${String(run).padStart(3, "0")}`;
    const bodyLen = 800 + (run % 5) * 1200;
    const prompt = buildLongPrompt(run, marker);
    const answerJson = buildLongJsonAnswer(run, marker, bodyLen);
    const format = run % 4;

    test(`run ${run}: captures long JSON reply (${prompt.length} char prompt, format ${format})`, () => {
      const wrapped = wrapReplyText(answerJson, format);
      expect(h.extractJsonBlock(wrapped)).toBe(answerJson);
      expect(h.parseAnswerJson(wrapped)).toEqual(JSON.parse(answerJson));
      expect(h.hasParsedJsonAnswer(wrapped)).toBe(true);

      const el = assistantMessage({
        innerHTML: replyDomHtml(answerJson),
        innerText: wrapped,
      });
      appendGrokActionBar(el, GROK_ACTION_LABELS);

      const captured = h.getAssistantText(el);
      expect(captured).toBe(answerJson);
      expect(h.looksLikeFinalAnswer(captured)).toBe(true);
      expect(h.isGrokReplyPending(0, "")).toBe(false);
      expect(h.cleanAssistantText(wrapped)).toBe(answerJson);
    });
  }

  for (const run of [1, 11, 21, 31, 41, 51, 61, 71, 81, 91]) {
    const marker = `M${String(run).padStart(3, "0")}`;
    const bodyLen = 800 + (run % 5) * 1200;
    const answerJson = buildLongJsonAnswer(run, marker, bodyLen);

    test(`run ${run}: waitForAssistantAnswer completes after streaming long JSON`, async () => {
      const partial = answerJson.slice(0, Math.floor(answerJson.length * 0.35));
      const el = assistantMessage({
        innerHTML: replyDomHtml(partial),
        innerText: "Thought for 5s\n" + partial,
        streaming: true,
      });
      stopButton(true);

      const waitPromise = h.waitForAssistantAnswer(0, "", {
        pollMs: 15,
        maxWaitMs: 900,
        stableNeeded: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 60));
      el.innerHTML = replyDomHtml(answerJson);
      Object.defineProperty(el, "innerText", {
        configurable: true,
        get: () => "Thought for 5s\n" + answerJson,
      });
      el.querySelector(".animate-pulse")?.remove();
      appendGrokActionBar(el, GROK_ACTION_LABELS);
      document.querySelector('[aria-label="Stop generating"]').disabled = true;

      const answer = await waitPromise;
      expect(answer).toBe(answerJson);
      expect(h.wasLastWaitPending()).toBe(false);
    });
  }
});
