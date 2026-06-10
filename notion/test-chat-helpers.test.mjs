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
});
