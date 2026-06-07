/* @meta
{
  "name": "utilitydive/get-article",
  "description": "Read Utility Dive article title, author, date, and body. Parses JSON-LD metadata and .article-body; dismisses newsletter prestitial on an open tab before extraction.",
  "domain": "www.utilitydive.com",
  "args": {
    "url": { "required": true, "description": "Utility Dive article URL (www.utilitydive.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site utilitydive/get-article https://www.utilitydive.com/news/alex-fitzsimmons-energy-markets-ai-renewables/822095/"
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

  function isUtilityDiveHostname(hostname) {
    return (
      hostname === "utilitydive.com" ||
      hostname === "www.utilitydive.com" ||
      hostname.endsWith(".utilitydive.com")
    );
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isUtilityDiveHostname(ua.hostname) || !isUtilityDiveHostname(ub.hostname)) return false;
      return ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch (e) {
      return false;
    }
  }

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
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
    if (/^Listen to the article$/i.test(t)) return true;
    if (/^This audio is auto-generated/i.test(t)) return true;
    if (/^\(\d+ min\)$/i.test(t)) return true;
    if (/^\d+ min$/i.test(t)) return true;
    if (/^Share this article$/i.test(t)) return true;
    if (/^Recommended Reading$/i.test(t)) return true;
    if (/^Editors' picks$/i.test(t)) return true;
    if (/^Most Popular$/i.test(t)) return true;
    if (/^Company Announcements$/i.test(t)) return true;
    if (/^Library resources$/i.test(t)) return true;
    if (/^What We're Reading$/i.test(t)) return true;
    if (/^Get the free newsletter$/i.test(t)) return true;
    if (/^Get Utility Dive in your inbox$/i.test(t)) return true;
    if (/^Utility Dive news delivered to your inbox$/i.test(t)) return true;
    if (/^Don't miss tomorrow's/i.test(t)) return true;
    if (/^CONTINUE TO SITE/i.test(t)) return true;
    if (/^Filed Under:/i.test(t)) return true;
    if (/^License this article$/i.test(t)) return true;
    if (/^Set preferred source$/i.test(t)) return true;
    if (/^By signing up to receive our newsletter/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^A valid email address is required/i.test(t)) return true;
    if (/^Please select at least one newsletter/i.test(t)) return true;
    if (/^In partnership with$/i.test(t)) return true;
    if (/^Informa Tech Target/i.test(t)) return true;
    if (/^Explore our brands$/i.test(t)) return true;
    if (/^offsite link$/i.test(t)) return true;
    if (/^View all$/i.test(t)) return true;
    if (/^Post a press release$/i.test(t)) return true;
    if (/^Promote an event$/i.test(t)) return true;
    if (/^You're all set$/i.test(t)) return true;
    if (/^Thanks for signing up!/i.test(t)) return true;
    if (/^Daily Dive M-F$/i.test(t)) return true;
    if (/^Storage Weekly/i.test(t) && t.length < 80) return true;
    if (/^Load Management Weekly/i.test(t) && t.length < 80) return true;
    if (/^Renewable Energy Weekly/i.test(t) && t.length < 80) return true;
    if (/^Select Newsletter:/i.test(t)) return true;
    if (/^Select user consent:/i.test(t)) return true;
    if (/^Email:$/i.test(t)) return true;
    if (/^Sign up$/i.test(t)) return true;
    if (/^Print this page$/i.test(t)) return true;
    if (/^Copy link$/i.test(t)) return true;
    if (/^Email this page$/i.test(t)) return true;
    if (/^Post to LinkedIn$/i.test(t)) return true;
    if (/^Post on X/i.test(t)) return true;
    if (/^Share on Facebook$/i.test(t)) return true;
    if (/^Add us on Google$/i.test(t)) return true;
    if (/^purchase licensing rights$/i.test(t)) return true;
    if (/^Image attribution tooltip$/i.test(t)) return true;
    if (/^Meris Lutz\/Utility Dive$/i.test(t) && t.length < 40) return true;
    if (/^Bryan Steffy\/People's Action via Getty Images$/i.test(t) && t.length < 80) return true;
    if (/^Getty Images$/i.test(t)) return true;
    if (/^Mario Tama via Getty Images$/i.test(t)) return true;
    if (/^Provided by /i.test(t) && t.length < 120) return true;
    if (/^Supported by /i.test(t) && t.length < 120) return true;
    if (/^Custom content for /i.test(t) && t.length < 120) return true;
    if (/^Webinar - on demand/i.test(t) && t.length < 160) return true;
    if (/^From [A-Z]/i.test(t) && /(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4}/.test(t) && t.length < 220) return true;
    return false;
  }

  function sanitizeParagraphText(text) {
    var cleaned = stripHtml(text);
    if (!cleaned || isBoilerplateParagraph(cleaned)) return "";
    cleaned = cleaned.replace(/\s+:/g, ":").replace(/\s+([,.;!?])/g, "$1");
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

  function shouldSkipNode(el) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG" || tag === "IFRAME") {
      return true;
    }
    var id = el.id ? String(el.id) : "";
    var cls = el.className ? String(el.className) : "";
    if (/^dfp-|dfp-hybrid|hybrid-ad|text-to-speech|reading-list|post-article-wrapper|signup-inter|prestitial|paychek|site-menu|newsletter|editor-pick|most-popular|company-announcement|library-resource|sidebar|footer|site-footer|hybrid-ad-wrapper|hybrid-ad-inner-wrapper/i.test(id + " " + cls)) {
      return true;
    }
    if (el.closest && el.closest("#prestitial-outer, #signup-inter, .reading-list, .post-article-wrapper, .hybrid-ad-wrapper, .text-to-speech")) {
      return true;
    }
    return false;
  }

  function extractElementText(el) {
    if (!el || shouldSkipNode(el)) return "";
    var skipTags = { STYLE: 1, SCRIPT: 1, NOSCRIPT: 1, SVG: 1, IFRAME: 1, FIGURE: 1 };
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        while (parent && parent !== el) {
          if (skipTags[parent.tagName]) return NodeFilter.FILTER_REJECT;
          if (shouldSkipNode(parent)) return NodeFilter.FILTER_REJECT;
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

  function extractListItems(listEl, ordered) {
    if (!listEl) return [];
    var items = listEl.querySelectorAll(":scope > li");
    var lines = [];
    for (var i = 0; i < items.length; i++) {
      var text = extractElementText(items[i]);
      if (!text) continue;
      lines.push(ordered ? String(i + 1) + ". " + text : "- " + text);
    }
    return lines;
  }

  function extractDomBody(root) {
    if (!root) return "";
    var content = root.querySelector(".article-body");
    if (!content) content = root.querySelector(".article-wrapper .article-body");
    if (!content) return "";

    var blocks = [];
    var children = content.children || [];
    for (var i = 0; i < children.length; i++) {
      var el = children[i];
      if (shouldSkipNode(el)) continue;
      var tag = el.tagName;
      if (tag === "P" || /^H[1-6]$/.test(tag)) {
        var text = extractElementText(el);
        if (text) blocks.push(text);
      } else if (tag === "UL") {
        var ulLines = extractListItems(el, false);
        if (ulLines.length) blocks.push(ulLines.join("\n\n"));
      } else if (tag === "OL") {
        var olLines = extractListItems(el, true);
        if (olLines.length) blocks.push(olLines.join("\n\n"));
      } else if (tag === "BLOCKQUOTE") {
        var quote = extractElementText(el);
        if (quote) blocks.push(quote);
      } else if (tag === "DIV" || tag === "SECTION") {
        if (/hybrid-ad|text-to-speech|dfp-/i.test(String(el.className || "") + " " + String(el.id || ""))) continue;
        var nested = extractDomBody(el);
        if (nested) blocks.push(nested);
      }
    }

    return sanitizeArticleBody(blocks.join("\n\n"));
  }

  function extractTitle(root) {
    if (!root) return "";
    var h1 = root.querySelector(".article-title-wrapper h1, .article-title-wrapper .display-heading-04");
    if (!h1) h1 = root.querySelector('meta[property="og:title"]');
    if (!h1) return "";
    if (h1.tagName === "META") return (h1.getAttribute("content") || "").trim();
    return normalizeWhitespace(h1.textContent);
  }

  function extractAuthor(root) {
    if (!root) return "";
    var el = root.querySelector('.article-byline a[rel="author"], .author a[rel="author"]');
    if (!el) el = root.querySelector('.article-byline .author-name a, .author-row a.analytics.t-article-byline-author');
    if (!el) {
      var meta = root.querySelector('meta[name="sailthru.author"]');
      if (meta) return (meta.getAttribute("content") || "").trim();
    }
    return el ? normalizeWhitespace(el.textContent) : "";
  }

  function extractPublishedAt(root) {
    if (!root) return "";
    var meta = root.querySelector('meta[name="sailthru.date"], meta[property="article:published_time"]');
    if (meta) return (meta.getAttribute("content") || "").trim();
    var timeEl = root.querySelector("time[datetime]");
    if (timeEl) return (timeEl.getAttribute("datetime") || "").trim();
    var pub = root.querySelector(".published-info");
    if (pub) {
      var text = normalizeWhitespace(pub.textContent).replace(/^Published\s+/i, "");
      if (text) return text;
    }
    var dateMeta = root.querySelector('meta[name="date"]');
    if (dateMeta) return (dateMeta.getAttribute("content") || "").trim();
    return "";
  }

  function extractDescription(root) {
    if (!root) return "";
    var deck = root.querySelector(".article-title-wrapper > p");
    if (deck) return normalizeWhitespace(deck.textContent);
    var ogd = root.querySelector('meta[property="og:description"], meta[name="description"]');
    if (ogd) return (ogd.getAttribute("content") || "").trim();
    return "";
  }

  function extractArticleType(root) {
    if (!root) return "";
    var label = root.querySelector(".post-label-wrapper .post-label, .article-title-wrapper .post-label");
    return label ? normalizeWhitespace(label.textContent) : "";
  }

  function pushTag(tags, name) {
    name = normalizeWhitespace(name);
    if (!name || /^type newspost$/i.test(name)) return;
    var key = name.toLowerCase();
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].toLowerCase() === key) return;
    }
    tags.push(name);
  }

  function extractTags(root) {
    if (!root) return [];
    var tags = [];
    var sail = root.querySelector('meta[name="sailthru.tags"]');
    if (sail) {
      var raw = (sail.getAttribute("content") || "").split(",");
      for (var i = 0; i < raw.length; i++) {
        var part = raw[i].trim();
        if (!part) continue;
        var cleaned = part.replace(/^utility-tag-/, "").replace(/^utility-/, "").replace(/-/g, " ");
        pushTag(tags, cleaned);
      }
    }
    var filed = root.body ? root.body.textContent.match(/Filed Under:\s*([^\n]+)/) : null;
    if (filed) {
      var parts = filed[1].split(",");
      for (var j = 0; j < parts.length; j++) {
        pushTag(tags, parts[j]);
      }
    }
    return tags;
  }

  function applyJsonLdMetadata(items, state) {
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

      if ((!state.tags || !state.tags.length) && item.keywords) {
        var kw = Array.isArray(item.keywords) ? item.keywords : String(item.keywords).split(/\s*,\s*/);
        state.tags = kw.filter(Boolean).map(String);
      }

      if (!state.articleBody && item.articleBody) {
        state.articleBody = sanitizeArticleBody(String(item.articleBody));
        state.source = "jsonLd";
      }
    }
  }

  function applyMetaTags(doc, state) {
    if (!state.title) {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og) state.title = (og.getAttribute("content") || "").trim();
    }
    if (!state.description) {
      var ogd = doc.querySelector('meta[property="og:description"], meta[name="description"]');
      if (ogd) state.description = (ogd.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var pubMeta = doc.querySelector('meta[name="sailthru.date"], meta[property="article:published_time"], meta[name="date"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.author) {
      var authorMeta = doc.querySelector('meta[name="sailthru.author"]');
      if (authorMeta) state.author = (authorMeta.getAttribute("content") || "").trim();
    }
  }

  function dismissPaywallAndAds(root) {
    if (!root) root = document;

    var links = root.querySelectorAll("a, button, div, span");
    for (var i = 0; i < links.length; i++) {
      var text = normalizeWhitespace(links[i].textContent);
      if (/^CONTINUE TO SITE/i.test(text)) {
        try {
          links[i].click();
        } catch (e) {}
        break;
      }
    }

    if (typeof window.$ !== "undefined" && window.$.modal && typeof window.$.modal.close === "function") {
      try {
        window.$.modal.close();
      } catch (e) {}
    }

    var hideSelectors = ["#prestitial-outer", "#signup-inter", ".prestitial", ".content-overlay", ".modal_dialog"];
    for (var j = 0; j < hideSelectors.length; j++) {
      var nodes = root.querySelectorAll(hideSelectors[j]);
      for (var k = 0; k < nodes.length; k++) {
        nodes[k].style.display = "none";
        nodes[k].setAttribute("aria-hidden", "true");
      }
    }
  }

  function isPaywallPreview(text) {
    if (!text) return true;
    if (/Don't miss tomorrow's electric utility industry news/i.test(text)) return true;
    if (/Let Utility Dive's free newsletter keep you informed/i.test(text) && text.length < 900) return true;
    if (/^CONTINUE TO SITE/i.test(text)) return true;
    if (/By signing up to receive our newsletter, you agree to our/i.test(text) && text.length < 1200) return true;
    return false;
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      dismissPaywallAndAds(document);
      var domBody = extractDomBody(document);
      var title = extractTitle(document);
      if (domBody || title) {
        return {
          title: title,
          author: extractAuthor(document),
          publishedAt: extractPublishedAt(document),
          description: extractDescription(document),
          articleType: extractArticleType(document),
          tags: extractTags(document),
          domBody: domBody,
        };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    dismissPaywallAndAds(document);
    return {
      title: extractTitle(document),
      author: extractAuthor(document),
      publishedAt: extractPublishedAt(document),
      description: extractDescription(document),
      articleType: extractArticleType(document),
      tags: extractTags(document),
      domBody: extractDomBody(document),
    };
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

  if (!isUtilityDiveHostname(hostname)) {
    return {
      error: "Not a Utility Dive URL",
      hint: "Use an article link from www.utilitydive.com.",
      action: "bun-browser open https://www.utilitydive.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    articleType: "",
    tags: [],
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 12, 400);
    if (openResult) {
      if (openResult.title) state.title = openResult.title;
      if (openResult.author) state.author = openResult.author;
      if (openResult.publishedAt) state.publishedAt = openResult.publishedAt;
      if (openResult.description) state.description = openResult.description;
      if (openResult.articleType) state.articleType = openResult.articleType;
      if (openResult.tags && openResult.tags.length) state.tags = openResult.tags;
      if (openResult.domBody) {
        maybeSetBody(state, openResult.domBody, "openPage");
        state.finalUrl = location.href || raw;
      }
    }
  }

  if (!state.articleBody || !state.title) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open utilitydive.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");

    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      try {
        var j = JSON.parse(scripts[s].textContent || "{}");
        applyJsonLdMetadata(flattenLd(j), state);
      } catch (e) {}
    }

    applyMetaTags(doc, state);

    if (!state.title) state.title = extractTitle(doc);
    if (!state.author) state.author = extractAuthor(doc);
    if (!state.publishedAt) state.publishedAt = extractPublishedAt(doc);
    if (!state.description) state.description = extractDescription(doc);
    if (!state.articleType) state.articleType = extractArticleType(doc);
    if (!state.tags || !state.tags.length) state.tags = extractTags(doc);

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract article body",
      hint: "Utility Dive newsletter prestitial may be blocking content. Open the article in Chrome, click CONTINUE TO SITE if shown, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody)) {
    return {
      error: "Only newsletter/paywall content available",
      hint: "Dismiss the full-screen signup overlay (CONTINUE TO SITE), then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      author: state.author || null,
      publishedAt: state.publishedAt || null,
      preview: state.articleBody.slice(0, 500),
    };
  }

  return {
    url: state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    articleType: state.articleType || null,
    tags: state.tags && state.tags.length ? state.tags : null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
