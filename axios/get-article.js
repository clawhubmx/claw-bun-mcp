/* @meta
{
  "name": "axios/get-article",
  "description": "Read Axios article title, author, date, and body. Prefers __NEXT_DATA__ (data.story.blocks); falls back to bodyHtml and live DOM.",
  "domain": "www.axios.com",
  "args": {
    "url": { "required": true, "description": "Axios article URL (www.axios.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site axios/get-article https://www.axios.com/2026/06/05/senate-ice-border-patrol-funding-vote"
}
*/

async function (args) {
  function flattenLd(node) {
    if (!node) return [];
    if (Array.isArray(node)) {
      var acc = [];
      for (var i = 0; i < node.length; i++) acc = acc.concat(flattenLd(node[i]));
      return acc;
    }
    if (node["@graph"]) return flattenLd(node["@graph"]);
    return [node];
  }

  function isAxiosHostname(hostname) {
    return hostname === "axios.com" || hostname === "www.axios.com" || hostname.endsWith(".axios.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isAxiosHostname(ua.hostname) || !isAxiosHostname(ub.hostname)) return false;
      return ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch (e) {
      return false;
    }
  }

  function buildFetchUrl(url) {
    try {
      var target = new URL(url);
      if (isAxiosHostname(location.hostname) && isAxiosHostname(target.hostname)) {
        return target.pathname + target.search + target.hash;
      }
    } catch (e) {}
    return url;
  }

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripHtml(html) {
    if (!html) return "";
    var cleaned = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    var doc = new DOMParser().parseFromString("<div>" + cleaned + "</div>", "text/html");
    return normalizeWhitespace(doc.body ? doc.body.textContent : cleaned.replace(/<[^>]+>/g, " "));
  }

  function isBoilerplateParagraph(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Skip to main content$/i.test(t)) return true;
    if (/^Add Axios as your preferred source/i.test(t)) return true;
    if (/^see more of our stories on Google/i.test(t)) return true;
    if (/^Share .+ on (Email|Sms|Facebook|Twitter|Linkedin|Bluesky)/i.test(t)) return true;
    if (/^email \(opens in new window\)$/i.test(t)) return true;
    if (/^sms \(opens in new window\)$/i.test(t)) return true;
    if (/facebook \(opens in new window\)/i.test(t) && t.length < 200) return true;
    if (/^Explore Axios Newsletters$/i.test(t)) return true;
    if (/^Go deeper$/i.test(t)) return true;
    if (/^What to read next$/i.test(t)) return true;
    if (/\. Photo:/i.test(t) && t.length < 220) return true;
    if (/^Photo:/i.test(t) && t.length < 220) return true;
    if (/sign up for .+ newsletter/i.test(t) && t.length < 320) return true;
    if (/^Subscribe to /i.test(t) && t.length < 320) return true;
    if (/^Axios Pro/i.test(t) && t.length < 200) return true;
    return false;
  }

  function sanitizeParagraphText(text) {
    var cleaned = normalizeWhitespace(stripHtml(text));
    if (!cleaned || isBoilerplateParagraph(cleaned)) return "";
    return cleaned;
  }

  function sanitizeArticleBody(body) {
    if (!body) return "";
    var parts = String(body).split(/\n\n+/);
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      var part = sanitizeParagraphText(parts[i]);
      if (!part) continue;
      kept.push(part);
    }
    return kept.join("\n\n");
  }

  function getPageProps(nextData) {
    if (!nextData || !nextData.props) return null;
    return nextData.props.pageProps || null;
  }

  function getPageData(pageProps) {
    if (!pageProps || !pageProps.data) return null;
    return pageProps.data;
  }

  function getStory(pageProps) {
    var data = getPageData(pageProps);
    return data && data.story ? data.story : null;
  }

  function extractAuthors(story) {
    if (!story || !story.authors) return "";
    var names = [];
    var authors = story.authors;
    for (var i = 0; i < authors.length; i++) {
      var a = authors[i];
      if (!a) continue;
      if (typeof a === "string") names.push(a);
      else if (a.display_name) names.push(String(a.display_name));
      else if (a.name) names.push(String(a.name));
    }
    var unique = [];
    for (var j = 0; j < names.length; j++) {
      if (names[j] && unique.indexOf(names[j]) < 0) unique.push(names[j]);
    }
    return unique.join(", ");
  }

  function extractBodyFromBlocks(blocks) {
    if (!blocks || !blocks.length) return "";
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block) continue;
      var type = String(block.type || "").toLowerCase();
      if (type === "keep-reading") continue;
      var text = sanitizeParagraphText(block.text || "");
      if (!text) continue;
      if (type === "unordered-list-item" || type === "ordered-list-item") {
        parts.push("• " + text);
      } else {
        parts.push(text);
      }
    }
    return parts.join("\n\n");
  }

  function extractBodyFromBodyHtml(bodyHtml) {
    if (!bodyHtml || typeof bodyHtml !== "object") return "";
    var before = stripHtml(bodyHtml.beforeKeepReading || "");
    var after = stripHtml(bodyHtml.afterKeepReading || "");
    var combined = "";
    if (before) combined = before;
    if (after) combined = combined ? combined + "\n\n" + after : after;
    return sanitizeArticleBody(combined);
  }

  function isPaywallPreview(state, body) {
    if (!body) return true;
    if (state.hasPaywall === true && state.source === "dom") return true;
    if (/^Subscribe to Axios Pro/i.test(body)) return true;
    if (/^This story is for Axios Pro subscribers/i.test(body)) return true;
    if (/^Sign in to read/i.test(body)) return true;
    if (/^Continue reading/i.test(body) && body.length < 600) return true;
    return false;
  }

  function applyStoryMetadata(story, pageData, state, sourceLabel) {
    if (!story) return;

    if (!state.title && story.headline) state.title = String(story.headline);
    if (!state.publishedAt && story.published_date) state.publishedAt = String(story.published_date);
    if (!state.publishedAt && story.first_published) state.publishedAt = String(story.first_published);
    if (!state.dateModified && story.last_published) state.dateModified = String(story.last_published);
    if (!state.author) state.author = extractAuthors(story);
    if (!state.section && story.sections && story.sections.length) {
      state.section = String(story.sections[0].name || "");
    }
    if (!state.description && story.summary) {
      state.description = stripHtml(story.summary).slice(0, 500);
    }

    if (pageData && typeof pageData.hasPaywall === "boolean") {
      state.hasPaywall = pageData.hasPaywall;
    }

    var blockList = story.blocks && story.blocks.blocks ? story.blocks.blocks : null;
    var blockBody = extractBodyFromBlocks(blockList);
    if (blockBody && blockBody.length > (state.articleBody || "").length) {
      state.articleBody = blockBody;
      state.source = sourceLabel || "nextData";
    }

    var htmlBody = extractBodyFromBodyHtml(story.bodyHtml);
    if (htmlBody && htmlBody.length > (state.articleBody || "").length) {
      state.articleBody = htmlBody;
      state.source = sourceLabel || "nextData";
    }
  }

  function parseNextDataFromDocument(doc) {
    if (!doc) return null;
    var el = doc.getElementById("__NEXT_DATA__");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (e) {
      return null;
    }
  }

  function extractElementText(el) {
    if (!el) return "";
    return sanitizeParagraphText(el.textContent || "");
  }

  function extractDomBody(root) {
    if (!root) return "";
    var main = root.querySelector("main");
    if (!main) main = root;
    var els = main.querySelectorAll("p, li");
    var parts = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 30) continue;
      if (isBoilerplateParagraph(text)) continue;
      if (els[i].tagName === "LI") parts.push("• " + text);
      else parts.push(text);
    }
    return sanitizeArticleBody(parts.join("\n\n"));
  }

  function readNextDataFromOpenPage() {
    if (window.__NEXT_DATA__) return { nextData: window.__NEXT_DATA__, source: "openPage" };
    var parsed = parseNextDataFromDocument(document);
    if (parsed) return { nextData: parsed, source: "openPageHtml" };
    return null;
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      var hit = readNextDataFromOpenPage();
      var domBody = extractDomBody(document);
      if ((hit && hit.nextData) || domBody) {
        return { hit: hit, domBody: domBody };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return {
      hit: readNextDataFromOpenPage(),
      domBody: extractDomBody(document),
    };
  }

  function maybeSetBody(state, body, source) {
    body = sanitizeArticleBody(body);
    if (!body) return;
    if (body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      state.source = source;
    }
  }

  function applyNextData(nextData, state, sourceLabel) {
    var pageProps = getPageProps(nextData);
    var pageData = getPageData(pageProps);
    var story = getStory(pageProps);
    if (story) {
      applyStoryMetadata(story, pageData, state, sourceLabel === "openPage" || sourceLabel === "openPageHtml" ? sourceLabel : "nextData");
    }
  }

  if (!args.url) return { error: "Missing argument: url" };

  var raw = String(args.url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  var hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch (e) {
    return { error: "Invalid url" };
  }

  if (!isAxiosHostname(hostname)) {
    return {
      error: "Not an Axios URL",
      hint: "Use an article link from www.axios.com.",
      action: "bun-browser open https://www.axios.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    section: "",
    articleBody: "",
    source: "",
    finalUrl: raw,
    hasPaywall: null,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 250);
    if (openResult && openResult.hit && openResult.hit.nextData) {
      applyNextData(openResult.hit.nextData, state, openResult.hit.source);
      if (!state.source) state.source = openResult.hit.source;
      state.finalUrl = location.href || raw;
    }
    if (openResult && openResult.domBody && openResult.domBody.length > (state.articleBody || "").length) {
      maybeSetBody(state, openResult.domBody, "dom");
    }
  }

  if (!state.articleBody) {
    var resp = await fetch(buildFetchUrl(raw), { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable or blocked by Cloudflare. Open axios.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();

    if (/Just a moment/i.test(html) && !html.includes("__NEXT_DATA__")) {
      return {
        error: "Cloudflare challenge page",
        hint: "Open the article in Chrome and wait for it to load, then retry.",
        action: "bun-browser open " + raw,
        title: state.title || null,
        publishedAt: state.publishedAt || null,
      };
    }

    var doc = new DOMParser().parseFromString(html, "text/html");
    var nextData = parseNextDataFromDocument(doc);
    if (nextData) {
      applyNextData(nextData, state, "nextData");
    }

    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      try {
        var j = JSON.parse(scripts[s].textContent || "{}");
        var items = flattenLd(j);
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (!item || typeof item !== "object") continue;
          var t = item["@type"];
          var types = Array.isArray(t) ? t : [t];
          var isArticle = false;
          for (var k = 0; k < types.length; k++) {
            if (types[k] === "NewsArticle" || types[k] === "Article") {
              isArticle = true;
              break;
            }
          }
          if (!isArticle) continue;
          if (!state.title && item.headline) state.title = String(item.headline);
          if (!state.publishedAt && item.datePublished) state.publishedAt = String(item.datePublished);
          if (!state.dateModified && item.dateModified) state.dateModified = String(item.dateModified);
          if (!state.description && item.description) state.description = String(item.description);
          if (!state.author && item.author) {
            var auth = item.author;
            if (Array.isArray(auth)) {
              var authNames = [];
              for (var a = 0; a < auth.length; a++) {
                if (typeof auth[a] === "string") authNames.push(auth[a]);
                else if (auth[a] && auth[a].name) authNames.push(String(auth[a].name));
              }
              state.author = authNames.join(", ");
            } else if (typeof auth === "string") state.author = auth;
            else if (auth.name) state.author = String(auth.name);
          }
          if (!state.articleBody && item.articleBody) {
            maybeSetBody(state, String(item.articleBody), "jsonLd");
          }
        }
      } catch (e) {}
    }

    if (!state.title) {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og) state.title = (og.getAttribute("content") || "").trim();
    }
    if (!state.title) {
      var h1 = doc.querySelector("h1");
      if (h1) state.title = (h1.textContent || "").trim();
    }
    if (!state.description) {
      var ogd = doc.querySelector('meta[property="og:description"]');
      if (ogd) state.description = (ogd.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var pubMeta = doc.querySelector('meta[property="article:published_time"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var timeEl = doc.querySelector("time[datetime]");
      if (timeEl) state.publishedAt = (timeEl.getAttribute("datetime") || "").trim();
    }

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      hasPaywall: state.hasPaywall,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state, state.articleBody)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article data was not found. Open axios.com in Chrome (with Axios Pro if needed) and retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      preview: state.articleBody.slice(0, 500),
      hasPaywall: state.hasPaywall,
    };
  }

  var paywallBypassed =
    state.source !== "dom" &&
    state.source !== "jsonLd" &&
    state.hasPaywall !== true;

  if (state.source === "nextData" || state.source === "openPage" || state.source === "openPageHtml") {
    if (state.hasPaywall !== true) paywallBypassed = true;
  }

  return {
    url: state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    section: state.section || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
    paywallBypassed: paywallBypassed,
  };
}
