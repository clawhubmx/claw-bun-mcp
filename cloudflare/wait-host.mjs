#!/usr/bin/env bun
/**
 * Host-side Cloudflare wait with CDP Turnstile bypass tuned for Managed mode.
 *
 * Turnstile runs background JS first; the checkbox is only confirmation.
 * This runner builds passive session telemetry, clicks once when interactive,
 * then waits for cf-turnstile-response token + redirect.
 *
 * Usage:
 *   bun cloudflare/wait-host.mjs
 *   bun cloudflare/wait-host.mjs --tab c2d9 --url https://grok.com/ --maxWaitMs 90000
 */

import { readFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import {
  bbJson,
  classifyTurnstilePhase,
  connectToTab,
  isCleared,
  pageChallengeState,
  resolveTabId,
  runTurnstileBypass,
  waitForTurnstileOutcome,
} from "./cdp-click.mjs";
import { ensureImagesEnabled } from "./ensure-images.mjs";

const ROOT = join(import.meta.dir, "..");
const BUN_BROWSER =
  process.env.BUN_BROWSER_CLI || "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const HELPERS = readFileSync(join(ROOT, "cloudflare/helpers.js"), "utf8").trim();

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const url = arg("--url", null);
const maxWaitMs = Number(arg("--maxWaitMs", "90000"));
const pollMs = Number(arg("--pollMs", "800"));
const tabArg = arg("--tab", null);
const reloadOnce = args.includes("--reloadOnce");
const minClickGapMs = Number(arg("--minClickGapMs", "45000"));

function bb(...cmd) {
  const r = spawnSync("bun", [BUN_BROWSER, ...cmd], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "").trim());
}

/** Page-side poll only — no synthetic clicks (they hurt Turnstile trust score). */
function buildPollJs(attempt) {
  return `
(async function() {
  ${HELPERS.split("\n").map((l) => "  " + l).join("\n")}
  var cf = installCloudflareHelpers();
  return JSON.stringify(cf.pollOnce({ attempt: ${attempt}, autoClick: false }));
})()
`;
}

async function main() {
  const tabId = resolveTabId(tabArg);

  const images = await ensureImagesEnabled();
  if (!images.enabled) {
    console.log(JSON.stringify({ cleared: false, error: "images_not_enabled", images }, null, 2));
    process.exit(1);
  }

  if (url) bb("open", url, "--tab", String(tabId));

  const conn = await connectToTab({ tabId });
  const start = Date.now();
  let attempt = 0;
  let lastTick = null;
  let bypassRuns = 0;
  let lastClickAt = 0;
  let reloaded = false;
  let lastPhase = null;

  while (Date.now() - start < maxWaitMs) {
    attempt++;
    let state = await pageChallengeState(tabId).catch(() => ({}));

    if (await isCleared(state)) {
      lastTick = { cleared: true, phase: state.phase, state };
      break;
    }

    lastPhase = state.phase || classifyTurnstilePhase(state);

    try {
      lastTick = bbJson("eval", buildPollJs(attempt), "--tab", tabId, "--json");
    } catch (e) {
      const msg = String(e.message || e);
      if (/navigated|closed/i.test(msg)) {
        await Bun.sleep(pollMs);
        state = await pageChallengeState(tabId).catch(() => ({}));
        if (await isCleared(state)) {
          lastTick = { cleared: true, navigated: true, state };
          break;
        }
        continue;
      }
      throw e;
    }

    state = await pageChallengeState(tabId).catch(() => state);
    lastPhase = state.phase;

    if (state.phase === "verifying" || state.phase === "token_ready") {
      const outcome = await waitForTurnstileOutcome(tabId, {
        timeoutMs: Math.min(35000, maxWaitMs - (Date.now() - start)),
      });
      if (outcome.ok) {
        lastTick = { cleared: true, outcome, state: outcome.state };
        break;
      }
    }

    const canClick =
      (state.phase === "interactive" || state.widgetReady) &&
      !state.verifyingHuman &&
      !state.hasToken &&
      Date.now() - lastClickAt >= minClickGapMs;

    if (canClick) {
      const bypass = await runTurnstileBypass(conn, tabId, {
        minBackgroundMs: Number(arg("--minBackgroundMs", "0")) || undefined,
        pressMs: Number(arg("--pressMs", "0")) || undefined,
        hoverMs: Number(arg("--hoverMs", "0")) || undefined,
        timeoutMs: Math.min(50000, maxWaitMs - (Date.now() - start)),
      });
      bypassRuns++;
      lastClickAt = Date.now();
      if (bypass.cleared) {
        lastTick = { cleared: true, bypass };
        break;
      }
      if (bypass.outcome?.reason === "verification_failed") {
        await Bun.sleep(minClickGapMs);
      }
    } else if (state.phase === "background" || state.phase === "loading") {
      await Bun.sleep(Math.max(pollMs, 1200));
    }

    if (lastTick?.cleared) break;

    if (reloadOnce && !reloaded && Date.now() - start > maxWaitMs * 0.7) {
      reloaded = true;
      bb("refresh", "--tab", tabId);
      await Bun.sleep(3000);
      lastClickAt = 0;
      bypassRuns = 0;
    }

    await Bun.sleep(pollMs);
  }

  conn.close();

  const finalState = await pageChallengeState(tabId).catch(() => ({}));
  const cleared =
    !!(lastTick && lastTick.cleared) || (await isCleared(finalState));

  const out = {
    cleared,
    waitedMs: Date.now() - start,
    attempts: attempt,
    url: finalState.url || lastTick?.state?.url,
    title: finalState.title,
    phase: finalState.phase || lastPhase,
    bypassRuns,
    imagesEnabled: images.enabled,
    imagesAlready: images.already,
    lastTick,
    hint: cleared
      ? null
      : finalState.phase === "background"
        ? "Turnstile still running background checks — wait longer or interact manually once."
        : "Run again with --maxWaitMs 120000. Avoid repeated clicks; Turnstile scores session telemetry.",
  };

  console.log(JSON.stringify(out, null, 2));
  process.exit(cleared ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: String(e.message || e) }));
  process.exit(1);
});
