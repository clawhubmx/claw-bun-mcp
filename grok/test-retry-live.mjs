/**
 * Live Grok page test: detect unable-to-reply on current tab and click Retry.
 * Run: bun grok/test-retry-live.mjs
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

const liveFn = `(async function() {
  ${helpersSource}
  var h = installGrokChatHelpers();

  var host = document.getElementById("__grokRetryLiveHost");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "__grokRetryLiveHost";
  host.innerHTML = "<p>Grok was unable to reply to your last message.</p>";
  var retryBtn = document.createElement("button");
  retryBtn.textContent = "Retry";
  host.appendChild(retryBtn);
  document.body.appendChild(host);

  var block = h.checkGrokAnswerBlocked("");
  if (!block) {
    host.remove();
    return { ok: false, reason: "checkGrokAnswerBlocked missed injected error UI" };
  }

  var click = await h.clickGrokRetry();
  host.remove();

  return {
    ok: click.ok,
    block: block,
    click: click
  };
})()`;

const payload = runEval(liveFn);
const result = payload.result ?? payload;
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  console.error("Live Grok retry test did not complete successfully.");
  process.exit(1);
}

console.log("Live Grok retry test PASSED (Retry clicked on real page)");
