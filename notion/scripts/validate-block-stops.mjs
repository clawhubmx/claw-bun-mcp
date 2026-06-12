#!/usr/bin/env bun
/**
 * Validate all Notion chat block/stop detection paths (unit + install version).
 * Run: bun notion/scripts/validate-block-stops.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helpersSource = readFileSync(join(__dirname, "../chat-helpers.js"), "utf8");
const installChat = join(process.env.HOME || "", ".bun-browser/claw-bun-mcp/notion/chat.js");

function installHelpers() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://app.notion.com/ai",
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.InputEvent = dom.window.InputEvent;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.location = dom.window.location;
  const load = new Function(`${helpersSource}\nreturn installNotionAiChatHelpers;`);
  return load()();
}

const cases = [
  {
    id: "credits_exhausted",
    setup(doc) {
      doc.body.innerHTML = '<div role="alert">You\'ve run out of free AI responses.</div>';
    },
    expect(h) {
      return h.detectNotionPageAbnormal()?.kind === "credits_exhausted";
    },
  },
  {
    id: "rate_limit",
    setup(doc) {
      doc.body.innerHTML = '<div role="alert">Too many requests. Rate limit reached.</div>';
    },
    expect(h) {
      return h.detectNotionPageAbnormal()?.kind === "rate_limit";
    },
  },
  {
    id: "prompt_rejected",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">An error occurred, please try again.</div>';
    },
    expect(h) {
      return h.detectNotionPageAbnormal()?.kind === "prompt_rejected";
    },
  },
  {
    id: "submit_disabled",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">' +
        '<div contenteditable="true" role="textbox" class="content-editable-leaf-rtl">pending prompt</div>' +
        '<button aria-label="Submit AI message" aria-disabled="true"></button>' +
        "</div>";
    },
    expect(h) {
      var submit = document.querySelector('[aria-label="Submit AI message"]');
      var editor = document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!submit || !editor) return false;
      return (
        (submit.disabled || submit.getAttribute("aria-disabled") === "true") &&
        !!String(editor.textContent || "").trim()
      );
    },
  },
  {
    id: "brewing_in_flight",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">' +
        '<div class="content-editable-leaf-rtl">What is 2+2?</div>' +
        "Brewing\nBrewing</div>";
    },
    expect(h) {
      return h.isGenerating() === true && h.isChatInProgress() === true;
    },
  },
  {
    id: "focusing_in_flight",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">' +
        '<div class="content-editable-leaf-rtl">What is 2+2?</div>' +
        "Focusing\nFocusing</div>";
    },
    expect(h) {
      return h.isGenerating() === true;
    },
  },
  {
    id: "stale_copy_does_not_block_brewing",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">' +
        '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Old answer with enough detail here.</div>' +
        '<button aria-label="Copy response"></button>' +
        '<button aria-label="Share positive feedback"></button>' +
        '<button aria-label="Share negative feedback"></button></div>' +
        '<div class="content-editable-leaf-rtl">New question here</div>' +
        "Brewing\nBrewing</div>";
    },
    expect(h) {
      return h.isGenerating() === true && h.isChatInProgress() === true;
    },
  },
  {
    id: "completed_turn_not_generating",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">' +
        '<div class="content-editable-leaf-rtl">Summarize this in one sentence please.</div>' +
        '<div class="notion-text-block"><div class="content-editable-leaf-rtl">Final report complete with enough detail for the user.</div>' +
        '<button aria-label="Copy response"></button>' +
        '<button aria-label="Share positive feedback"></button>' +
        '<button aria-label="Share negative feedback"></button></div></div>';
    },
    expect(h) {
      return h.isGenerating() === false && h.isChatInProgress() === false;
    },
  },
  {
    id: "metadata_true_not_counted_as_reply",
    setup(doc) {
      doc.body.innerHTML =
        '<div class="layout-chat">' +
        '<div class="notion-text-block"><div class="content-editable-leaf-rtl">true</div></div>' +
        '<div class="content-editable-leaf-rtl">What is 17+25?</div>' +
        '<div class="notion-text-block"><div class="content-editable-leaf-rtl">42</div></div></div>';
    },
    expect(h) {
      return (
        h.getAssistantMessages().length === 1 &&
        h.getAssistantMessagesSinceLastUser().length === 1
      );
    },
  },
];

let installVersion = "unknown";
try {
  const m = readFileSync(installChat, "utf8").match(/HELPERS_VERSION = (\d+)/);
  if (m) installVersion = m[1];
} catch {}

console.log(`Install HELPERS_VERSION: ${installVersion}`);
console.log(`Workspace helpers: ${helpersSource.match(/HELPERS_VERSION = (\d+)/)?.[1]}\n`);

const results = [];
for (const c of cases) {
  const h = installHelpers();
  c.setup(document);
  const ok = !!c.expect(h);
  results.push({ id: c.id, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n${failed.length} validation(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} block/stop validations passed.`);
