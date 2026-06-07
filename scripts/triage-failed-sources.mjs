#!/usr/bin/env bun
/**
 * Triage failed get-article sources using an 8-tab pool.
 * Detects access-denied (mark banned) vs paywall (attempt open-page extraction).
 *
 * Usage: bun scripts/triage-failed-sources.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = join(import.meta.dir, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const POOL = 8;
const RESULTS_IN = join(ROOT, "scripts/googlenews-get-article-final-results.json");
const RESULTS_OUT = join(ROOT, "scripts/failed-sources-triage.json");

const ACCESS_DENIED_PATTERNS = [
  /access denied/i,
  /403 forbidden/i,
  /request blocked/i,
  /you don't have permission/i,
  /unable to access/i,
  /bot detection/i,
  /automated access/i,
  /unusual traffic/i,
  /verify you are human/i,
  /captcha/i,
  /please enable javascript and cookies to continue/i,
  /just a moment\.\.\./i,
  /attention required! \| cloudflare/i,
  /errors\.edgesuite\.net/i,
  /reference #18\./i,
  /akamai.*denied/i,
  /your access to this site has been limited/i,
  /blocked by security/i,
];

const PAYWALL_PATTERNS = [
  /subscribe to (read|continue|unlock|access)/i,
  /subscription required/i,
  /this article is for subscribers/i,
  /already a subscriber/i,
  /sign in to read/i,
  /create an account to continue/i,
  /members only/i,
  /paywall/i,
  /register to read/i,
  /unlock this article/i,
  /become a member/i,
  /premium content/i,
  /subscriber-only/i,
];

function run(args, timeoutMs = 120000) {
  const r = spawnSync("bun", [CLI, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 15 * 1024 * 1024,
  });
  return { out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), status: r.status, signal: r.signal };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(text.slice(s, e + 1));
      } catch {}
    }
  }
  return null;
}

function classifyPage(title, bodyText, httpStatus) {
  const blob = `${title}\n${bodyText}`.slice(0, 12000);
  if (httpStatus === 403 || httpStatus === 451) {
    return { kind: "banned", reason: `HTTP ${httpStatus}` };
  }
  for (const re of ACCESS_DENIED_PATTERNS) {
    if (re.test(blob)) return { kind: "banned", reason: re.source };
  }
  for (const re of PAYWALL_PATTERNS) {
    if (re.test(blob)) return { kind: "paywall", reason: re.source };
  }
  return { kind: "unknown", reason: null };
}

async function diagnoseOne(item) {
  const { slug, resolvedUrl: url } = item;
  const domain = new URL(url).hostname;

  // Open article tab
  run(["open", url]);
  await new Promise((r) => setTimeout(r, 2500));

  const probe = run([
    "eval",
    `(function(){
      var t = (document.title || "");
      var b = (document.body && document.body.innerText || "").slice(0, 12000);
      var h1 = document.querySelector("h1");
      var article = document.querySelector("article");
      var ld = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){
        try { ld.push(JSON.parse(s.textContent)); } catch(e){}
      });
      var ldBody = "";
      ld.forEach(function(n){
        function walk(o){
          if (!o) return;
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (typeof o === "object") {
            if (o.articleBody) ldBody = String(o.articleBody);
            Object.keys(o).forEach(function(k){ walk(o[k]); });
          }
        }
        walk(n);
      });
      var ps = document.querySelectorAll("article p, main p, [itemprop=articleBody] p, .article-body p, .entry-content p, .post-content p");
      var pTexts = [];
      for (var i = 0; i < ps.length && pTexts.length < 8; i++) {
        var tx = (ps[i].textContent || "").replace(/\\s+/g," ").trim();
        if (tx.length > 40) pTexts.push(tx.slice(0, 120));
      }
      return JSON.stringify({
        title: t,
        h1: h1 ? h1.textContent.trim() : "",
        bodyPreview: b.slice(0, 3000),
        ldBodyLen: ldBody ? ldBody.length : 0,
        paragraphCount: ps.length,
        sampleParagraphs: pTexts,
        url: location.href
      });
    })()`,
  ]);

  const page = parseJson(probe.out);
  const classification = classifyPage(page?.title || "", page?.bodyPreview || "", null);

  // Retry get-article on open tab
  const ga = run(["site", `${slug}/get-article`, url], 120000);
  const gaData = parseJson(ga.out);
  const gaErr = ga.err.match(/\[error\][^\n]+/)?.[0] || ga.err.match(/"error"\s*:\s*"([^"]+)"/)?.[1];

  let getArticleStatus = "fail";
  let bodyLength = 0;
  if (gaData?.articleBody) {
    bodyLength = gaData.bodyCharacterCount || gaData.articleBody.length;
    getArticleStatus = bodyLength >= 500 ? "pass" : bodyLength >= 200 ? "weak" : "fail";
  } else if (gaData?.error) {
    getArticleStatus = gaData.error.includes("403") ? "banned" : "fail";
  } else if (/403/.test(gaErr || "")) {
    getArticleStatus = "banned";
  }

  return {
    slug,
    url,
    domain,
    classification,
    page: page
      ? {
          title: page.title,
          h1: page.h1,
          ldBodyLen: page.ldBodyLen,
          paragraphCount: page.paragraphCount,
          sampleParagraphs: page.sampleParagraphs,
        }
      : null,
    getArticle: {
      status: getArticleStatus,
      bodyLength,
      error: gaData?.error || gaErr || null,
      source: gaData?.source || null,
    },
  };
}

async function poolMap(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      console.log(`[${i + 1}/${items.length}] ${items[i].slug}: ${results[i].classification.kind} / get-article=${results[i].getArticle.status}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  const data = JSON.parse(readFileSync(RESULTS_IN, "utf8"));
  const failed = data.results.filter((r) => ["fail", "error"].includes(r.getArticle?.status));
  console.log(`Triaging ${failed.length} failed sources (pool=${POOL})...`);

  const triage = await poolMap(failed, POOL, diagnoseOne);

  const summary = {
    triagedAt: new Date().toISOString(),
    pool: POOL,
    total: triage.length,
    banned: triage.filter((t) => t.classification.kind === "banned" || t.getArticle.status === "banned").length,
    paywall: triage.filter((t) => t.classification.kind === "paywall").length,
    fixed: triage.filter((t) => t.getArticle.status === "pass").length,
    weak: triage.filter((t) => t.getArticle.status === "weak").length,
    stillFail: triage.filter((t) => ["fail", "error"].includes(t.getArticle.status)).length,
    results: triage,
  };

  writeFileSync(RESULTS_OUT, JSON.stringify(summary, null, 2));
  console.log("\n=== TRIAGE SUMMARY ===");
  console.log(JSON.stringify({ banned: summary.banned, paywall: summary.paywall, fixed: summary.fixed, weak: summary.weak, stillFail: summary.stillFail }, null, 2));
  console.log(`Report: ${RESULTS_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
