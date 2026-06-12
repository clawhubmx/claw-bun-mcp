#!/usr/bin/env bun
/** Sync grok/chat-helpers.js body into inlined adapter files. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helpersPath = join(root, "chat-helpers.js");
const targets = ["chat.js", "chatfollow.js", "agent-chat.js"];

const helpersSource = readFileSync(helpersPath, "utf8");
const fnStart = helpersSource.indexOf("function installGrokChatHelpers()");
const fnEnd = helpersSource.lastIndexOf("return globalThis.__grokChatHelpers;");
if (fnStart < 0 || fnEnd < 0) {
  console.error("Could not locate installGrokChatHelpers in chat-helpers.js");
  process.exit(1);
}
const inner = helpersSource.slice(fnStart + "function installGrokChatHelpers()".length, fnEnd).trim();

for (const name of targets) {
  const path = join(root, name);
  let src = readFileSync(path, "utf8");
  const open = src.indexOf("(function installGrokChatHelpers() {");
  const close = src.indexOf("return globalThis.__grokChatHelpers;})();");
  if (open < 0 || close < 0) {
    console.error(`Could not locate helpers block in ${name}`);
    process.exit(1);
  }
  const before = src.slice(0, open + "(function installGrokChatHelpers() {".length);
  const after = src.slice(close);
  const next = before + "\n" + inner + "\n  " + after;
  writeFileSync(path, next);
  console.log(`Synced ${name}`);
}
