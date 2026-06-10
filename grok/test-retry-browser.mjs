/**
 * Browser integration test for Grok unable-to-reply + Retry click.
 * Run: bun grok/test-retry-browser.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUN_BROWSER = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const helpersSource = readFileSync(join(__dirname, "chat-helpers.js"), "utf8");

function runEval(js, tabFlag = "--tab 1") {
  const out = execFileSync("bun", [BUN_BROWSER, "eval", js, tabFlag, "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return parsed.data ?? parsed;
}

const testFn = `(async function() {
  ${helpersSource}
  var h = installGrokChatHelpers();

  var host = document.getElementById("__grokRetryTestHost");
  if (host) host.remove();

  host = document.createElement("div");
  host.id = "__grokRetryTestHost";
  host.style.position = "fixed";
  host.style.left = "-9999px";
  document.body.appendChild(host);

  var msg = document.createElement("div");
  msg.setAttribute("data-testid", "assistant-message");
  msg.innerHTML = "<p>Grok was unable to reply to your last message.</p>";
  host.appendChild(msg);

  var clicked = false;
  var btn = document.createElement("button");
  btn.textContent = "Retry";
  btn.addEventListener("click", function() { clicked = true; });
  msg.appendChild(btn);

  var block = h.detectGrokResponseBlock("Grok was unable to reply to your last message.", msg);
  if (!block || block.kind !== "transient_error") {
    host.remove();
    return { ok: false, step: "detect", block: block };
  }
  if (!block.canRetry) {
    host.remove();
    return { ok: false, step: "canRetry", block: block };
  }

  var clickResult = await h.clickGrokRetry(msg);
  host.remove();

  return {
    ok: clickResult.ok && clicked,
    clickResult: clickResult,
    clicked: clicked,
    block: block
  };
})()`;

const payload = runEval(testFn);
const data = payload.result ?? payload;
console.log(JSON.stringify(data, null, 2));

if (!data.ok) {
  console.error("Browser retry test FAILED");
  process.exit(1);
}

console.log("Browser retry test PASSED");
