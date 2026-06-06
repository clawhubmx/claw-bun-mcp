/* @meta
{
  "name": "politico/get-article",
  "description": "Read Politico article title, date, and body. Prefers embedded Nuxt data (__NUXT__.data.article); falls back to __NUXT_DATA__ payload and live DOM paragraphs.",
  "domain": "www.politico.com",
  "args": {
    "url": { "required": true, "description": "Politico article URL (www.politico.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site politico/get-article https://www.politico.com/news/2026/06/05/trump-strategic-petroleum-reserve-california-00952083"
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

  function isPoliticoHostname(hostname) {
    return hostname === "politico.com" || hostname === "www.politico.com" || hostname.endsWith(".politico.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isPoliticoHostname(ua.hostname) || !isPoliticoHostname(ub.hostname)) return false;
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
    var cleaned = String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    var doc = new DOMParser().parseFromString("<div>" + cleaned + "</div>", "text/html");
    return normalizeWhitespace(doc.body ? doc.body.textContent : cleaned.replace(/<[^>]+>/g, " "));
  }

  function isBoilerplateParagraph(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Press Escape to close the menu/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Subscribe to /i.test(t) && t.length < 320) return true;
    if (/^Skip to Main Content$/i.test(t)) return true;
    if (/^By signing up, you agree to /i.test(t)) return true;
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

  function reviveNuxtValue(idx, values, stack) {
    if (!stack) stack = {};
    if (idx === null || idx === undefined) return idx;
    if (typeof idx === "string" || typeof idx === "boolean") return idx;
    if (typeof idx !== "number") return idx;
    if (idx < 0 || idx >= values.length) return idx;
    if (stack[idx]) return null;
    stack[idx] = true;

    var val = values[idx];
    var out;
    if (Array.isArray(val)) {
      if (
        val.length === 2 &&
        typeof val[0] === "string" &&
        /^(ShallowReactive|Reactive|Ref|EmptyRef)$/.test(val[0])
      ) {
        out = reviveNuxtValue(val[1], values, stack);
      } else {
        out = [];
        for (var i = 0; i < val.length; i++) out.push(reviveNuxtValue(val[i], values, stack));
      }
    } else if (val && typeof val === "object") {
      out = {};
      for (var key in val) {
        if (Object.prototype.hasOwnProperty.call(val, key)) {
          out[key] = reviveNuxtValue(val[key], values, stack);
        }
      }
    } else {
      out = val;
    }

    delete stack[idx];
    return out;
  }

  function parseNuxtArticleFromDocument(doc) {
    if (!doc) return null;
    var el = doc.getElementById("__NUXT_DATA__");
    if (!el) return null;
    try {
      var values = JSON.parse(el.textContent || "[]");
      var root = reviveNuxtValue(1, values, {});
      return root && root.data && root.data.article ? root.data.article : null;
    } catch (e) {
      return null;
    }
  }

  function readNuxtArticleFromOpenPage() {
    if (!window.__NUXT__ || !window.__NUXT__.data || !window.__NUXT__.data.article) return null;
    return window.__NUXT__.data.article;
  }

  function extractAuthors(article) {
    if (!article) return "";
    var names = [];
    var contributors = article.contributors || [];
    for (var i = 0; i < contributors.length; i++) {
      var c = contributors[i];
      if (c && c.fullName && names.indexOf(c.fullName) < 0) names.push(String(c.fullName));
    }
    if (names.length) return names.join(", ");
    if (article.byline) {
      return String(article.byline).replace(/^By\s+/i, "").trim();
    }
    return "";
  }

  function extractSection(article) {
    if (!article) return "";
    if (article.subBrand && article.subBrand !== "none") return String(article.subBrand);
    var categories = article.categories || [];
    if (categories.length) {
      if (typeof categories[0] === "string") return String(categories[0]);
      if (categories[0] && categories[0].name) return String(categories[0].name);
    }
    return "";
  }

  function extractTags(article) {
    if (!article || !article.tags || !article.tags.length) return [];
    var tags = [];
    for (var i = 0; i < article.tags.length; i++) {
      var tag = article.tags[i];
      if (!tag) continue;
      if (typeof tag === "string") tags.push(tag);
      else if (tag.name) tags.push(String(tag.name));
    }
    return tags;
  }

  function extractBodyFromNuxtBlocks(blocks) {
    if (!blocks || !blocks.length) return "";
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block) continue;
      var type = String(block.type || "").toLowerCase();
      if (type !== "text" && type !== "paragraph" && type !== "hed" && type.indexOf("heading") < 0) continue;
      var text = sanitizeParagraphText(block.content || block.text || "");
      if (text) parts.push(text);
    }
    return parts.join("\n\n");
  }

  function applyArticleMetadata(article, state, source) {
    if (!article) return;
    if (!state.title && article.title) state.title = String(article.title);
    if (!state.description && article.dek) state.description = String(article.dek);
    if (!state.publishedAt && article.publishDate) state.publishedAt = String(article.publishDate);
    if (!state.dateModified && article.updateDate) state.dateModified = String(article.updateDate);
    if (!state.author) state.author = extractAuthors(article);
    if (!state.section) state.section = extractSection(article);
    if (!state.tags || !state.tags.length) state.tags = extractTags(article);
    if (!state.canonicalUrl && article.canonicalUrl) state.canonicalUrl = String(article.canonicalUrl);

    var body = extractBodyFromNuxtBlocks(article.body);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      state.source = source;
    }
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
    var leadBox = root.querySelector("main .lead-box");
    var els = leadBox
      ? leadBox.querySelectorAll("p.is-first-paragraph, p.font-text.text-lg")
      : root.querySelectorAll("main p.font-text.text-lg, main p.is-first-paragraph");
    var paragraphs = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 40) continue;
      if (isBoilerplateParagraph(text)) continue;
      paragraphs.push(text);
    }
    return sanitizeArticleBody(paragraphs.join("\n\n"));
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
      var article = readNuxtArticleFromOpenPage();
      var domBody = extractDomBody(document);
      if (article || domBody) {
        return { article: article, domBody: domBody };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return {
      article: readNuxtArticleFromOpenPage(),
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

  if (!isPoliticoHostname(hostname)) {
    return {
      error: "Not a Politico URL",
      hint: "Use an article link from www.politico.com.",
      action: "bun-browser open https://www.politico.com",
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
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 12, 300);
    if (openResult && openResult.article) {
      applyArticleMetadata(openResult.article, state, "openPage");
      state.finalUrl = location.href || raw;
    }
    if (openResult && openResult.domBody) {
      maybeSetBody(state, openResult.domBody, state.source || "dom");
    }
  }

  if (!state.articleBody) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open politico.com in Chrome first, then retry.",
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

    var nuxtArticle = parseNuxtArticleFromDocument(doc);
    if (nuxtArticle) {
      applyArticleMetadata(nuxtArticle, state, "nuxtData");
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
      if (h1) state.title = normalizeWhitespace(h1.textContent);
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
      hint: "Politico blocked content or the page has not finished loading. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

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
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
