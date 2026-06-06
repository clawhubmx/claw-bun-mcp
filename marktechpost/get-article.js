/* @meta
{
  "name": "marktechpost/get-article",
  "description": "Read MarkTechPost article title, author, date, categories, and body. Parses Yoast JSON-LD metadata and WordPress Newspaper theme content (.td-post-content).",
  "domain": "www.marktechpost.com",
  "args": {
    "url": { "required": true, "description": "MarkTechPost article URL (www.marktechpost.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site marktechpost/get-article https://www.marktechpost.com/2026/06/06/nvidia-releases-nemotron-3-5-asr-a-600m-parameter-cache-aware-streaming-model-transcribing-40-language-locales-in-real-time/"
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

  function isMarktechpostHostname(hostname) {
    return (
      hostname === "marktechpost.com" ||
      hostname === "www.marktechpost.com" ||
      hostname.endsWith(".marktechpost.com")
    );
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isMarktechpostHostname(ua.hostname) || !isMarktechpostHostname(ub.hostname)) return false;
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
    if (t.length < 15) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Share on /i.test(t)) return true;
    if (/^RELATED ARTICLES/i.test(t)) return true;
    if (/^Previous article$/i.test(t)) return true;
    if (/^Next article$/i.test(t)) return true;
    if (/^Newsletter$/i.test(t)) return true;
    if (/^Partner with Us$/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Subscribe to /i.test(t) && t.length < 320) return true;
    if (/^Copyright Reserved/i.test(t)) return true;
    if (/^Privacy & TC$/i.test(t)) return true;
    if (/^Cookie Policy$/i.test(t)) return true;
    if (/affiliate commission/i.test(t) && t.length < 420) return true;
    if (/^Discord Linkedin Reddit X$/i.test(t)) return true;
    if (/^Explore on GitHub/i.test(t)) return true;
    if (/^Read our exclusive articles$/i.test(t)) return true;
    if (/^Premium Content$/i.test(t)) return true;
    if (/^Search$/i.test(t)) return true;
    if (/^Home$/i.test(t) && t.length < 10) return true;
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
    if (/ai-viewports|ai-insert|code-block|adsbygoogle|beehiiv|wp-block-embed/i.test(cls)) return true;
    if (el.getAttribute && el.getAttribute("data-insertion-position")) return true;
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
    var content =
      root.querySelector(".td-post-content") ||
      root.querySelector(".entry-content") ||
      root.querySelector("article .td-post-content");
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
        if (ulLines.length) blocks.push(ulLines.join("\n"));
      } else if (tag === "OL") {
        var olLines = extractListItems(el, true);
        if (olLines.length) blocks.push(olLines.join("\n"));
      } else if (tag === "BLOCKQUOTE") {
        var quote = extractElementText(el);
        if (quote) blocks.push(quote);
      } else if (tag === "PRE") {
        var code = normalizeWhitespace(el.textContent);
        if (code) blocks.push(code);
      } else if (tag === "DIV" || tag === "SECTION") {
        var nested = extractDomBody(el);
        if (nested) blocks.push(nested);
      }
    }

    return sanitizeArticleBody(blocks.join("\n\n"));
  }

  function extractCategories(root) {
    if (!root) return [];
    var links = root.querySelectorAll(".td-post-header ul.td-category a, .td-category a.entry-category");
    if (!links.length) links = root.querySelectorAll("ul.td-category a");
    var cats = [];
    for (var i = 0; i < links.length; i++) {
      var name = normalizeWhitespace(links[i].textContent);
      if (name && cats.indexOf(name) < 0) cats.push(name);
    }
    return cats;
  }

  function extractAuthorName(root) {
    if (!root) return "";
    var el = root.querySelector(".td-post-header .td-post-author-name a");
    if (!el) el = root.querySelector(".td-post-author-name a");
    return el ? normalizeWhitespace(el.textContent) : "";
  }

  function extractPublishedAt(root) {
    if (!root) return "";
    var timeEl = root.querySelector(".td-post-header time.entry-date[datetime]");
    if (!timeEl) timeEl = root.querySelector("time.entry-date[datetime]");
    return timeEl ? (timeEl.getAttribute("datetime") || "").trim() : "";
  }

  function extractTitle(root) {
    if (!root) return "";
    var h1 = root.querySelector(".td-post-header h1.entry-title");
    if (!h1) h1 = root.querySelector("h1.entry-title");
    return h1 ? normalizeWhitespace(h1.textContent) : "";
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

      if (!state.articleBody && item.articleBody) {
        state.articleBody = sanitizeArticleBody(String(item.articleBody));
        state.source = "jsonLd";
      }
    }
  }

  function applyMetaTags(doc, state) {
    if (!state.title) {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og) state.title = (og.getAttribute("content") || "").replace(/\s*-\s*MarkTechPost\s*$/i, "").trim();
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
      var authorMeta = doc.querySelector('meta[name="author"]');
      if (authorMeta) state.author = (authorMeta.getAttribute("content") || "").trim();
    }
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      var domBody = extractDomBody(document);
      var title = extractTitle(document);
      if (domBody || title) {
        return {
          title: title,
          author: extractAuthorName(document),
          publishedAt: extractPublishedAt(document),
          categories: extractCategories(document),
          domBody: domBody,
        };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return {
      title: extractTitle(document),
      author: extractAuthorName(document),
      publishedAt: extractPublishedAt(document),
      categories: extractCategories(document),
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

  if (!isMarktechpostHostname(hostname)) {
    return {
      error: "Not a MarkTechPost URL",
      hint: "Use an article link from www.marktechpost.com.",
      action: "bun-browser open https://www.marktechpost.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    categories: [],
    wordCount: null,
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 8, 250);
    if (openResult) {
      if (openResult.title) state.title = openResult.title;
      if (openResult.author) state.author = openResult.author;
      if (openResult.publishedAt) state.publishedAt = openResult.publishedAt;
      if (openResult.categories && openResult.categories.length) state.categories = openResult.categories;
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
        hint: "Article may be unavailable. Open marktechpost.com in Chrome first, then retry.",
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
    if (!state.author) state.author = extractAuthorName(doc);
    if (!state.publishedAt) state.publishedAt = extractPublishedAt(doc);
    if (!state.categories || !state.categories.length) state.categories = extractCategories(doc);

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract article body",
      hint: "Page HTML did not contain .td-post-content. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  return {
    url: state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    categories: state.categories && state.categories.length ? state.categories : null,
    wordCount: state.wordCount,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
