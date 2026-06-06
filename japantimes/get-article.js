/* @meta
{
  "name": "japantimes/get-article",
  "description": "Read Japan Times article title, date, and body. Bypasses Piano paywall via /ajax/getArticleContent/ using the Piano jt_pn token; falls back to live DOM on an open article tab.",
  "domain": "www.japantimes.co.jp",
  "args": {
    "url": { "required": true, "description": "Japan Times article URL (www.japantimes.co.jp)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site japantimes/get-article https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/"
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

  function isJapanTimesHostname(hostname) {
    return (
      hostname === "japantimes.co.jp" ||
      hostname === "www.japantimes.co.jp" ||
      hostname.endsWith(".japantimes.co.jp")
    );
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isJapanTimesHostname(ua.hostname) || !isJapanTimesHostname(ub.hostname)) return false;
      return ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch (e) {
      return false;
    }
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
    if (/^Listen to this article$/i.test(t)) return true;
    if (/^\(\d+ min\)$/i.test(t)) return true;
    if (/^In a time of both misinformation and too much information/i.test(t)) return true;
    if (/quality journalism is more crucial than ever/i.test(t) && /subscrib/i.test(t)) return true;
    if (/^SUBSCRIBE NOW$/i.test(t)) return true;
    if (/^By subscribing, you can help us get the story right/i.test(t)) return true;
    if (/^Your subscription plan doesn't allow commenting/i.test(t)) return true;
    if (/^With your current subscription plan you can comment/i.test(t)) return true;
    return false;
  }

  function sanitizeParagraphText(text) {
    var cleaned = stripHtml(text);
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

  function isPaywallPreview(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/In a time of both misinformation and too much information/i.test(t) && t.length < 900) return true;
    if (/By subscribing, you can help us get the story right/i.test(t) && t.length < 900) return true;
    if (/^SUBSCRIBE NOW$/i.test(t)) return true;
    return false;
  }

  function extractElementText(el) {
    if (!el) return "";
    var skipTags = { STYLE: 1, SCRIPT: 1, NOSCRIPT: 1, SVG: 1 };
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        while (parent && parent !== el) {
          if (skipTags[parent.tagName]) return NodeFilter.FILTER_REJECT;
          parent = parent.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var parts = [];
    while (walker.nextNode()) {
      var chunk = normalizeWhitespace(walker.currentNode.textContent);
      if (chunk) parts.push(chunk);
    }
    return sanitizeParagraphText(parts.join(" "));
  }

  function extractDomBody(root) {
    if (!root) return "";
    var els = root.querySelectorAll(".article-body p, .jt-article-details .article-body p, #jtarticle .article-body p");
    var paragraphs = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 30) continue;
      if (isBoilerplateParagraph(text)) continue;
      paragraphs.push(text);
    }
    return sanitizeArticleBody(paragraphs.join("\n\n"));
  }

  function extractBodyFromArticleHtml(html) {
    if (!html) return "";
    var doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    var root = doc.querySelector(".article-body") || doc.body;
    return extractDomBody(root);
  }

  function parseCmsIdsFromDocument(doc) {
    if (!doc) return { cmsArticleId: "", isOldArticle: "0" };
    var cmsEl = doc.querySelector("#cms_article_id");
    var oldEl = doc.querySelector("#is_old_article");
    var cmsArticleId = cmsEl ? String(cmsEl.getAttribute("value") || cmsEl.value || "").trim() : "";
    if (!cmsArticleId) {
      var info = doc.querySelector("#article_info[data-cms_article_id]");
      if (info) cmsArticleId = String(info.getAttribute("data-cms_article_id") || "").trim();
    }
    if (!cmsArticleId) {
      var scripts = doc.querySelectorAll("script");
      for (var i = 0; i < scripts.length; i++) {
        var m = (scripts[i].textContent || "").match(/cms_article_id["']?\s*:\s*(\d+)/);
        if (m) {
          cmsArticleId = m[1];
          break;
        }
      }
    }
    var isOldArticle = oldEl ? String(oldEl.getAttribute("value") || oldEl.value || "0").trim() : "0";
    return { cmsArticleId: cmsArticleId, isOldArticle: isOldArticle || "0" };
  }

  function getPianoPn() {
    try {
      if (window.tp && window.tp.customVariables && window.tp.customVariables.jt_pn) {
        return String(window.tp.customVariables.jt_pn);
      }
    } catch (e) {}
    try {
      var stored = sessionStorage.getItem("_pc_jt_pn");
      if (stored) return String(stored);
    } catch (e2) {}
    return "";
  }

  function getPianoStatus() {
    try {
      var stored = sessionStorage.getItem("jt_subscriber_status");
      if (stored) return String(stored);
    } catch (e) {}
    return "None";
  }

  function encodeArticleContentPayload(pn, cmsArticleId, pianoStatus) {
    var data = [pn, String(cmsArticleId), pianoStatus || "None"].join(":");
    return btoa(btoa(data));
  }

  async function waitForPianoPn(attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      var pn = getPianoPn();
      if (pn) return pn;
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return getPianoPn();
  }

  async function fetchArticleContent(cmsArticleId, isOldArticle, pn, pianoStatus) {
    if (!pn || !cmsArticleId) return null;
    var encoded = encodeArticleContentPayload(pn, cmsArticleId, pianoStatus);
    var url =
      "/ajax/getArticleContent/?data=" +
      encodeURIComponent(encoded) +
      "&is_old_article=" +
      encodeURIComponent(String(isOldArticle || "0")) +
      "&v=" +
      Date.now();
    var resp = await fetch(url, { credentials: "include", redirect: "follow" });
    if (!resp.ok) return { error: "HTTP " + resp.status };
    try {
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  function applyJsonLdMetadata(item, state) {
    if (!item || typeof item !== "object") return;
    if (!state.title && item.headline) state.title = String(item.headline);
    if (!state.publishedAt && item.datePublished) state.publishedAt = String(item.datePublished);
    if (!state.dateModified && item.dateModified) state.dateModified = String(item.dateModified);
    if (!state.description && item.description) state.description = String(item.description);
    if (!state.section && item.articleSection) state.section = String(item.articleSection);
    if (!state.tags || !state.tags.length) {
      if (item.keywords) {
        state.tags = String(item.keywords)
          .split(",")
          .map(function (t) {
            return t.trim();
          })
          .filter(Boolean);
      }
    }
    if (!state.author && item.author) {
      var auth = item.author;
      if (typeof auth === "string") state.author = auth;
      else if (auth && auth.name) state.author = String(auth.name);
    }
    if (!state.articleBody && item.articleBody) {
      state.articleBody = sanitizeArticleBody(String(item.articleBody));
      if (state.articleBody) state.source = "jsonLd";
    }
  }

  function applyHtmlMetadata(doc, state) {
    if (!doc) return;
    if (!state.title) {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og) state.title = (og.getAttribute("content") || "").trim();
    }
    if (!state.title) {
      var h1 = doc.querySelector("h1");
      if (h1) state.title = normalizeWhitespace(h1.textContent);
    }
    if (!state.description) {
      var ogd = doc.querySelector('meta[property="og:description"]');
      if (ogd) state.description = (ogd.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var pubMeta = doc.querySelector('meta[property="article:published_time"], meta[itemprop="datePublished"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var timeEl = doc.querySelector("time[datetime]");
      if (timeEl) state.publishedAt = (timeEl.getAttribute("datetime") || "").trim();
    }
    if (!state.section) {
      var sectionEl = doc.querySelector(".article-section a, .jt-article-details .article-section a");
      if (sectionEl) state.section = normalizeWhitespace(sectionEl.textContent);
    }
    if (!state.author) {
      var authorMeta = doc.querySelector('meta[itemprop="author"], meta[name="author"]');
      if (authorMeta) state.author = (authorMeta.getAttribute("content") || "").trim();
    }
    if (!state.canonicalUrl) {
      var canonical = doc.querySelector('link[rel="canonical"]');
      if (canonical) state.canonicalUrl = (canonical.getAttribute("href") || "").trim();
    }
  }

  function isCloudflareChallenge(doc) {
    if (!doc) return false;
    var title = (doc.querySelector("title")?.textContent || "").trim();
    if (/just a moment/i.test(title)) return true;
    if (doc.body && /Enable JavaScript and cookies to continue/i.test(doc.body.textContent || "")) return true;
    return false;
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      var domBody = extractDomBody(document);
      var pn = getPianoPn();
      if (domBody.length > 700 || pn) {
        return { domBody: domBody, pn: pn };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return { domBody: extractDomBody(document), pn: getPianoPn() };
  }

  function maybeSetBody(state, body, source) {
    body = sanitizeArticleBody(body);
    if (!body || isPaywallPreview(body)) return;
    if (body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      state.source = source;
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

  if (!isJapanTimesHostname(hostname)) {
    return {
      error: "Not a Japan Times URL",
      hint: "Use an article link from www.japantimes.co.jp.",
      action: "bun-browser open https://www.japantimes.co.jp",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    section: "",
    tags: [],
    canonicalUrl: "",
    cmsArticleId: "",
    isOldArticle: "0",
    articleBody: "",
    source: "",
    finalUrl: raw,
    displayFullText: null,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openIds = parseCmsIdsFromDocument(document);
    if (openIds.cmsArticleId) state.cmsArticleId = openIds.cmsArticleId;
    if (openIds.isOldArticle) state.isOldArticle = openIds.isOldArticle;

    var openResult = await waitForOpenPageArticle(raw, 48, 250);
    if (openResult && openResult.domBody) {
      maybeSetBody(state, openResult.domBody, "dom");
      state.finalUrl = location.href || raw;
    }
  }

  var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
  if (!resp.ok) {
    return {
      error: "HTTP " + resp.status,
      hint: "Article may be unavailable. Open japantimes.co.jp in Chrome first, then retry.",
      action: "bun-browser open " + raw,
    };
  }

  state.finalUrl = resp.url || raw;
  var html = await resp.text();
  var doc = new DOMParser().parseFromString(html, "text/html");

  if (isCloudflareChallenge(doc)) {
    return {
      error: "Cloudflare challenge blocked fetch",
      hint: "Open the article in Chrome, wait for the page to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
    };
  }

  var cmsIds = parseCmsIdsFromDocument(doc);
  if (cmsIds.cmsArticleId) state.cmsArticleId = cmsIds.cmsArticleId;
  if (cmsIds.isOldArticle) state.isOldArticle = cmsIds.isOldArticle;

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
        applyJsonLdMetadata(item, state);
      }
    } catch (e2) {}
  }

  applyHtmlMetadata(doc, state);

  if (!state.articleBody || state.articleBody.length < 700) {
    var fetchedDomBody = extractDomBody(doc);
    if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, state.source || "domPreview");
  }

  var pn = getPianoPn();
  if (!pn && onArticlePage) {
    pn = await waitForPianoPn(48, 250);
  }
  if (!pn) {
    pn = await waitForPianoPn(8, 200);
  }

  if (state.cmsArticleId && pn) {
    var ajaxResult = await fetchArticleContent(state.cmsArticleId, state.isOldArticle, pn, getPianoStatus());
    if (ajaxResult && !ajaxResult.error && ajaxResult.articleBody) {
      var ajaxBody = extractBodyFromArticleHtml(ajaxResult.articleBody);
      if (ajaxBody) {
        maybeSetBody(state, ajaxBody, "ajaxContent");
        state.displayFullText = ajaxResult.displayFullText;
      }
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "Japan Times paywall blocked content or Piano has not finished loading. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
      cmsArticleId: state.cmsArticleId || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody) || state.articleBody.length < 500) {
    return {
      error: "Only paywall preview available",
      hint: "Full article was not unlocked. Open the article in Chrome, wait for Piano to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      preview: state.articleBody.slice(0, 500),
      cmsArticleId: state.cmsArticleId || null,
    };
  }

  var paywallBypassed = state.source === "ajaxContent" || state.source === "dom";
  if (state.displayFullText === 1) paywallBypassed = true;
  if (state.source === "ajaxContent" && state.articleBody.length > 900) paywallBypassed = true;

  return {
    url: state.finalUrl,
    canonicalUrl: state.canonicalUrl || state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    section: state.section || null,
    tags: state.tags && state.tags.length ? state.tags : null,
    cmsArticleId: state.cmsArticleId || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
    displayFullText: state.displayFullText,
    paywallBypassed: paywallBypassed,
  };
}
