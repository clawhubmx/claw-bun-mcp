/**
 * Run googlegemini/chat adapter in the current browser tab via bun-browser eval.
 * Usage: node googlegemini/scripts/run-chat-eval.mjs "Reply with exactly: PING"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "..");
const query = process.argv[2] || "Reply with exactly: PING";
const chatSource = readFileSync(join(root, "chat.js"), "utf8");
const fnSource = chatSource.replace(/^[\s\S]*?\*\/\n\n/, "").trim();

const wrapper = `(async () => {
  const chat = ${fnSource};
  return await chat(${JSON.stringify({
    query,
    newChat: true,
    maxWaitMs: 120000,
  })});
})()`;

const payloadPath = join(root, ".chat-eval-payload.js");
writeFileSync(payloadPath, wrapper);

const cli = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const result = spawnSync("bun", [cli, "eval", wrapper], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

console.log(result.stdout || "");
if (result.stderr) console.error(result.stderr);
process.exit(result.status ?? 1);
