/**
 * Unit tests for Gemini chat completion heuristics.
 * Run: bun test googlegemini/test-chat-helpers.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, test, beforeEach } from "bun:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helpersSource = readFileSync(join(__dirname, "chat-helpers.js"), "utf8");

function installHelpers() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://gemini.google.com/app",
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Node = dom.window.Node;
  const loadHelpers = new Function(`${helpersSource}\nreturn installGeminiChatHelpers;`);
  return loadHelpers()();
}

function modelResponse({ innerHTML, innerText }) {
  const el = document.createElement("model-response");
  el.innerHTML = innerHTML;
  if (innerText != null) {
    Object.defineProperty(el, "innerText", {
      configurable: true,
      get: () => innerText,
    });
  }
  document.body.appendChild(el);
  return el;
}

describe("gemini chat completion detection", () => {
  let h;

  beforeEach(() => {
    h = installHelpers();
    document.body.innerHTML = "";
  });

  test("getAssistantText reads response-content message-content", () => {
    const el = modelResponse({
      innerHTML:
        '<div class="response-content"><message-content>GEMINI_OK</message-content></div>',
    });
    expect(h.getAssistantText(el)).toBe("GEMINI_OK");
  });

  test("looksLikeFinalAnswer rejects progress-only text", () => {
    expect(h.looksLikeFinalAnswer("Show thinking")).toBe(false);
    expect(h.looksLikeFinalAnswer("Gemini said")).toBe(false);
  });

  test("looksLikeFinalAnswer accepts normal prose", () => {
    expect(h.looksLikeFinalAnswer("Hello world.")).toBe(true);
    expect(h.looksLikeFinalAnswer("GEMINI_OK")).toBe(true);
  });

  test("resolveGeminiMode maps aliases", () => {
    expect(h.resolveGeminiMode("3.5-flash")).toBe("flash");
    expect(h.resolveGeminiMode("3.5-thinking")).toBe("thinking");
    expect(h.resolveGeminiMode("3.1-pro")).toBe("pro");
  });

  test("parseAnswerJson accepts fenced JSON", () => {
    const json = '{"ok":true}';
    const wrapped = "```json\n" + json + "\n```";
    expect(h.parseAnswerJson(wrapped)).toEqual({ ok: true });
  });

  test("modeLabelMatches accepts Gemini Flash for flash", () => {
    expect(h.modeLabelMatches("flash", "Gemini Flash")).toBe(true);
    expect(h.modeLabelMatches("flash", "3.5 Flash")).toBe(true);
    expect(h.modeLabelMatches("flash", "Flash")).toBe(true);
  });

  test("modeLabelMatches accepts bare Flash label on desktop", () => {
    expect(h.modeLabelMatches("flash", "Flash")).toBe(true);
  });

  test("getGeminiViewport classifies mobile below breakpoint", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    expect(h.getGeminiViewport().layout).toBe("mobile");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    expect(h.getGeminiViewport().layout).toBe("desktop");
  });

  test("parseConversationIdFromPath extracts hex id", () => {
    expect(h.parseConversationIdFromPath("/app/cf9b9943852dd170")).toBe(
      "cf9b9943852dd170",
    );
    expect(h.parseConversationIdFromPath("/search")).toBeNull();
  });

  test("scrapeGeminiRecentChats reads title and date", () => {
    document.body.innerHTML = `
      <search-zero-state>
        <div class="recent-conversations-container">
          <div class="conversation-container" role="option">
            <div class="left-content-container">
              <div class="title gds-body-l">Alpha Chat</div>
            </div>
            <div class="right-content-container date gds-body-m">Today</div>
          </div>
        </div>
      </search-zero-state>
    `;
    const titleEl = document.querySelector(".conversation-container .title");
    if (titleEl) {
      Object.defineProperty(titleEl, "innerText", {
        configurable: true,
        get: () => "Alpha Chat",
      });
    }
    const dateEl = document.querySelector(".conversation-container .date");
    if (dateEl) {
      Object.defineProperty(dateEl, "innerText", {
        configurable: true,
        get: () => "Today",
      });
    }
    const items = h.scrapeGeminiRecentChats(5);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Alpha Chat");
    expect(items[0].date).toBe("Today");
  });

  test("detectGeminiResponseBlock catches Workspace connect prompt", () => {
    const block = h.detectGeminiResponseBlock(
      "First, you'll need to connect Google Workspace to turn on this app.\nConnect",
    );
    expect(block).not.toBeNull();
    expect(block.error).toBe("Google Workspace not connected");
    expect(block.kind).toBe("workspace_required");
    expect(block.message).toContain("connect Google Workspace");
  });

  test("checkGeminiAnswerBlocked reads latest model-response text", () => {
    document.body.innerHTML = `
      <model-response>
        <message-content>First, you'll need to connect Google Workspace to turn on this app.</message-content>
      </model-response>
    `;
    const block = h.checkGeminiAnswerBlocked("");
    expect(block).not.toBeNull();
    expect(block.kind).toBe("workspace_required");
  });

  test("scrapeGeminiLibrary detects empty state", () => {
    document.body.innerHTML = `
      <library-sections-overview-page>
        <div data-test-id="empty-state-disclaimer" class="empty-state-container">
          <span class="empty-state-text">Any documents or media you create will appear here</span>
        </div>
      </library-sections-overview-page>
    `;
    const library = h.scrapeGeminiLibrary();
    expect(library.ok).toBe(true);
    expect(library.empty).toBe(true);
    expect(library.media).toEqual([]);
    expect(library.documents).toEqual([]);
  });
});
