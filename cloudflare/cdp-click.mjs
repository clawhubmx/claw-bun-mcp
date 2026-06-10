#!/usr/bin/env bun
/**
 * Host-side Turnstile bypass via Chrome CDP (pierces closed shadow DOM).
 *
 * Turnstile scores passive browser telemetry before the checkbox matters.
 * Strategy: warm up with natural pointer/scroll activity → wait for widget →
 * one human-like click → wait for cf-turnstile-response token → wait for redirect.
 */

import { spawnSync } from "child_process";

const BUN_BROWSER =
  process.env.BUN_BROWSER_CLI || "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";

export function bbJson(...cmd) {
  const r = spawnSync("bun", [BUN_BROWSER, ...cmd], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "").trim() || `bun-browser ${cmd.join(" ")} failed`);
  }
  const out = (r.stdout || "").trim();
  const start = out.indexOf("{");
  const arrStart = out.indexOf("[");
  const idx =
    start >= 0 && (arrStart < 0 || start < arrStart) ? start : arrStart >= 0 ? arrStart : -1;
  if (idx < 0) throw new Error("No JSON in output: " + out.slice(0, 300));
  return JSON.parse(out.slice(idx));
}

export function getCdpPort() {
  const status = bbJson("status", "--json");
  return status.cdpPort;
}

export function resolveTabId(tabArg) {
  if (tabArg) return tabArg;
  const list = bbJson("tab", "list", "--json");
  const active = list.tabs?.find((t) => t.active) || list.tabs?.[0];
  if (!active) throw new Error("No browser tab open");
  return active.tab || active.tabId;
}

function walkNodes(node, pred, out = []) {
  if (!node) return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) walkNodes(c, pred, out);
  for (const sr of node.shadowRoots || []) walkNodes(sr, pred, out);
  if (node.contentDocument) walkNodes(node.contentDocument, pred, out);
  return out;
}

function attr(node, name) {
  return (node.attributes || []).find((a) => a.name === name)?.value || "";
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Turnstile lifecycle phases (orchestrate / managed). */
export function classifyTurnstilePhase(state) {
  if (!state) return "unknown";
  if (state.hasToken || state.turnstileResponse) return "token_ready";
  if (state.verifyingHuman) return "verifying";
  if (state.widgetReady && !state.verifyingHuman) return "interactive";
  if (state.securityVerification) return "background";
  if (state.challenge) return "loading";
  return "cleared";
}

export function buildHumanPath(from, to, opts = {}) {
  const steps = Number(opts.steps) || randInt(24, 42);
  const curve = Number(opts.curve) || rand(0.08, 0.22);
  const midX = (from.x + to.x) / 2 + rand(-40, 40);
  const midY = (from.y + to.y) / 2 + rand(-24, 24) - Math.abs(to.x - from.x) * curve;

  const overshoot = opts.overshoot !== false && Math.random() > 0.35;
  const overshootTarget = overshoot
    ? { x: to.x + rand(4, 14) * (Math.random() > 0.5 ? 1 : -1), y: to.y + rand(-4, 4) }
    : to;

  const points = [];
  const mainSteps = overshoot ? Math.floor(steps * 0.82) : steps;

  for (let i = 0; i <= mainSteps; i++) {
    const t = easeInOut(i / mainSteps);
    const inv = 1 - t;
    const x = inv * inv * from.x + 2 * inv * t * midX + t * t * overshootTarget.x;
    const y = inv * inv * from.y + 2 * inv * t * midY + t * t * overshootTarget.y;
    const jitter = i > 0 && i < mainSteps ? rand(-1.2, 1.2) : 0;
    points.push({ x: x + jitter, y: y + jitter * 0.6 });

    if (i === Math.floor(mainSteps * 0.45) && mainSteps > 10) {
      points.push({ x: x + rand(-0.8, 0.8), y: y + rand(-0.8, 0.8), pause: randInt(40, 120) });
    }
  }

  if (overshoot) {
    const settleSteps = steps - mainSteps;
    for (let i = 1; i <= settleSteps; i++) {
      const t = easeInOut(i / settleSteps);
      points.push({
        x: overshootTarget.x + (to.x - overshootTarget.x) * t + rand(-0.5, 0.5),
        y: overshootTarget.y + (to.y - overshootTarget.y) * t + rand(-0.4, 0.4),
      });
    }
  }

  return points;
}

export async function getViewportSize(send) {
  const layout = await send("Page.getLayoutMetrics");
  const v = layout.result?.visualViewport || layout.result?.layoutViewport;
  if (v?.clientWidth && v?.clientHeight) {
    return { width: v.clientWidth, height: v.clientHeight };
  }
  return { width: 1280, height: 800 };
}

async function dispatchMove(send, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    pointerType: "mouse",
    ...extra,
  });
}

