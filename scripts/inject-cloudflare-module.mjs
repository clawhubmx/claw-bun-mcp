#!/usr/bin/env bun
/**
 * Inline cloudflare/helpers.js into adapters and wire bypass logic.
 *
 * Usage:
 *   bun scripts/inject-cloudflare-module.mjs
 *   bun scripts/inject-cloudflare-module.mjs --slug bleachernation
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const HELPERS = readFileSync(join(ROOT, "cloudflare/helpers.js"), "utf8").trim();
const TEMPLATE = join(ROOT, "scripts/templates/generic-get-article.js.tpl");
const WAIT = join(ROOT, "cloudflare/wait.js");

const slugFilter = process.argv.find((a) => a.startsWith("--slug="))?.split("=")[1];

const CF_INIT = [
  "  var cf = (function () {",
  HELPERS.split("\n").map((line) => "    " + line).join("\n"),
  "    return installCloudflareHelpers();",
  "  })();",
  "",
].join("\n");

const CF_BLOCK_RE = /  var cf = \(function \(\) \{[\s\S]*?return installCloudflareHelpers\(\);\n  \}\)\(\);\n/;

const IS_BOT_CHALLENGE_FN = `  function isBotChallenge(doc, htmlText) {
    return cf.isChallenge(doc, htmlText || (doc && doc.documentElement ? doc.documentElement.outerHTML : ""));
  }`;

const WAIT_LOOP_OLD = `      if (isBotChallenge(document)) {
        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
        continue;
      }`;

const WAIT_LOOP_NEW = `      if (isBotChallenge(document)) {
        await cf.waitForClearance({ maxWaitMs: Math.max(delayMs * attempts * 2, 8000), pollMs: delayMs, autoClick: true });
        continue;
      }`;

const FETCH_BLOCK_NEW = `  if (!state.articleBody || !state.title) {
    if (!onArticlePage || isBotChallenge(document)) {
      await cf.waitForClearance({ url: raw, maxWaitMs: 25000, pollMs: 500, autoClick: true });
    }

    var fetchUrl = buildFetchUrl(raw);
    var resp = await fetch(fetchUrl, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      if ((resp.status === 403 || resp.status === 503) && isBotChallenge(document)) {
        var cfBypass = await cf.waitForClearance({ url: raw, maxWaitMs: 30000, autoClick: true });
        if (cfBypass.cleared) {
          resp = await fetch(fetchUrl, { credentials: "include", redirect: "follow" });
        }
      }
      if (!resp.ok) {
        return {
          error: "HTTP " + resp.status,
          hint: "Article may be unavailable. Open {{META_DOMAIN}} in Chrome first, then retry.",
          action: "bun-browser open " + raw,
        };
      }
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");

    if (isBotChallenge(doc, html)) {
      var cfRetry = await cf.waitForClearance({ url: raw, maxWaitMs: 30000, autoClick: true });
      if (cfRetry.cleared) {
        resp = await fetch(fetchUrl, { credentials: "include", redirect: "follow" });
        html = await resp.text();
        doc = new DOMParser().parseFromString(html, "text/html");
      }
    }

    if (isBotChallenge(doc, html)) {
      return {
        error: "Cloudflare challenge blocked fetch",
        hint: "Run bun-browser site cloudflare/wait on the article URL, wait for clearance, then retry get-article.",
        action: "bun-browser site cloudflare/wait " + raw,
        title: state.title || null,
      };
    }`;

const FETCH_RE = /if \(!state\.articleBody \|\| !state\.title\) \{\n    var resp = await fetch\(buildFetchUrl\(raw\)[\s\S]*?if \(isBotChallenge\(doc\)\) \{[\s\S]*?title: state\.title \|\| null,\n      \};\n    \}/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === "cloudflare" || name === "scripts") continue;
      walk(p, out);
    } else if (name === "get-article.js") out.push(p);
  }
  return out;
}

function patchIsBotChallenge(src) {
  const re = /function isBotChallenge\(doc(?:, htmlText)?\) \{[\s\S]*?\n  \}/;
  if (re.test(src)) return src.replace(re, IS_BOT_CHALLENGE_FN.trim());
  return src;
}

function patchFetchBlock(src, metaDomain) {
  if (!FETCH_RE.test(src)) return src;
  return src.replace(FETCH_RE, FETCH_BLOCK_NEW.replace(/\{\{META_DOMAIN\}\}/g, metaDomain || "the site"));
}

function patchCfInit(src) {
  if (CF_BLOCK_RE.test(src)) {
    const next = src.replace(CF_BLOCK_RE, CF_INIT);
    return next === src ? src : next;
  }
  if (!src.includes("installCloudflareHelpers")) {
    return src.replace(/async function \(args\) \{\n/, "async function (args) {\n" + CF_INIT);
  }
  return src;
}

function patchFile(filePath) {
  let src = readFileSync(filePath, "utf8");
  let changed = false;

  const cfPatched = patchCfInit(src);
  if (cfPatched !== src) {
    src = cfPatched;
    changed = true;
  }

  if (src.includes(WAIT_LOOP_OLD)) {
    src = src.replace(WAIT_LOOP_OLD, WAIT_LOOP_NEW);
    changed = true;
  }

  const next = patchIsBotChallenge(src);
  if (next !== src) {
    src = next;
    changed = true;
  }

  const domainMatch = src.match(/"domain":\s*"([^"]+)"/);
  const metaDomain = domainMatch ? domainMatch[1] : "the site";
  const fetchPatched = patchFetchBlock(src, metaDomain);
  if (fetchPatched !== src) {
    src = fetchPatched;
    changed = true;
  }

  if (changed) writeFileSync(filePath, src);
  return changed;
}

// Patch template
let tpl = readFileSync(TEMPLATE, "utf8");
if (!tpl.includes("installCloudflareHelpers")) {
  tpl = tpl.replace(/async function \(args\) \{\n  var SITE_ROOT/, "async function (args) {\n" + CF_INIT + "  var SITE_ROOT");
}
tpl = tpl.replace(WAIT_LOOP_OLD, WAIT_LOOP_NEW);
tpl = patchIsBotChallenge(tpl);
tpl = patchFetchBlock(tpl, "{{META_DOMAIN}}");
writeFileSync(TEMPLATE, tpl);

// Patch wait.js — always refresh inlined helpers
let waitSrc = readFileSync(WAIT, "utf8");
if (waitSrc.includes("{{CLOUDFLARE_HELPERS_BODY}}")) {
  waitSrc = waitSrc.replace("{{CLOUDFLARE_HELPERS_BODY}}", HELPERS);
} else {
  waitSrc = patchCfInit(waitSrc);
}
writeFileSync(WAIT, waitSrc);

// Patch get-article adapters
const files = walk(ROOT).filter((f) => !slugFilter || f.includes(`/${slugFilter}/`));
let count = 0;
for (const file of files) {
  if (patchFile(file)) count++;
}

console.log(`Patched template, cloudflare/wait.js, and ${count} get-article adapters`);
