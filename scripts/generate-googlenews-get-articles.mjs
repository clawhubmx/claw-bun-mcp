#!/usr/bin/env bun
/**
 * Generate get-article.js adapters for Google News publisher domains
 * listed in NEWS-SRC.md without existing get-article support.
 *
 * Usage: bun scripts/generate-googlenews-get-articles.mjs [--write-news-src]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(import.meta.dir, "..");
const TEMPLATE = readFileSync(join(ROOT, "scripts/templates/generic-get-article.js.tpl"), "utf8");
const NEWS_SRC = join(ROOT, "NEWS-SRC.md");

const EXISTING_ADAPTERS = new Set(
  readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(ROOT, name, "get-article.js")))
);

const EXISTING_DOMAIN_MAP = {
  "barrons.com": "barrons",
  "axios.com": "axios",
  "economist.com": "economist",
  "ft.com": "ft",
  "gizmodo.com": "gizmodo",
  "investing.com": "investing",
  "japantimes.co.jp": "japantimes",
  "marktechpost.com": "marktechpost",
  "marketwatch.com": "marketwatch",
  "medium.com": "medium",
  "nytimes.com": "nytimes",
  "politico.com": "politico",
  "reuters.com": "reuters",
  "stonex.com": "stonex",
  "utilitydive.com": "utilitydive",
  "washingtonpost.com": "washingtonpost",
  "wsj.com": "wsj",
};

function parsePublisherTable(md) {
  const rows = [];
  const section = md.indexOf("## Google News publisher domains");
  if (section < 0) throw new Error("Publisher domains section not found in NEWS-SRC.md");
  const body = md.slice(section);
  for (const line of body.split("\n")) {
    const m = line.match(/^\| ([^|]+) \| ([^|]+) \|([^|]*)\|$/);
    if (!m || m[1].includes("---") || m[1] === "Domain") continue;
    rows.push({
      domain: m[1].trim(),
      publisher: m[2].trim().replace(/\\(\|)/g, "$1"),
      getArticle: m[3].trim(),
    });
  }
  return rows;
}

function normDomain(domain) {
  return domain.replace(/^www\./, "");
}

function metaDomain(domain) {
  const d = normDomain(domain);
  const parts = d.split(".");
  if (parts.length === 2) return `www.${d}`;
  if (parts.length === 3 && (parts[1] === "co" || parts[1] === "com")) return `www.${d}`;
  return d;
}

function allowedHostnames(domain) {
  const d = normDomain(domain);
  const hosts = new Set([d, `www.${d}`]);
  if (d.startsWith("www.")) hosts.add(d.replace(/^www\./, ""));
  return [...hosts];
}

function slugFromDomain(domain) {
  const d = normDomain(domain);
  if (EXISTING_DOMAIN_MAP[d]) return EXISTING_DOMAIN_MAP[d];
  const parts = d.split(".");
  if (parts.length === 2) return parts[0];
  if (parts.length === 3 && parts[1] === "co") return parts[0];
  return d.replace(/\./g, "-");
}

function uniqueSlug(base, used) {
  let slug = base;
  let i = 2;
  while (used.has(slug) || EXISTING_ADAPTERS.has(slug)) {
    slug = `${base}-${i}`;
    i++;
  }
  used.add(slug);
  return slug;
}

function exampleUrl(metaDomain) {
  return `https://${metaDomain}/`;
}

function renderAdapter({ slug, publisher, domain, metaDom }) {
  const commandName = `${slug}/get-article`;
  const allowed = JSON.stringify(allowedHostnames(domain));
  const root = normDomain(domain);
  return TEMPLATE.replace(/\{\{COMMAND_NAME\}\}/g, commandName)
    .replace(/\{\{PUBLISHER\}\}/g, publisher.replace(/"/g, '\\"'))
    .replace(/\{\{META_DOMAIN\}\}/g, metaDom)
    .replace(/\{\{ROOT_DOMAIN\}\}/g, root)
    .replace(/\{\{ALLOWED_HOSTNAMES\}\}/g, allowed)
    .replace(/\{\{EXAMPLE_URL\}\}/g, exampleUrl(metaDom));
}

function loadAllAdapters() {
  const adapters = [];
  for (const name of readdirSync(ROOT, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const file = join(ROOT, name.name, "get-article.js");
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    const meta = content.match(/"domain":\s*"([^"]+)"/);
    const domain = meta ? meta[1] : name.name;
    adapters.push({ slug: name.name, domain, script: `${name.name}/get-article.js` });
  }
  adapters.sort((a, b) => a.slug.localeCompare(b.slug));
  return adapters;
}

function adapterMatchesPublisher(adapterDomain, publisherDomain) {
  const a = normDomain(adapterDomain);
  const p = normDomain(publisherDomain);
  if (a === p) return true;
  if (a === `www.${p}` || p === `www.${a}`) return true;
  return false;
}

function slugForPublisherDomain(publisherDomain, adapters) {
  for (const a of adapters) {
    if (adapterMatchesPublisher(a.domain, publisherDomain)) return a.slug;
  }
  return null;
}

function updateNewsSrc(md) {
  const adapters = loadAllAdapters();
  let out = md;
  const publisherRows = parsePublisherTable(md);

  for (const row of publisherRows) {
    const slug = slugForPublisherDomain(row.domain, adapters);
    if (!slug) continue;
    const escaped = row.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(\\| ${escaped} \\| [^|]+ \\|)[^|]*(\\|)`, "g");
    out = out.replace(re, `$1 \`${slug}/get-article\` $2`);
  }

  const tableLines = adapters.map((a) => {
    const feed = publisherRows.some((r) => adapterMatchesPublisher(a.domain, r.domain)) ? "yes" : "no";
    return `| ${a.slug} | ${a.domain} | \`${a.script}\` | ${feed} |`;
  });

  const getArticleSection = `## Full article extraction (\`get-article.js\`)

Sites that support full article extraction via \`bun-browser site <source>/get-article <url>\`.

| Source | Domain | Script | In Google News feed |
|--------|--------|--------|---------------------|
${tableLines.join("\n")}

**Total:** ${adapters.length} get-article sources (${tableLines.filter((l) => l.endsWith("| yes |")).length} currently appear in Google News US RSS feeds)`;

  out = out.replace(
    /## Full article extraction \(`get-article\.js`\)[\s\S]*?\*\*Total:\*\*[^\n]+\n/,
    getArticleSection + "\n"
  );

  out = out.replace(/\*\*Total:\*\* \d+ publisher domains\n$/, `**Total:** ${publisherRows.length} publisher domains\n`);

  return out;
}

function main() {
  const writeNewsSrc = process.argv.includes("--write-news-src");
  const rows = parsePublisherTable(readFileSync(NEWS_SRC, "utf8"));
  const unsupported = rows.filter((r) => !r.getArticle.includes("get-article"));
  const usedSlugs = new Set([...EXISTING_ADAPTERS]);
  const domainToSlug = {};
  let created = 0;
  let skipped = 0;

  for (const row of unsupported) {
    const domain = normDomain(row.domain);
    if (domain === "news.google.com") {
      skipped++;
      continue;
    }
    if (EXISTING_DOMAIN_MAP[domain] && EXISTING_ADAPTERS.has(EXISTING_DOMAIN_MAP[domain])) {
      skipped++;
      continue;
    }

    const baseSlug = slugFromDomain(domain);
    const slug = uniqueSlug(baseSlug, usedSlugs);
    const metaDom = metaDomain(domain);
    const dir = join(ROOT, slug);
    const file = join(dir, "get-article.js");

    if (existsSync(file)) {
      domainToSlug[domain] = slug;
      skipped++;
      continue;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(file, renderAdapter({ slug, publisher: row.publisher, domain, metaDom: metaDom }));
    domainToSlug[domain] = slug;
    created++;
  }

  console.log(`Generated ${created} adapters, skipped ${skipped}`);

  if (writeNewsSrc || created > 0) {
    const md = updateNewsSrc(readFileSync(NEWS_SRC, "utf8"));
    writeFileSync(NEWS_SRC, md);
    console.log("Updated NEWS-SRC.md");
  }
}

main();
