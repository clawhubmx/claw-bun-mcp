#!/usr/bin/env bun
/**
 * Resolve the first idle Notion tab (not generating) from tab list order.
 * Used by host scripts; bun-browser site --tab auto uses the same probe via site-runner.
 */

import { spawnSync } from "node:child_process";

const CLI = process.env.BUN_BROWSER_CLI || "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const NOTION_DOMAIN = "app.notion.com";
const AI_URL = `https://${NOTION_DOMAIN}/ai`;

function bbJson(...parts) {
  const argv = ["bun", CLI, ...parts, "--json"];
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim() || `bun-browser ${parts.join(" ")} failed`);
  }
  const out = (result.stdout || "").trim();
  const start = out.indexOf("{");
  const arrStart = out.indexOf("[");
  const jsonStart = start >= 0 && (arrStart < 0 || start < arrStart) ? start : arrStart;
  if (jsonStart < 0) throw new Error(`No JSON in output: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(jsonStart));
}

function matchNotionTab(url) {
  try {
    const host = new URL(url).hostname;
    return host === NOTION_DOMAIN || host.endsWith("." + NOTION_DOMAIN);
  } catch {
    return false;
  }
}

function unwrapSite(data) {
  if (data && typeof data === "object" && "success" in data) {
    return data.success ? data.data : { error: data.error, hint: data.hint };
  }
  return data;
}

function probeTab(tabId) {
  const raw = bbJson("site", "notion/tab-probe", "--tab", String(tabId));
  return unwrapSite(raw);
}

function openNewTab() {
  const raw = bbJson("tab", "new", AI_URL);
  const tabId = raw?.data?.tab ?? raw?.data?.tabId ?? raw?.tabId ?? raw?.tab;
  if (!tabId) throw new Error("tab new did not return tabId");
  return tabId;
}

/**
 * @param {{ openIfAllBusy?: boolean }} [opts]
 * @returns {{ tabId: string|number, busy: boolean, opened: boolean, scanned: number, probes: Array<{tabId: string|number, busy: boolean}> }}
 */
export function resolveIdleNotionTab(opts = {}) {
  const openIfAllBusy = opts.openIfAllBusy !== false;
  const list = bbJson("tab", "list");
  const tabs = (list?.tabs || list?.data?.tabs || []).filter((t) => matchNotionTab(t.url || ""));
  const probes = [];

  for (const tab of tabs) {
    const tabId = tab.tab ?? tab.tabId ?? tab.index;
    const probe = probeTab(tabId);
    const busy = !!probe?.busy;
    probes.push({ tabId, busy, url: tab.url, conversationId: probe?.conversationId || null });
    if (!busy) {
      return { tabId, busy: false, opened: false, scanned: probes.length, probes };
    }
  }

  if (!openIfAllBusy) {
    return { tabId: null, busy: true, opened: false, scanned: probes.length, probes };
  }

  const tabId = openNewTab();
  return { tabId, busy: false, opened: true, scanned: probes.length, probes };
}

if (import.meta.main) {
  const result = resolveIdleNotionTab();
  console.log(JSON.stringify(result, null, 2));
}
