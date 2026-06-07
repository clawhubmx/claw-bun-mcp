/* @meta
{
  "name": "investing/get-article",
  "description": "Read Investing.com article title, author, date, and body. Prefers embedded __NEXT_DATA__ (newsStore._article.body); falls back to live DOM paragraphs on an open article tab.",
  "domain": "www.investing.com",
  "args": {
    "url": { "required": true, "description": "Investing.com article URL (www.investing.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site investing/get-article https://www.investing.com/news/stock-market-news/whos-winning-the-pizza-race-4729642"
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

  function isInvestingHostname(hostname) {
    return hostname === "investing.com" || hostname.endsWith(".investing.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isInvestingHostname(ua.hostname) || !isInvestingHostname(ub.hostname)) return false;
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

  function decodeHtmlEntities(text) {
    if (!text) return "";
    var el = document.createElement("textarea");
    el.innerHTML = text;
    return el.value;
  }

  function stripHtml(html) {
    if (!html) return "";
    var cleaned = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    var doc = new DOMParser().parseFromString("<div>" + cleaned + "</div>", "text/html");
    return normalizeWhitespace(doc.body ? doc.body.textContent : cleaned.replace(/<[^>]+>/g, " "));
  }

  function humanizeSlug(slug) {
    if (!slug) return "";
    return String(slug)
      .split("-")
      .filter(Boolean)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  }

  function sectionFromUrl(url) {
    try {
      var parts = new URL(url).pathname.split("/").filter(Boolean);
      if (parts[0] === "news" && parts[1]) return humanizeSlug(parts[1]);
      if (parts[0] === "analysis" && parts[1]) return humanizeSlug(parts[1]);
    } catch (e) {}
    return "";
  }

  function isBoilerplateParagraph(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Related Articles$/i.test(t)) return true;
    if (/^Add to Watchlist$/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Subscribe to /i.test(t) && t.length < 320) return true;
    if (/^The fastest way to find out is with our Fair Value calculator/i.test(t)) return true;
    if (/^Get the bottom line for /i.test(t) && /valuation models/i.test(t)) return true;
    if (/Fair Value calculator/i.test(t) && /valuation models/i.test(t)) return true;
    if (/^Read more$/i.test(t)) return true;
    if (/^Comments$/i.test(t) && t.length < 40) return true;
    if (/^Share$/i.test(t) && t.length < 20) return true;
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

  function extractBodyFromHtml(html) {
    if (!html) return "";
    var doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
    var paragraphs = doc.querySelectorAll("p");
    var parts = [];
    for (var i = 0; i < paragraphs.length; i++) {
      var text = sanitizeParagraphText(paragraphs[i].textContent || "");
      if (text) parts.push(text);
    }
    if (!parts.length) {
      var fallback = sanitizeParagraphText(stripHtml(html));
      if (fallback) parts.push(fallback);
    }
    return sanitizeArticleBody(parts.join("\n\n"));
  }

  function getArticleFromNextData(nextData) {
    if (!nextData || !nextData.props || !nextData.props.pageProps) return null;
    var state = nextData.props.pageProps.state;
    if (!state || !state.newsStore || !state.newsStore._article) return null;
    return state.newsStore._article;
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

  function extractAuthor(article) {
    if (!article) return "";
    if (article.writerName) return String(article.writerName);
    if (article.front_writer_name) return String(article.front_writer_name);
    if (article.front_member_name) return String(article.front_member_name);
    if (article.source_name) return String(article.source_name);
    return "";
  }

  function applyArticleMetadata(article, state, source) {
    if (!article) return;
    if (!state.title && article.title) state.title = String(article.title);
    if (!state.publishedAt && article.published_at) state.publishedAt = String(article.published_at);
    if (!state.dateModified && article.updated_at) state.dateModified = String(article.updated_at);
    if (!state.author) state.author = extractAuthor(article);
    if (!state.provider && article.provider) state.provider = String(article.provider);
    if (!state.sourceName && article.source_name) state.sourceName = String(article.source_name);
    if (!state.section && article.category) state.section = String(article.category);
    if (!state.articleLink && article.link) state.articleLink = String(article.link);

    var body = extractBodyFromHtml(article.body || "");
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
    var container = root.querySelector("#article") || root.querySelector("article");
    if (!container) return "";
    var els = container.querySelectorAll("p");
    var paragraphs = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 30) continue;
      if (isBoilerplateParagraph(text)) continue;
      paragraphs.push(text);
    }
    return sanitizeArticleBody(paragraphs.join("\n\n"));
  }

  function readArticleFromOpenPage() {
    if (window.__NEXT_DATA__) {
      return { nextData: window.__NEXT_DATA__, source: "openPage" };
    }
    var parsed = parseNextDataFromDocument(document);
    if (parsed) return { nextData: parsed, source: "openPageHtml" };
    return null;
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
      var hit = readArticleFromOpenPage();
      var domBody = extractDomBody(document);
      if ((hit && hit.nextData) || domBody) {
        return { hit: hit, domBody: domBody };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return {
      hit: readArticleFromOpenPage(),
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

  if (!isInvestingHostname(hostname)) {
    return {
      error: "Not an Investing.com URL",
      hint: "Use an article link from www.investing.com.",
      action: "bun-browser open https://www.investing.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    section: sectionFromUrl(raw),
    provider: "",
    sourceName: "",
    articleLink: "",
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 12, 300);
    if (openResult && openResult.hit && openResult.hit.nextData) {
      var article = getArticleFromNextData(openResult.hit.nextData);
      applyArticleMetadata(article, state, openResult.hit.source);
      if (!state.source) state.source = openResult.hit.source;
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
        hint: "Article may be unavailable. Open investing.com in Chrome first, then retry.",
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

    var nextData = parseNextDataFromDocument(doc);
    var fetchedArticle = getArticleFromNextData(nextData);
    if (fetchedArticle) {
      applyArticleMetadata(fetchedArticle, state, "nextData");
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
          if (!state.section && item.articleSection) state.section = String(item.articleSection);
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
      if (og) state.title = decodeHtmlEntities((og.getAttribute("content") || "").trim());
    }
    if (!state.title) {
      var h1 = doc.querySelector("h1");
      if (h1) state.title = normalizeWhitespace(h1.textContent);
    }
    if (!state.description) {
      var ogd = doc.querySelector('meta[property="og:description"]');
      if (ogd) state.description = decodeHtmlEntities((ogd.getAttribute("content") || "").trim());
    }
    if (!state.publishedAt) {
      var pubMeta = doc.querySelector('meta[property="article:published_time"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var timeEl = doc.querySelector("time[datetime]");
      if (timeEl) state.publishedAt = (timeEl.getAttribute("datetime") || "").trim();
    }
    if (!state.section) state.section = sectionFromUrl(state.finalUrl);

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "Investing.com blocked content or the page has not finished loading. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);
  if (!state.section) state.section = sectionFromUrl(state.finalUrl);

  return {
    url: state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    section: state.section || null,
    provider: state.provider || null,
    sourceName: state.sourceName || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
