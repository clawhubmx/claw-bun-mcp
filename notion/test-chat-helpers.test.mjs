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

function installHelpers() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://app.notion.com/ai",
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Node = dom.window.Node;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.localStorage = dom.window.localStorage;
  const loadHelpers = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
  return loadHelpers()();
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
          <div role="menuitem">Auto</div>
          <div role="menuitem">Sonnet 4.6</div>
          <div role="menuitem">Opus 4.7</div>
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