/** Passive session telemetry: idle wander + tiny scroll before interacting. */
export async function warmUpSession(send, opts = {}) {
  const viewport = await getViewportSize(send);
  const durationMs = Number(opts.durationMs) || randInt(2500, 5000);
  const start = Date.now();
  let x = rand(viewport.width * 0.3, viewport.width * 0.7);
  let y = rand(viewport.height * 0.2, viewport.height * 0.5);
  let moves = 0;

  await dispatchMove(send, x, y);

  while (Date.now() - start < durationMs) {
    const mode = Math.random();
    if (mode < 0.12) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: 0,
        deltaY: randInt(1, 3) * (Math.random() > 0.3 ? 1 : -1),
        pointerType: "mouse",
      });
      await sleep(randInt(120, 280));
    } else {
      x = Math.max(8, Math.min(viewport.width - 8, x + rand(-28, 28)));
      y = Math.max(8, Math.min(viewport.height - 8, y + rand(-18, 18)));
      await dispatchMove(send, x, y);
      moves++;
      await sleep(randInt(80, 220));
    }
  }

  return { moves, durationMs: Date.now() - start };
}

export async function humanMouseClick(send, target, opts = {}) {
  const viewport = await getViewportSize(send);
  const from = opts.from || {
    x: rand(viewport.width * 0.25, viewport.width * 0.75),
    y: rand(viewport.height * 0.15, viewport.height * 0.45),
  };

  const path = buildHumanPath(from, target, opts);
  let last = from;

  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    await dispatchMove(send, p.x, p.y);
    last = p;
    if (p.pause) await sleep(p.pause);
    const base = i < path.length * 0.2 || i > path.length * 0.85 ? rand(14, 32) : rand(7, 18);
    await sleep(base);
  }

  const hoverMs = Number(opts.hoverMs) || rand(220, 520);
  await sleep(hoverMs);
  await sleep(rand(Number(opts.preClickMs) || 80, Number(opts.preClickMsMax) || 200));

  const pressMs = Number(opts.pressMs) || rand(130, 240);
  const driftSteps = randInt(3, 6);
  const driftX = rand(-1.8, 1.8);
  const driftY = rand(-1.2, 1.2);

  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: last.x,
    y: last.y,
    button: "left",
    clickCount: 1,
    pointerType: "mouse",
  });

  for (let d = 1; d <= driftSteps; d++) {
    const t = d / driftSteps;
    await dispatchMove(send, last.x + driftX * t, last.y + driftY * t, { button: "left", buttons: 1 });
    await sleep(pressMs / driftSteps);
  }

  const releaseX = last.x + driftX;
  const releaseY = last.y + driftY;
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: releaseX,
    y: releaseY,
    button: "left",
    clickCount: 1,
    pointerType: "mouse",
  });

  await sleep(rand(60, 140));
  await dispatchMove(send, releaseX + rand(8, 24), releaseY + rand(-6, 10));

  return {
    clicked: true,
    x: releaseX,
    y: releaseY,
    pathSteps: path.length,
    pressMs: Math.round(pressMs),
    hoverMs: Math.round(hoverMs),
    from,
  };
}

