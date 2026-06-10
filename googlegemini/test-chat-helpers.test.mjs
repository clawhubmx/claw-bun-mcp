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

  test("modeLabelMatches accepts Flash-Lite for flash requests", () => {
    expect(h.modeLabelMatches("flash", "Gemini Flash-Lite")).toBe(true);
    expect(h.modeLabelMatches("flash", "Flash Lite")).toBe(true);
  });

  test("thinkingLevelMatchesTier recognizes Standard and Extended", () => {
    expect(h.thinkingLevelMatchesTier("Standard", "standard")).toBe(true);
    expect(h.thinkingLevelMatchesTier("Extended", "high")).toBe(true);
    expect(h.thinkingLevelMatchesTier("Extended", "standard")).toBe(false);
  });

  test("modeLabelMatches thinking accepts flash label with extended thinking level", () => {
    expect(h.modeLabelMatches("thinking", "Gemini Flash", "Extended")).toBe(true);
    expect(h.modeLabelMatches("thinking", "Gemini Flash", "Standard")).toBe(false);
    expect(h.modeLabelMatches("thinking", "Flash Extended")).toBe(true);
    expect(h.modeLabelMatches("flash", "Gemini Flash", "Standard")).toBe(true);
    expect(h.modeLabelMatches("flash", "Gemini Flash", "Extended")).toBe(false);
    expect(h.modeLabelMatches("flash", "Flash Extended")).toBe(false);
  });

  test("isFlashFamilyLabel accepts Gemini Flash variants", () => {
    expect(h.isFlashFamilyLabel("Gemini Flash")).toBe(true);
    expect(h.isFlashFamilyLabel("Gemini Flash-Lite")).toBe(true);
    expect(h.isFlashFamilyLabel("3.1 Pro")).toBe(false);
  });

  test("getModeMenuTiming uses longer waits on mobile layout", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    document.body.innerHTML = '<div class="is-mobile"></div>';
    const mobile = h.getModeMenuTiming();
    expect(mobile.layout).toBe("mobile");
    expect(mobile.submenuMs).toBeGreaterThan(1200);

    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const desktop = h.getModeMenuTiming();
    expect(desktop.layout).toBe("desktop");
  });

  test("listThinkingLevelOptions prefers desktop flyout submenu roots", () => {
    function mockRect(el, left, top, width, height) {
      const rect = {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
      };
      el.getBoundingClientRect = () => rect;
    }

    document.body.innerHTML = `
      <div role="menu" id="main-menu">
        <div role="menuitem" id="thinking-level">Thinking level\nStandard</div>
      </div>
      <div role="menu" id="flyout-menu">
        <div role="menuitem">Standard\nBest for most questions</div>
        <div role="menuitem">Extended\nComplex problem solving</div>
      </div>
    `;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });

    const anchor = document.getElementById("thinking-level");
    const mainMenu = document.getElementById("main-menu");
    const flyoutMenu = document.getElementById("flyout-menu");
    mockRect(anchor, 64, 244, 220, 57);
    mockRect(mainMenu, 64, 56, 220, 220);
    mockRect(flyoutMenu, 300, 120, 220, 120);
    for (const item of flyoutMenu.querySelectorAll("[role=menuitem]")) {
      mockRect(item, 300, item.textContent.startsWith("Extended") ? 177 : 120, 220, 57);
    }

    const flyouts = h.getThinkingLevelFlyoutRoots(anchor);
    expect(flyouts.some((el) => el.id === "flyout-menu")).toBe(true);

    const levels = h.listThinkingLevelOptions(anchor);
    expect(levels.map((row) => row.title)).toEqual(["Standard", "Extended"]);
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

  test("detectGeminiTransientError catches Something went wrong messages", () => {
    expect(
      h.detectGeminiTransientError("Something went wrong. Try again later."),
    ).toBe(true);
    expect(
      h.detectGeminiTransientError(
        "Check your internet connection and try again.",
      ),
    ).toBe(true);
    expect(h.detectGeminiTransientError("Hello world.")).toBe(false);
  });

  test("looksLikeFinalAnswer rejects transient Gemini failure text", () => {
    expect(h.looksLikeFinalAnswer("Something went wrong")).toBe(false);
    expect(
      h.looksLikeFinalAnswer("Check your internet connection and try again."),
    ).toBe(false);
  });

  test("detectGeminiResponseBlock catches transient error with Try again button", () => {
    document.body.innerHTML = `
      <model-response>
        <message-content>Something went wrong</message-content>
        <button>Try again</button>
      </model-response>
    `;
    const el = document.querySelector("model-response");
    const block = h.detectGeminiResponseBlock("Something went wrong", el);
    expect(block).not.toBeNull();
    expect(block.kind).toBe("transient_error");
    expect(block.error).toBe("Gemini generation failed");
    expect(block.canRetry).toBe(true);
    expect(block.action).toBe("retry same command");
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

  test("prepareGeminiAttachmentPlan merges context and file content", () => {
    const plan = h.prepareGeminiAttachmentPlan({
      query: "Summarize this",
      context: "Background notes",
      fileName: "notes.txt",
      fileContent: "Alpha facts",
    });
    expect(plan.hasContext).toBe(true);
    expect(plan.hasFiles).toBe(true);
    expect(plan.query).toContain("--- External context ---");
    expect(plan.query).toContain("Background notes");
    expect(plan.query).toContain("Summarize this");
    expect(plan.files[0].fileName).toBe("notes.txt");
    expect(plan.files[0].bytes).toBe("Alpha facts");
  });

  test("decodeGeminiBase64 decodes utf8 text", () => {
    const bytes = h.decodeGeminiBase64("SGVsbG8=");
    expect(new TextDecoder().decode(bytes)).toBe("Hello");
  });

  test("conversationHexToCid normalizes hex ids", () => {
    expect(h.conversationHexToCid("abc123")).toBe("c_abc123");
    expect(h.conversationHexToCid("c_abc123")).toBe("c_abc123");
  });

  test("parseGeminiStreamGenerateText extracts final streamed answer", () => {
    const sample =
      'rc_111\\",[\\"Draft\\"],rc_222\\",[\\"Final answer\\"]';
    expect(h.parseGeminiStreamGenerateText(sample)).toBe("Final answer");
  });

  test("parseConversationIdArg accepts hex id and app URL", () => {
    expect(h.parseConversationIdArg("abc123def456")).toBe("abc123def456");
    expect(h.parseConversationIdArg("c_abc123")).toBe("abc123");
    expect(h.parseConversationIdArg("https://gemini.google.com/app/DEADbeef")).toBe(
      "deadbeef",
    );
    expect(h.parseConversationIdArg("not-an-id")).toBeNull();
  });

  test("scrapeGeminiConversationSnapshot reads user and assistant turns", () => {
    document.body.innerHTML = `
      <user-query>Reply with exactly: OK</user-query>
      <model-response>
        <message-content>OK</message-content>
      </model-response>
    `;
    const snap = h.scrapeGeminiConversationSnapshot();
    expect(snap.turnCount).toBe(1);
    expect(snap.userQueries).toHaveLength(1);
    expect(snap.userQueries[0]).toContain("Reply with exactly: OK");
    expect(snap.responses[0]).toBe("OK");
  });

  test("findAssistantMessageActions maps response index to message-actions", () => {
    document.body.innerHTML = `
      <response-container>
        <model-response><message-content>A</message-content></model-response>
        <message-actions><button aria-label="Show more options"></button></message-actions>
      </response-container>
      <response-container>
        <model-response><message-content>B</message-content></model-response>
        <message-actions><button aria-label="Show more options"></button></message-actions>
      </response-container>
    `;
    expect(h.findAssistantMessageActions(0)).not.toBeNull();
    expect(h.findAssistantMessageActions(1)).not.toBeNull();
    expect(
      h.findAssistantMessageActions(0).querySelector('[aria-label="Show more options"]'),
    ).not.toBeNull();
  });
});
