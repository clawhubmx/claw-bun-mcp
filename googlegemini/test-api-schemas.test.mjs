/**
 * Unit tests for googlegemini API response schemas.
 * Run: bun test googlegemini/test-api-schemas.test.mjs
 */
import { describe, expect, test } from "bun:test";
import {
  validateBranchResponse,
  validateChatResponse,
  validateHealth,
  validateLibraryResponse,
  validateModes,
  validateSearchResponse,
} from "./api-schemas.mjs";

describe("googlegemini api schemas", () => {
  test("validateHealth accepts ok response", () => {
    const result = validateHealth({
      ok: true,
      loggedIn: true,
      anonymous: false,
      chatInput: true,
      submitEnabled: true,
      modeLabel: "Flash",
      url: "https://gemini.google.com/app",
    });
    expect(result.ok).toBe(true);
  });

  test("validateHealth rejects missing chatInput on ok", () => {
    const result = validateHealth({
      ok: true,
      loggedIn: true,
      anonymous: false,
      chatInput: false,
      submitEnabled: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("chatInput"))).toBe(true);
  });

  test("validateModes accepts mode list", () => {
    const result = validateModes({
      defaultModeId: "flash",
      current: "Flash",
      available: ["flash"],
      modes: [{ title: "Flash", available: true }],
      loggedIn: true,
      anonymous: false,
    });
    expect(result.ok).toBe(true);
  });

  test("validateChatResponse checks exact answer", () => {
    const result = validateChatResponse(
      {
        query: "hi",
        answer: "OK-123",
        conversationId: "abc123def456",
        loggedIn: true,
      },
      { expectExact: true, exactText: "OK-123" },
    );
    expect(result.ok).toBe(true);
  });

  test("validateChatResponse checks json shape", () => {
    const result = validateChatResponse(
      {
        query: "json",
        answer: '{"testId":"A","status":"ok"}',
        answerFormat: "json",
        answerJson: { testId: "A", status: "ok" },
        conversationId: "abc123",
        loggedIn: true,
      },
      {
        expectJson: true,
        jsonShape: { testId: "string", status: "string" },
        jsonValues: { testId: "A", status: "ok" },
      },
    );
    expect(result.ok).toBe(true);
  });

  test("validateChatResponse rejects wrong json values", () => {
    const result = validateChatResponse(
      {
        query: "json",
        answer: "{}",
        answerFormat: "json",
        answerJson: { testId: "A", status: "bad" },
        conversationId: "abc123",
        loggedIn: true,
      },
      {
        expectJson: true,
        jsonShape: { testId: "string", status: "string" },
        jsonValues: { status: "ok" },
      },
    );
    expect(result.ok).toBe(false);
  });

  test("validateSearchResponse checks resolved ids", () => {
    const result = validateSearchResponse(
      {
        mode: "recent",
        count: 1,
        results: [
          {
            title: "Test",
            date: "Today",
            conversationId: "abc123",
            url: "https://gemini.google.com/app/abc123",
          },
        ],
        viewport: { width: 1024, height: 768, layout: "desktop" },
        loggedIn: true,
        anonymous: false,
      },
      { mode: "recent", expectResolvedId: true },
    );
    expect(result.ok).toBe(true);
  });

  test("validateLibraryResponse accepts empty library", () => {
    const result = validateLibraryResponse({
      section: "all",
      count: 0,
      empty: true,
      media: [],
      documents: [],
      viewport: { width: 1024, height: 768, layout: "desktop" },
      loggedIn: true,
      anonymous: false,
    });
    expect(result.ok).toBe(true);
  });

  test("validateBranchResponse checks fork ids", () => {
    const result = validateBranchResponse(
      {
        sourceConversationId: "aaa111",
        conversationId: "bbb222",
        url: "https://gemini.google.com/app/bbb222",
        title: "Branch • Test",
        messageIndex: 0,
        messagesCopied: 1,
        snapshot: { turnCount: 1, userQueries: ["hi"], responses: ["hello"] },
        viewport: { width: 1024, height: 768, layout: "desktop" },
        loggedIn: true,
        anonymous: false,
      },
      { sourceConversationId: "aaa111" },
    );
    expect(result.ok).toBe(true);
  });
});