export async function connectToTab({ tabId, urlIncludes } = {}) {
  const port = getCdpPort();
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const pages = targets.filter((t) => t.type === "page");
  let tab = null;
  if (tabId) {
    const needle = String(tabId).toLowerCase();
    tab = pages.find(
      (t) =>
        t.id === tabId ||
        t.id.toLowerCase().endsWith(needle) ||
        t.url.includes(needle),
    );
  }
  if (!tab && urlIncludes) {
    tab = pages.find((t) => t.url.includes(urlIncludes));
  }
  if (!tab) tab = pages[0];
  if (!tab?.webSocketDebuggerUrl) throw new Error("No CDP page target found");

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Page.enable").catch(() => {});
  await send("Target.activateTarget", { targetId: tab.id }).catch(() => {});
  await send("Page.bringToFront").catch(() => {});

  return { ws, send, targetId: tab.id, url: tab.url, close: () => ws.close() };
}

export async function findTurnstileIframe(send, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const doc = await send("DOM.getDocument", { depth: -1, pierce: true });
    const iframes = walkNodes(
      doc.result?.root,
      (n) =>
        n.nodeName === "IFRAME" &&
        (/turnstile|challenges\.cloudflare/i.test(attr(n, "src")) ||
          /widget|challenge/i.test(attr(n, "title"))),
    );
    const iframe = iframes[0] || walkNodes(doc.result?.root, (n) => n.nodeName === "IFRAME")[0];
    if (iframe?.nodeId) {
      const box = await send("DOM.getBoxModel", { nodeId: iframe.nodeId });
      const c = box.result?.model?.content;
      if (c) {
        const h = c[5] - c[1];
        const w = c[2] - c[0];
        if (h >= 36 && w >= 120) return { iframe, box: c };
      }
    }
    if (attempt < retries - 1) await sleep(500);
  }
  return null;
}

export async function getTurnstileClickTarget(send, opts = {}) {
  const found = await findTurnstileIframe(send);
  if (!found) return null;

  const offsetX = Number(opts.offsetX) || rand(18, 28);
  const c = found.box;
  const width = c[2] - c[0];
  const height = c[5] - c[1];
  const x = c[0] + Math.min(offsetX, width * 0.14) + rand(-2, 2);
  const y = c[1] + height / 2 + rand(-3, 3);

  return { x, y, src: attr(found.iframe, "src").slice(0, 120), box: c };
}

export async function clickTurnstileViaCdp(conn, opts = {}) {
  const target = await getTurnstileClickTarget(conn.send, opts);
  if (!target) return { clicked: false, reason: "no_iframe" };

  if (opts.warmUp !== false) {
    await warmUpSession(conn.send, opts);
    await sleep(randInt(800, 1800));
  }

  const human = opts.human !== false;
  if (!human) {
    await dispatchMove(conn.send, target.x, target.y);
    await conn.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    });
    await conn.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    });
    return { clicked: true, x: target.x, y: target.y, src: target.src, human: false };
  }

  const click = await humanMouseClick(conn.send, { x: target.x, y: target.y }, opts);
  return { ...click, src: target.src, human: true };
}

export async function pageChallengeState(tabId) {
  const js = `JSON.stringify((function(){
    var text = (document.body && document.body.innerText) || '';
    var hidden = document.querySelector('input[name="cf-turnstile-response"], input[id*="cf-chl-widget"][id*="_response"]');
    var token = hidden && hidden.value ? hidden.value : '';
    var container = document.querySelector('#BbLB6') || (hidden && (hidden.closest('[style*="grid"]') || hidden.parentElement && hidden.parentElement.parentElement));
    var widgetReady = false;
    if (container) {
      var r = container.getBoundingClientRect();
      widgetReady = r.height >= 36 && r.width >= 120;
    }
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, 400),
      verifyingHuman: /verifying you are human/i.test(text),
      securityVerification: /performing security verification/i.test(text),
      verifyHumanText: /verify you are human/i.test(text),
      turnstileResponse: token,
      hasToken: !!token,
      widgetReady: widgetReady,
      challenge: /just a moment/i.test(document.title) || /performing security verification|verify you are human|verifying you are human|enable javascript and cookies/i.test(text)
    };
  })())`;
  const r = bbJson("eval", js, "--tab", tabId, "--json");
  const state = JSON.parse(r.result || r.data?.result || "{}");
  state.phase = classifyTurnstilePhase(state);
  return state;
}

