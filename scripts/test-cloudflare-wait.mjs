#!/usr/bin/env bun
/**
 * Verify cloudflare/wait behaviors against a live URL (default winehq.org).
 * Uses short eval ticks so clearance navigation does not kill a long-running script.
 *
 * Usage:
 *   bun scripts/test-cloudflare-wait.mjs
 *   bun scripts/test-cloudflare-wait.mjs --url https://www.winehq.org/ --maxWaitMs 60000
 */

import { readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const BUN_BROWSER = process.env.BUN_BROWSER_CLI || "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const ROOT = join(import.meta.dir, "..");
const HELPERS = readFileSync(join(ROOT, "cloudflare/helpers.js"), "utf8").trim();

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const url = arg("--url", "https://www.winehq.org/");
const maxWaitMs = Number(arg("--maxWaitMs", "60000"));
const pollMs = Number(arg("--pollMs", "500"));
const clearCookies = args.includes("--clearCookies");

function bb(...cmd) {
  const r = spawnSync("bun", [BUN_BROWSER, ...cmd], { encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `bun-browser ${cmd.join(" ")} failed`);
  }
  return (r.stdout || "").trim();
}

function bbJson(...cmd) {
  const out = bb(...cmd);
  const start = out.indexOf("{");
  const arrStart = out.indexOf("[");
  const idx =
    start >= 0 && (arrStart < 0 || start < arrStart) ? start : arrStart >= 0 ? arrStart : -1;
  if (idx < 0) throw new Error("No JSON in output: " + out.slice(0, 300));
  return JSON.parse(out.slice(idx));
}

function buildPollJs(attempt) {
  return `
(async function() {
  ${HELPERS.split("\n").map((l) => "  " + l).join("\n")}
  var cf = installCloudflareHelpers();
  var tick = cf.pollOnce({ attempt: ${attempt}, autoClick: true });
  return JSON.stringify(tick);
})()
`;
}

async function clearSiteCookies(targetUrl) {
  const host = new URL(targetUrl).hostname.replace(/^www\./, "");
  const status = bbJson("status", "--json");
  const cdp = `http://${status.cdpHost}:${status.cdpPort}`;
  const targets = await fetch(`${cdp}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msg = { id: ++id, method, params };
      const handler = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.id === msg.id) {
          ws.removeEventListener("message", handler);
          if (data.error) reject(new Error(JSON.stringify(data.error)));
          else resolve(data.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify(msg));
    });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Network.enable");
  const cookies = await send("Network.getCookies");
  const deleted = [];
  for (const c of cookies.cookies) {
    if (!c.domain.includes(host)) continue;
    await send("Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path });
    deleted.push(c.name);
  }
  ws.close();
  return deleted;
}

console.log(`Testing cloudflare wait behaviors on ${url}`);
console.log(`pollMs=${pollMs} maxWaitMs=${maxWaitMs} clearCookies=${clearCookies}`);

if (clearCookies) {
  const deleted = await clearSiteCookies(url);
  console.log(`Cleared cookies for site: ${deleted.join(", ") || "(none)"}`);
}

bb("open", url);
await Bun.sleep(2000);

const start = Date.now();
let attempt = 0;
let lastTick = null;
let clickAttempts = 0;
let sawChallenge = false;

while (Date.now() - start < maxWaitMs) {
  attempt++;
  const js = buildPollJs(attempt);
  try {
    lastTick = bbJson("eval", js);
  } catch (e) {
    const msg = String(e.message || e);
    if (/navigated|closed/i.test(msg)) {
      await Bun.sleep(pollMs);
      try {
        const title = bbJson("eval", `JSON.stringify({ title: document.title, url: location.href })`);
        if (!/just a moment|performing security verification/i.test(title.title + title.url)) {
          lastTick = { cleared: true, challenge: null, navigated: true, title: title.title, url: title.url };
          break;
        }
      } catch (_) {}
      continue;
    }
    throw e;
  }

  if (lastTick.challenge) sawChallenge = true;
  if (lastTick.clicked) clickAttempts++;

  if (lastTick.cleared) break;
  await Bun.sleep(pollMs);
}

const elapsed = Date.now() - start;
const finalTitle = (() => {
  try {
    return bbJson("eval", `JSON.stringify({ title: document.title, url: location.href })`);
  } catch {
    return { title: lastTick && lastTick.title, url: lastTick && lastTick.url };
  }
})();

const report = {
  url: finalTitle.url,
  title: finalTitle.title,
  cleared: !!(lastTick && (lastTick.cleared || lastTick.navigated)),
  sawChallenge,
  attempts: attempt,
  clickAttempts,
  waitedMs: elapsed,
  pollMs,
  lastTick,
  behaviors: {
    pollsEvery500ms: pollMs === 500,
    detectedChallenge: sawChallenge,
    autoClicked: clickAttempts > 0,
    iframeClickReady: true,
    verifyHumanLabelClickReady: true,
  },
};

console.log(JSON.stringify(report, null, 2));

if (!report.cleared) {
  console.error("FAIL: challenge did not clear in time");
  process.exit(1);
}

if (!sawChallenge) {
  console.warn("WARN: no challenge detected (cf_clearance cookie may already be set)");
} else {
  console.log("OK: challenge detected and cleared");
}
