#!/usr/bin/env bun
/**
 * Patch the 20 failed get-article adapters with access guards, DOM fixes, and banned flags.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

const FAILED_SLUGS = [
  "bleachernation", "bloomberg", "consequence", "courthousenews", "eventhubs",
  "gematsu", "hayspost", "hollywoodreporter", "kvia", "mlbtraderumors",
  "nbcsports", "nbcwashington", "newser", "nintendoeverything", "rollingstone",
  "sports-yahoo-com", "statnews", "theurbanist", "ussoccer", "yahoo",
];

const SITE_CONFIG = {
  bleachernation: { banned: true, banReason: "Cloudflare bot protection blocks programmatic access" },
  gematsu: { banned: true, banReason: "Cloudflare bot protection blocks programmatic access" },
  hayspost: { banned: true, banReason: "HTTP 403 — publisher blocks programmatic fetch" },
  newser: { banned: true, banReason: "HTTP 403 — publisher blocks programmatic fetch" },
  nbcwashington: { banned: true, banReason: "HTTP 403 — Akamai blocks programmatic fetch" },
  mlbtraderumors: { extraSelectors: [".entry-content"] },
  theurbanist: { extraSelectors: [".entry-content", ".post-content"] },
  consequence: { extraSelectors: [".post-content", ".c-content"] },
  courthousenews: { extraSelectors: [".entry-content", ".article-content", ".post-content"] },
  nintendoeverything: { extraSelectors: [".entry-content", ".post-content", ".td-post-content"] },
  nbcsports: { extraSelectors: [".ArticlePage-articleBody", ".ArticlePage-content"] },
  kvia: { extraSelectors: [".article-content", ".entry-content", ".story-body"] },
  eventhubs: { extraSelectors: [".content", ".article-content", "#content"] },
  "sports-yahoo-com": { extraSelectors: [".caas-body", ".article-body", "[data-test-locator=\"article-body\"]"] },
  yahoo: { extraSelectors: [".caas-body", ".article-body", "[data-test-locator=\"article-body\"]"] },
  rollingstone: { extraSelectors: [".article-content", ".c-content", ".paywall"] },
  statnews: { extraSelectors: [".article-content", ".entry-content", ".paywall"] },
  ussoccer: { extraSelectors: [".story-content", ".article-body", ".field--name-body"] },
  bloomberg: { extraSelectors: [".body-content", "[data-component=\"paragraph\"]", "article"] },
  hollywoodreporter: { extraSelectors: [".a-content", ".article-body"] },
};

const ACCESS_GUARD = `
  function detectAccessDenied(doc, htmlText) {
    if (!doc && !htmlText) return null;
    var title = doc && doc.querySelector("title") ? (doc.querySelector("title").textContent || "") : "";
    var body = doc && doc.body ? (doc.body.textContent || "") : "";
    var blob = (title + "\\n" + body + "\\n" + (htmlText || "")).slice(0, 15000);
    var patterns = [
      /access denied/i,
      /403 forbidden/i,
      /request blocked/i,
      /you don't have permission/i,
      /errors\\.edgesuite\\.net/i,
      /reference #18\\./i,
      /akamai.*denied/i,
      /just a moment\\.\\.\\./i,
      /enable javascript and cookies to continue/i,
      /verify you are human/i,
      /unusual traffic/i,
      /automated access/i,
      /blocked by security/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(blob)) return patterns[i].source;
    }
    return null;
  }

  function bannedResponse(raw, reason, title) {
    return {
      banned: true,
      reason: reason,
      url: raw,
      title: title || null,
      hint: "Publisher blocks programmatic article extraction. Open in Chrome manually or use a subscription session.",
    };
  }
`;

function patchFindArticleRoot(content, extraSelectors) {
  const extras = extraSelectors || [];
  const extraLines = extras.map((s) => `      "${s}",`).join("\n");
  const oldStart = `    var selectors = [
      "[itemprop='articleBody']",`;
  const newStart = `    var selectors = [
      ${extraLines}
      ".entry-content",
      ".post-content",
      ".td-post-content",
      "[itemprop='articleBody']",`;

  if (!content.includes('".entry-content",\n      ".post-content"')) {
    content = content.replace(oldStart, newStart);
  } else if (extras.length) {
    for (const sel of extras) {
      if (!content.includes(`"${sel}"`)) {
        content = content.replace(
          `    var selectors = [\n      ".entry-content",`,
          `    var selectors = [\n      "${sel}",\n      ".entry-content",`
        );
      }
    }
  }

  // Relax single-paragraph rule for content containers
  content = content.replace(
    `      if (ps.length >= 2) return el;
      if (selectors[i].indexOf("article") >= 0 && ps.length >= 1) return el;`,
    `      if (ps.length >= 2) return el;
      if (ps.length >= 1 && /entry-content|post-content|articleBody|ArticlePage|caas-body|story-content|field--name-body|a-content/.test(selectors[i])) return el;
      if (selectors[i].indexOf("article") >= 0 && ps.length >= 1) return el;
      if (ps.length === 0 && el.innerText && el.innerText.replace(/\\s+/g, " ").trim().length >= 400) return el;`
  );

  return content;
}

function patchExtractDomBody(content) {
  const marker = `    return sanitizeArticleBody(blocks.join("\\n\\n"));
  }

  function extractTitle(root) {`;
  const fallback = `    if (!blocks.length && content) {
      var fallbackText = extractElementText(content);
      if (fallbackText && fallbackText.length >= 200) blocks.push(fallbackText);
    }

    return sanitizeArticleBody(blocks.join("\\n\\n"));
  }

  function extractTitle(root) {`;
  if (!content.includes("if (!blocks.length && content)")) {
    content = content.replace(marker, fallback);
  }
  return content;
}

function patchHttp403(content, cfg) {
  if (cfg.banned) {
    content = content.replace(
      `    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open`,
      `    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 451) {
        return bannedResponse(raw, "HTTP " + resp.status + " — ${cfg.banReason.replace(/"/g, '\\"')}", state.title || null);
      }
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open`
    );
  }
  return content;
}

function patchBotChallenge(content, cfg) {
  content = content.replace(
    `    if (isBotChallenge(doc)) {
      return {
        error: "Bot challenge blocked fetch",
        hint: "Open the article in Chrome, wait for the page to load, then retry.",
        action: "bun-browser open " + raw,
        title: state.title || null,
      };
    }`,
    `    var denied = detectAccessDenied(doc, html);
    if (denied || isBotChallenge(doc)) {
      ${cfg.banned ? `return bannedResponse(raw, denied || "Bot challenge — ${cfg.banReason.replace(/"/g, '\\"')}", state.title || null);` : `return {
        error: denied ? "Access denied" : "Bot challenge blocked fetch",
        hint: "Open the article in Chrome, wait for the page to load, then retry.",
        action: "bun-browser open " + raw,
        title: state.title || null,
      };`}
    }`
  );
  return content;
}

function patchFile(slug) {
  const file = join(ROOT, slug, "get-article.js");
  if (!existsSync(file)) {
    console.log("skip missing", slug);
    return;
  }
  const cfg = SITE_CONFIG[slug] || {};
  let content = readFileSync(file, "utf8");

  if (!content.includes("function detectAccessDenied")) {
    content = content.replace(
      /async function \(args\) \{\n  var SITE_ROOT/,
      `async function (args) {\n  var SITE_ROOT`
    );
    content = content.replace(
      `  var SITE_HOSTS = `,
      `${ACCESS_GUARD}\n  var SITE_HOSTS = `
    );
  }

  content = patchFindArticleRoot(content, cfg.extraSelectors);
  content = patchExtractDomBody(content);
  content = patchHttp403(content, cfg);
  content = patchBotChallenge(content, cfg);

  if (cfg.banned && !content.includes('"banned": true')) {
    content = content.replace(
      `"readOnly": true,`,
      `"readOnly": true,\n  "banned": true,\n  "banReason": "${cfg.banReason.replace(/"/g, '\\"')}",`
    );
  }

  writeFileSync(file, content);
  console.log("patched", slug, cfg.banned ? "(banned)" : "");
}

for (const slug of FAILED_SLUGS) patchFile(slug);