export async function waitForTurnstileOutcome(tabId, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || 45000;
  const pollMs = Number(opts.pollMs) || 800;
  const start = Date.now();
  let sawVerifying = false;

  while (Date.now() - start < timeoutMs) {
    const state = await pageChallengeState(tabId);
    if (state.hasToken) {
      await sleep(randInt(800, 2000));
      const after = await pageChallengeState(tabId);
      if (after.hasToken || (await isCleared(after))) {
        return { ok: true, reason: "token", state: after.hasToken ? after : state };
      }
    }
    if (state.verifyingHuman) sawVerifying = true;
    if (await isCleared(state)) {
      return { ok: true, reason: "redirect", state };
    }
    if (sawVerifying && state.securityVerification && !state.verifyingHuman && !state.hasToken) {
      await sleep(randInt(2000, 4000));
      const retry = await pageChallengeState(tabId);
      if (retry.hasToken || (await isCleared(retry))) {
        return { ok: true, reason: "late_token", state: retry };
      }
      return { ok: false, reason: "verification_failed", state: retry };
    }
    await sleep(pollMs);
  }

  return { ok: false, reason: "timeout", state: await pageChallengeState(tabId).catch(() => ({})) };
}

/** Full bypass: warm up → wait for interactive widget → one click → wait for token/redirect. */
export async function runTurnstileBypass(conn, tabId, opts = {}) {
  const minBackgroundMs = Number(opts.minBackgroundMs) || randInt(5000, 9000);
  const bgStart = Date.now();

  while (Date.now() - bgStart < minBackgroundMs + 12000) {
    const state = await pageChallengeState(tabId);
    if (state.hasToken || (await isCleared(state))) {
      return { cleared: true, phase: state.phase, via: "already_cleared", state };
    }
    if (state.widgetReady && Date.now() - bgStart >= minBackgroundMs) break;
    if (state.phase === "background" || state.phase === "loading" || state.phase === "interactive") {
      await warmUpSession(conn.send, { durationMs: randInt(900, 1600) });
    }
    await sleep(randInt(700, 1200));
  }

  const preClick = await pageChallengeState(tabId);
  if (preClick.hasToken) {
    const outcome = await waitForTurnstileOutcome(tabId, opts);
    return { cleared: outcome.ok, phase: preClick.phase, via: "token_pending", outcome };
  }
  if (preClick.verifyingHuman && preClick.phase === "verifying") {
    const outcome = await waitForTurnstileOutcome(tabId, opts);
    return {
      cleared: outcome.ok,
      phase: preClick.phase,
      via: "wait_after_click",
      outcome,
    };
  }

  if (preClick.phase !== "interactive" && !preClick.widgetReady) {
    return { cleared: false, reason: "widget_not_ready", phase: preClick.phase, state: preClick };
  }

  await warmUpSession(conn.send, { durationMs: randInt(2000, 3500) });
  await sleep(randInt(1200, 2400));
  const click = await clickTurnstileViaCdp(conn, { ...opts, warmUp: false });
  if (!click.clicked) return { cleared: false, reason: click.reason || "click_failed", click };

  const outcome = await waitForTurnstileOutcome(tabId, opts);
  return {
    cleared: outcome.ok,
    click,
    outcome,
    phase: outcome.state?.phase,
  };
}

export async function isCleared(state) {
  if (!state) return false;
  if (state.hasToken) return true;
  return !state.challenge && !/just a moment/i.test(state.title || "");
}
