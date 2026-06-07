#!/usr/bin/env bun
/** Fix false-positive `advert` match in shouldSkipNode (e.g. advert__autofill_content). */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const OLD =
  "if (/ad-|advert|banner|newsletter|signup|paywall|related|recommended|sidebar|comment|social-share|share-bar|promo|subscription|most-popular|trending|footer|nav-|breadcrumb|byline-share|author-bio|tags-list|tag-list|read-next|more-stories|outbrain|taboola|sponsor|partner-content|embed-|video-player|caption-text-only/i.test(blob)) {";
const NEW =
  "if (/\\bad-\\b|\\bad_\\b|\\badvertisement\\b|\\badvertising\\b|\\badslot\\b|\\bad-container\\b|newsletter|signup|paywall|related-posts|recommended|sidebar|comment|social-share|share-bar|promo|subscription|most-popular|trending|footer|nav-|breadcrumb|byline-share|author-bio|tags-list|tag-list|read-next|more-stories|outbrain|taboola|sponsor|partner-content|embed-|video-player|caption-text-only/i.test(blob)) {";

const OLD_WALKER = "var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {";
const NEW_WALKER =
  "var rootDoc = el.ownerDocument || document;\n    var walker = rootDoc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {";
const OLD_CLOSEST =
  "el.closest(\"aside, nav, footer, header, [role='complementary'], [aria-label*='advertisement' i], [data-ad], [class*='ad-'], [class*='advert'], [id*='ad-']\")";
const NEW_CLOSEST =
  "el.closest(\"aside, nav, footer, header, [role='complementary'], [aria-label*='advertisement' i], [data-ad], [class*=' ad-'], [class^='ad-'], [id^='ad-']\")";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walk(p, out);
    } else if (name === "get-article.js") out.push(p);
  }
  return out;
}

const files = [
  join(ROOT, "scripts/templates/generic-get-article.js.tpl"),
  ...walk(ROOT),
];
let changed = 0;

for (const file of files) {
  let src = readFileSync(file, "utf8");
  let next = src.replace(OLD, NEW);
  if (!next.includes("var rootDoc = el.ownerDocument") && next.includes(OLD_WALKER)) {
    next = next.replace(OLD_WALKER, NEW_WALKER);
  }
  if (next.includes(OLD_CLOSEST)) {
    next = next.replaceAll(OLD_CLOSEST, NEW_CLOSEST);
  }
  if (next !== src) {
    writeFileSync(file, next);
    changed++;
  }
}

console.log(`Updated ${changed} files`);
