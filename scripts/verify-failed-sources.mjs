#!/usr/bin/env bun
/**
 * Verify patched failed sources: open article tab, check access-denied/paywall, run get-article.
 * Sequential (reliable); use --parallel=N for a tab pool (default 1).
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = join(import.meta.dir, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const IN = join(ROOT, "scripts/googlenews-get-article-final-results.json");
const OUT = join(ROOT, "scripts/failed-sources-verify.json");

const parallelArg = process.argv.find((a) => a.startsWith("--parallel="));
const PARALLEL = parallelArg ? Math.max(1, parseInt(parallelArg.split("=")[1], 10)) : 1;

const ACCESS_DENIED = [
  /access denied/i,
  /403 forbidden/i,
  /request blocked/i,
  /just a moment\.\.\./i,
  /attention required! \| cloudflare/i,
  /errors\.edgesuite\.net/i,
  /akamai.*denied/i,
  /verify you are human/i,
];

const PAYWALL = [
  /subscribe to (read|continue|unlock)/i,
  /subscription required/i,
  /this article is for subscribers/i,
  /become a member/i,
  /sign in to read/i,
  /premium content/i,
  /subscriber-only/i,
];

function run(args, timeout = 120000) {
  const r = spawnSync("bun", [CLI, ...args], { encoding: "utf8", timeout, maxBuffer: 15 * 1024 * 1024 });
  return { out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function parseJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0) return JSON.parse(t.slice(s, e + 1));
  }
  return null;
}

function classifyPage(title, body) {
  const blob = `${title}\n${body}`.slice(0, 12000);
  for (const re of ACCESS_DENIED) {
    if (re.test(blob)) return { kind: "access_denied", reason: re.source };
  }
  for (const re of PAYWALL) {
    if (re.test(blob)) return { kind: "paywall", reason: re.source };
  }
  return { kind: "ok", reason: null };
}

async function verifyOne(item) {
  const { slug, resolvedUrl: url } = item;

  run(["open", url]);
  await new Promise((r) => setTimeout(r, 3500));

  const probe = run([
    "eval",
    `(function(){ return JSON.stringify({ title: document.title || "", body: (document.body && document.body.innerText || "").slice(0,8000), href: location.href }); })()`,
  ]);
  const page = parseJson(probe.out);
  const pageClass = classifyPage(page?.title || "", page?.body || "");

  if (pageClass.kind === "access_denied") {
    return {
      slug,
      url,
      pageClass: pageClass.kind,
      pageReason: pageClass.reason,
      status: "banned",
      bodyLength: 0,
      banned: true,
      reason: pageClass.reason,
      source: null,
    };
  }

  const ga = run(["site", `${slug}/get-article`, url]);
  const j = parseJson(ga.out);

  let status = "fail";
  if (j?.banned) status = "banned";
  else if (j?.articleBody?.length >= 500) status = "pass";
  else if (j?.articleBody?.length >= 200) status = "weak";
  else if (j?.error?.includes("paywall") || j?.error?.includes("preview")) status = "paywall";
  else if (j?.error) status = "fail";

  return {
    slug,
    url,
    pageClass: pageClass.kind,
    pageReason: pageClass.reason,
    status,
    bodyLength: j?.bodyCharacterCount || j?.articleBody?.length || 0,
    banned: j?.banned || false,
    reason: j?.reason || j?.error || ga.err.slice(0, 160),
    source: j?.source || null,
  };
}

async function poolMap(items, limit, fn) {
  if (limit <= 1) {
    const results = [];
    for (let i = 0; i < items.length; i++) {
      results.push(await fn(items[i], i));
      console.log(`[${i + 1}/${items.length}] ${items[i].slug}: ${results[i].status}${results[i].bodyLength ? ` (${results[i].bodyLength})` : results[i].banned ? " banned" : ""}`);
    }
    return results;
  }

  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      console.log(`[${i + 1}/${items.length}] ${items[i].slug}: ${results[i].status}${results[i].bodyLength ? ` (${results[i].bodyLength})` : ""}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const data = JSON.parse(readFileSync(IN, "utf8"));
const failed = data.results.filter((r) => ["fail", "error"].includes(r.getArticle?.status));
console.log(`Verifying ${failed.length} failed sources (parallel=${PARALLEL})...`);

const results = await poolMap(failed, PARALLEL, verifyOne);

const summary = {
  verifiedAt: new Date().toISOString(),
  parallel: PARALLEL,
  pass: results.filter((r) => r.status === "pass").length,
  weak: results.filter((r) => r.status === "weak").length,
  banned: results.filter((r) => r.status === "banned").length,
  paywall: results.filter((r) => r.status === "paywall").length,
  fail: results.filter((r) => r.status === "fail").length,
  results,
};

writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log("\n", JSON.stringify(summary, null, 2));
