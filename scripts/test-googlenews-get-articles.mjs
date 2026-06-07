#!/usr/bin/env bun
/**
 * Thoroughly test newly generated get-article adapters using real Google News RSS links.
 *
 * Usage:
 *   bun scripts/test-googlenews-get-articles.mjs [--limit N] [--slug foo] [--json-out path]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = join(import.meta.dir, "..");
const CLI = "/Users/hesdx/Documents/toolings/bun-browser/dist/cli.js";
const NEWS_SRC = join(ROOT, "NEWS-SRC.md");

const ORIGINAL_SLUGS = new Set([
  "barrons", "axios", "economist", "ft", "gizmodo", "investing", "japantimes",
  "marktechpost", "marketwatch", "medium", "nytimes", "politico", "reuters",
  "stonex", "utilitydive", "washingtonpost", "wsj",
]);

const RSS_FEEDS = [
  "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-US&gl=US&ceid=US:en",
];

function normDomain(d) {
  return d.replace(/^www\./, "");
}

function adapterMatchesPublisher(adapterDomain, publisherDomain) {
  const a = normDomain(adapterDomain);
  const p = normDomain(publisherDomain);
  if (a === p) return true;
  if (a === `www.${p}` || p === `www.${a}`) return true;
  return false;
}

function parsePublisherTable(md) {
  const rows = [];
  const section = md.indexOf("## Google News publisher domains");
  const body = md.slice(section);
  for (const line of body.split("\n")) {
    const m = line.match(/^\| ([^|]+) \| ([^|]+) \|([^|]*)\|$/);
    if (!m || m[1].includes("---") || m[1] === "Domain") continue;
    const ga = m[3].trim().match(/`([^`/]+)/);
    rows.push({
      domain: m[1].trim(),
      publisher: m[2].trim(),
      slug: ga ? ga[1] : null,
    });
  }
  return rows;
}

function loadNewAdapters() {
  const adapters = [];
  for (const name of readdirSync(ROOT, { withFileTypes: true })) {
    if (!name.isDirectory() || ORIGINAL_SLUGS.has(name.name)) continue;
    const file = join(ROOT, name.name, "get-article.js");
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const meta = content.match(/"domain":\s*"([^"]+)"/);
    adapters.push({ slug: name.name, domain: meta ? meta[1] : name.name });
  }
  adapters.sort((a, b) => a.slug.localeCompare(b.slug));
  return adapters;
}

async function collectRssSamples() {
  const byDomain = new Map();
  const itemRe = /<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<source url="([^"]*)">([^<]*)<\/source>/g;

  for (const feed of RSS_FEEDS) {
    const resp = await fetch(feed, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: "CONSENT=PENDING+987" },
    });
    if (!resp.ok) continue;
    const xml = await resp.text();
    let m;
    while ((m = itemRe.exec(xml))) {
      const domain = normDomain(new URL(m[2]).hostname);
      if (!byDomain.has(domain)) {
        byDomain.set(domain, { rssLink: m[1], sourceUrl: m[2], title: m[3].trim() });
      }
    }
  }
  return byDomain;
}

function runSite(command, arg, timeoutMs = 120000) {
  const args = ["bun", CLI, "site", command];
  if (arg) args.push(arg);
  const r = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  const out = (r.stdout || "").trim();
  const err = (r.stderr || "").trim();
  return { out, err, status: r.status, signal: r.signal, timedOut: r.signal === "SIGTERM" || r.signal === "SIGKILL" };
}

function parseCliResult(out, err, timedOut) {
  if (timedOut) {
    return { status: "error", reason: "timeout", preview: (out || err).slice(0, 200) };
  }

  const data = parseJsonOutput(out);
  if (data) return classifyResult(data, out);

  const errMatch = err.match(/\[error\]\s*site\s+[^:]+:\s*([^\n]+)/);
  if (errMatch) {
    const hintMatch = err.match(/Hint:\s*([^\n]+)/);
    return {
      status: "fail",
      reason: errMatch[1].trim(),
      hint: hintMatch ? hintMatch[1].trim() : null,
    };
  }

  const daemonErr = err.match(/"error"\s*:\s*"([^"]+)"/);
  if (daemonErr) {
    return { status: "fail", reason: daemonErr[1], hint: null };
  }

  return { status: "error", reason: "unparseable_output", preview: (out || err).slice(0, 200) };
}

function parseJsonOutput(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

function classifyResult(data, rawOut) {
  if (!data) {
    return { status: "error", reason: "unparseable_output", preview: rawOut.slice(0, 200) };
  }
  if (data.error) {
    return {
      status: "fail",
      reason: data.error,
      hint: data.hint || null,
      title: data.title || null,
      preview: data.preview || null,
    };
  }
  const body = data.articleBody || "";
  const len = data.bodyCharacterCount || body.length || 0;
  if (len >= 500) {
    return { status: "pass", reason: "full_body", bodyLength: len, title: data.title, source: data.source };
  }
  if (len >= 200) {
    return { status: "weak", reason: "short_body", bodyLength: len, title: data.title, source: data.source };
  }
  return { status: "fail", reason: "no_body", bodyLength: len, title: data.title };
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const slugFilter = process.argv.find((a) => a.startsWith("--slug="))?.split("=")[1];
  const retryFrom = process.argv.find((a) => a.startsWith("--retry-from="))?.split("=")[1];
  const jsonOut = process.argv.find((a) => a.startsWith("--json-out="))?.split("=")[1]
    || join(ROOT, "scripts/googlenews-get-article-test-results.json");
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

  const publishers = parsePublisherTable(readFileSync(NEWS_SRC, "utf8"));
  let adapters = loadNewAdapters();
  if (slugFilter) adapters = adapters.filter((a) => a.slug === slugFilter);
  if (retryFrom && existsSync(retryFrom)) {
    const prev = JSON.parse(readFileSync(retryFrom, "utf8"));
    const retrySlugs = new Set(
      prev.results
        .filter((r) => ["fail", "error", "weak", "skip"].includes(r.getArticle?.status))
        .map((r) => r.slug)
    );
    adapters = adapters.filter((a) => retrySlugs.has(a.slug));
    console.log(`Retrying ${adapters.length} adapters from prior run`);
  }
  if (Number.isFinite(limit)) adapters = adapters.slice(0, limit);

  console.log(`Testing ${adapters.length} newly generated get-article adapters...`);
  const rssByDomain = await collectRssSamples();
  console.log(`Collected RSS samples for ${rssByDomain.size} domains`);

  const results = [];
  let i = 0;

  for (const adapter of adapters) {
    i++;
    const publisher = publishers.find((p) => p.slug === adapter.slug);
    const publisherDomain = publisher ? publisher.domain : normDomain(adapter.domain);

    const sample = rssByDomain.get(publisherDomain);
    const entry = {
      slug: adapter.slug,
      domain: adapter.domain,
      publisherDomain,
      publisher: publisher?.publisher || null,
      rssSample: sample ? sample.title : null,
      rssLink: sample?.rssLink || null,
      resolvedUrl: null,
      resolveError: null,
      getArticle: null,
    };

    process.stdout.write(`[${i}/${adapters.length}] ${adapter.slug} ... `);

    if (!sample) {
      entry.getArticle = { status: "skip", reason: "no_rss_sample" };
      results.push(entry);
      console.log("SKIP (no RSS sample)");
      continue;
    }

    const resolveRun = runSite("googlenews/resolve-url", sample.rssLink, 60000);
    const resolveData = parseJsonOutput(resolveRun.out);
    const resolvedUrl = resolveData?.url || resolveData?.data?.url || null;

    if (!resolvedUrl) {
      entry.resolveError = resolveData?.error || resolveRun.err.slice(0, 200) || "resolve_failed";
      entry.getArticle = { status: "skip", reason: "resolve_failed", detail: entry.resolveError };
      results.push(entry);
      console.log("SKIP (resolve failed)");
      continue;
    }

    entry.resolvedUrl = resolvedUrl;

    const articleRun = runSite(`${adapter.slug}/get-article`, resolvedUrl, 120000);
    entry.getArticle = parseCliResult(articleRun.out, articleRun.err, articleRun.timedOut);
    results.push(entry);

    console.log(`${entry.getArticle.status.toUpperCase()} (${entry.getArticle.reason}${entry.getArticle.bodyLength ? ", " + entry.getArticle.bodyLength + " chars" : ""})`);
  }

  const summary = {
    testedAt: new Date().toISOString(),
    total: results.length,
    pass: results.filter((r) => r.getArticle?.status === "pass").length,
    weak: results.filter((r) => r.getArticle?.status === "weak").length,
    fail: results.filter((r) => r.getArticle?.status === "fail").length,
    error: results.filter((r) => r.getArticle?.status === "error").length,
    skip: results.filter((r) => r.getArticle?.status === "skip").length,
    results,
  };

  writeFileSync(jsonOut, JSON.stringify(summary, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(`PASS:  ${summary.pass}`);
  console.log(`WEAK:  ${summary.weak} (200-499 chars)`);
  console.log(`FAIL:  ${summary.fail}`);
  console.log(`ERROR: ${summary.error}`);
  console.log(`SKIP:  ${summary.skip}`);
  console.log(`Report: ${jsonOut}`);

  if (summary.fail > 0 || summary.error > 0) {
    console.log("\nFailed / errored:");
    for (const r of results.filter((x) => x.getArticle?.status === "fail" || x.getArticle?.status === "error")) {
      console.log(`  - ${r.slug}: ${r.getArticle.reason}${r.getArticle.hint ? " — " + r.getArticle.hint : ""}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
