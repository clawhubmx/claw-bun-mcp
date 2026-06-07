/* @meta
{
  "name": "gizmodo/get-article",
  "description": "Read Gizmodo article title, author, date, and body. Parses Yoast JSON-LD metadata and WordPress entry-content; falls back to live DOM on an open article tab.",
  "domain": "gizmodo.com",
  "args": {
    "url": { "required": true, "description": "Gizmodo article URL (gizmodo.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site gizmodo/get-article https://gizmodo.com/supposedly-the-unveiling-of-a-hovering-tesla-has-not-been-canceled-just-postponed-until-august-2000768416"
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

  function isGizmodoHostname(hostname) {
    return hostname === "gizmodo.com" || hostname === "www.gizmodo.com" || hostname.endsWith(".gizmodo.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isGizmodoHostname(ua.hostname) || !isGizmodoHostname(ub.hostname)) return false;
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
    if (/^Reading time \d+ minutes?$/i.test(t)) return true;
    if (/^Share this story$/i.test(t)) return true;
    if (/^Explore more on these topics$/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Subscribe and interact with our community/i.test(t)) return true;
    if (/^Leave this field empty if you're human/i.test(t)) return true;
    if (/^Skip to content$/i.test(t)) return true;
    if (/^Comments \(\d+\)$/i.test(t)) return true;
    if (/^Read Later$/i.test(t)) return true;
    if (/^We may earn a commission/i.test(t)) return true;
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

  function shouldSkipNode(el) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG" || tag === "IFRAME") {
      return true;
    }
    var cls = el.className ? String(el.className) : "";
    if (/od-wrapper|od-background|optidigital-adslot|cnx-player|not-prose/i.test(cls)) return true;
    if (el.id && /cnx-player/i.test(String(el.id))) return true;
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
    var content = root.querySelector(".entry-content");
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
        var nested = extractDomBody(el);
        if (nested) blocks.push(nested);
      }
    }

    return sanitizeArticleBody(blocks.join("\n\n"));
  }

  function extractTitle(root) {
    if (!root) return "";
    var h1 = root.querySelector("main h1, article h1, h1");
    return h1 ? normalizeWhitespace(h1.textContent) : "";
  }

  function extractAuthor(root) {
    if (!root) return "";
    var el = root.querySelector('a[rel="author"]');
    if (!el) el = root.querySelector('meta[name="author"]');
    if (!el) return "";
    if (el.tagName === "META") return (el.getAttribute("content") || "").trim();
    return normalizeWhitespace(el.textContent);
  }

  function extractPublishedAt(root) {
    if (!root) return "";
    var timeEl = root.querySelector("time[datetime]");
    return timeEl ? (timeEl.getAttribute("datetime") || "").trim() : "";
  }

  function extractDescription(root) {
    if (!root) return "";
    var excerpt = root.querySelector(".post-excerpt");
    if (excerpt) return normalizeWhitespace(excerpt.textContent);
    var ogd = root.querySelector('meta[property="og:description"]');
    if (ogd) return (ogd.getAttribute("content") || "").trim();
    return "";
  }

  function extractSection(root) {
    if (!root) return "";
    var cat = root.querySelector(".giz-cat-main a, .giz-cat-main");
    return cat ? normalizeWhitespace(cat.textContent) : "";
  }

  function extractTags(root) {
    if (!root) return [];
    var links = root.querySelectorAll("#tags-container a, .entry-content ~ div a[href*='/tag/']");
    var tags = [];
    for (var i = 0; i < links.length; i++) {
      var name = normalizeWhitespace(links[i].textContent);
      if (name && tags.indexOf(name) < 0) tags.push(name);
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
      if (!state.wordCount && item.wordCount) state.wordCount = Number(item.wordCount) || null;

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

      if ((!state.categories || !state.categories.length) && item.articleSection) {
        var sections = Array.isArray(item.articleSection) ? item.articleSection : [item.articleSection];
        state.categories = sections.map(String);
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
      var ogd = doc.querySelector('meta[property="og:description"]');
      if (ogd) state.description = (ogd.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var pubMeta = doc.querySelector('meta[property="article:published_time"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.dateModified) {
      var modMeta = doc.querySelector('meta[property="article:modified_time"]');
      if (modMeta) state.dateModified = (modMeta.getAttribute("content") || "").trim();
    }
    if (!state.author) {
      var authorMeta = doc.querySelector('meta[name="author"], meta[property="article:author"]');
      if (authorMeta) state.author = (authorMeta.getAttribute("content") || "").trim();
    }
  }

  function isCloudflareChallenge(doc, html) {
    if (!doc) return false;
    var title = (doc.querySelector("title")?.textContent || "").trim();
    if (/^just a moment/i.test(title)) return true;
    if (/attention required/i.test(title)) return true;
    var bodyText = doc.body ? doc.body.textContent || "" : "";
    if (/Enable JavaScript and cookies to continue/i.test(bodyText)) return true;
    if (/verify you are human/i.test(bodyText)) return true;
    if (/cf-browser-verification/i.test(bodyText)) return true;
    if (/challenge-platform/i.test(String(html || "")) && !doc.querySelector(".entry-content")) return true;
    return false;
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      if (isCloudflareChallenge(document, document.documentElement?.outerHTML || "")) {
        await new Promise(function (resolve) {
          setTimeout(resolve, delayMs);
        });
        continue;
      }
      var domBody = extractDomBody(document);
      var title = extractTitle(document);
      if (domBody || title) {
        return {
          title: title,
          author: extractAuthor(document),
          publishedAt: extractPublishedAt(document),
          description: extractDescription(document),
          section: extractSection(document),
          tags: extractTags(document),
          domBody: domBody,
        };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return {
      title: extractTitle(document),
      author: extractAuthor(document),
      publishedAt: extractPublishedAt(document),
      description: extractDescription(document),
      section: extractSection(document),
      tags: extractTags(document),
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

  if (!args.url) return { error: "Missing argument: url" };

  var raw = String(args.url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  var hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch (e) {
    return { error: "Invalid url" };
  }

  if (!isGizmodoHostname(hostname)) {
    return {
      error: "Not a Gizmodo URL",
      hint: "Use an article link from gizmodo.com.",
      action: "bun-browser open https://gizmodo.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    section: "",
    categories: [],
    tags: [],
    wordCount: null,
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 12, 500);
    if (openResult) {
      if (openResult.title) state.title = openResult.title;
      if (openResult.author) state.author = openResult.author;
      if (openResult.publishedAt) state.publishedAt = openResult.publishedAt;
      if (openResult.description) state.description = openResult.description;
      if (openResult.section) state.section = openResult.section;
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
        hint: "Article may be unavailable. Open gizmodo.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");

    if (isCloudflareChallenge(doc, html)) {
      return {
        error: "Cloudflare challenge blocked fetch",
        hint: "Gizmodo uses Cloudflare. Open the article in Chrome, wait for the page to load, then retry.",
        action: "bun-browser open " + raw,
        title: state.title || null,
      };
    }

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
    if (!state.section) state.section = extractSection(doc);
    if (!state.tags || !state.tags.length) state.tags = extractTags(doc);
    if ((!state.categories || !state.categories.length) && state.section) {
      state.categories = [state.section];
    }

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract article body",
      hint: "Cloudflare may have blocked content. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (!state.section && state.categories && state.categories.length) {
    state.section = state.categories[0];
  }

  return {
    url: state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    section: state.section || null,
    categories: state.categories && state.categories.length ? state.categories : null,
    tags: state.tags && state.tags.length ? state.tags : null,
    wordCount: state.wordCount,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
