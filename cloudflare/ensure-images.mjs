#!/usr/bin/env bun
/**
 * Enable "Sites can show images" in chrome://settings/content/images.
 * Turnstile widgets need images; blocked images break the checkbox challenge.
 *
 * Usage:
 *   bun cloudflare/ensure-images.mjs
 */

import { spawnSync } from "child_process";
import { connectToTab, humanMouseClick } from "./cdp-click.mjs";

const BUN_BROWSER =
  process.env.BUN_BROWSER_CLI || "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";

function walk(n, pred, out = []) {
  if (!n) return out;
  if (pred(n)) out.push(n);
  for (const c of n.children || []) walk(c, pred, out);
  for (const sr of n.shadowRoots || []) walk(sr, pred, out);
  return out;
}

const READ_POLICY_JS = `
(() => {
  function walk(root) {
    var out = [];
    function w(n) {
      if (!n) return;
      if (n.matches && n.matches("settings-collapse-radio-button")) out.push(n);
      if (n.shadowRoot) w(n.shadowRoot);
      for (var c of n.children || []) w(c);
    }
    w(root);
    return out;
  }
  var radios = walk(document.documentElement);
  return radios.slice(0, 2).map(function (el) {
    var inner = el.shadowRoot && el.shadowRoot.querySelector('[role=radio], #button');
    return {
      label: (el.innerText || el.textContent || "").trim().slice(0, 120),
      checked: inner ? inner.getAttribute("aria-checked") : null,
    };
  });
})()
`;

async function readImagesPolicy(send) {
  const r = await send("Runtime.evaluate", { expression: READ_POLICY_JS, returnByValue: true });
  const states = r.result?.result?.value;
  if (!Array.isArray(states) || states.length < 2) {
    return { ok: false, reason: "radios_not_found", states };
  }
  return {
    ok: true,
    allowed: states[0]?.checked === "true",
    blocked: states[1]?.checked === "true",
    states,
  };
}

export async function ensureImagesEnabled(opts = {}) {
  let conn = null;

  try {
    conn = await connectToTab({ urlIncludes: "chrome://settings/content/images" });
  } catch {
    spawnSync("bun", [BUN_BROWSER, "open", "chrome://settings/content/images"], { encoding: "utf8" });
    await Bun.sleep(1500);
    conn = await connectToTab({ urlIncludes: "chrome://settings/content/images" });
  }

  let policy = await readImagesPolicy(conn.send);
  if (policy.allowed) {
    conn.close();
    return { enabled: true, already: true, policy };
  }

  const doc = await conn.send("DOM.getDocument", { depth: -1, pierce: true });
  const allowRadio = walk(
    doc.result.root,
    (n) => n.nodeName === "SETTINGS-COLLAPSE-RADIO-BUTTON",
  )[0];
  if (!allowRadio?.nodeId) {
    conn.close();
    return { enabled: false, reason: "allow_radio_not_found", policy };
  }

  const box = await conn.send("DOM.getBoxModel", { nodeId: allowRadio.nodeId });
  const c = box.result?.model?.content;
  if (!c) {
    conn.close();
    return { enabled: false, reason: "no_box", policy };
  }

  const x = (c[0] + c[2]) / 2;
  const y = (c[1] + c[5]) / 2;
  await humanMouseClick(conn.send, { x, y }, { steps: 18, hoverMs: 280, pressMs: 140 });

  await Bun.sleep(800);
  policy = await readImagesPolicy(conn.send);
  conn.close();

  return {
    enabled: !!policy.allowed,
    already: false,
    policy,
  };
}

if (import.meta.main) {
  ensureImagesEnabled()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.enabled ? 0 : 1);
    })
    .catch((e) => {
      console.error(JSON.stringify({ success: false, error: String(e.message || e) }));
      process.exit(1);
    });
}
