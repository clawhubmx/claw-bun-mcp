/* @meta
{
  "name": "reuters/get-article",
  "description": "Read Reuters article title, date, and body. Prefers embedded Fusion.globalContent (content_elements); falls back to ArticleBody DOM paragraphs on an open article tab.",
  "domain": "www.reuters.com",
  "args": {
    "url": { "required": true, "description": "Reuters article URL (www.reuters.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site reuters/get-article https://www.reuters.com/world/asia-pacific/us-eyes-iranian-assets-gulf-allies-reconstruction-source-says-2026-06-06/"
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

  function isReutersHostname(hostname) {
    return hostname === "reuters.com" || hostname === "www.reuters.com" || hostname.endsWith(".reuters.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isReutersHostname(ua.hostname) || !isReutersHostname(ub.hostname)) return false;
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
    return normalizeWhitespace(String(html).replace(/<[^>]+>/g, " "));
  }

  function isBoilerplateParagraph(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Newsletter Sign-up$/i.test(t)) return true;
    if (/Inside Track newsletter/i.test(t) && /sign up/i.test(t)) return true;
    if (/^Our Standards:/i.test(t)) return true;
    if (/^Reporting by /i.test(t) && /Editing by /i.test(t)) return true;
    if (/^Please enable JS and disable any ad blocker/i.test(t)) return true;
    if (/^Skip to main content$/i.test(t)) return true;
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

  function extractBodyFromFusionResult(result) {
    if (!result || !result.content_elements) return "";
    var parts = [];
    var elements = result.content_elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el) continue;
      var type = String(el.type || "").toLowerCase();
      if (type !== "paragraph" && type !== "header" && type !== "text") continue;
      var text = sanitizeParagraphText(el.content || el.text || "");
      if (text) parts.push(text);
    }
    return parts.join("\n\n");
  }

  function extractAuthors(result) {
    if (!result) return "";
    var names = [];
    var authors = result.authors || [];
    for (var i = 0; i < authors.length; i++) {
      var a = authors[i];
      if (!a) continue;
      if (a.name) names.push(String(a.name));
      else if (a.byline) names.push(String(a.byline));
    }
    if (!names.length && result.credits && result.credits.by) {
      var by = result.credits.by;
      for (var j = 0; j < by.length; j++) {
        if (by[j] && by[j].name) names.push(String(by[j].name));
      }
    }
    var unique = [];
    for (var k = 0; k < names.length; k++) {
      if (names[k] && unique.indexOf(names[k]) < 0) unique.push(names[k]);
    }
    return unique.join(", ");
  }

  function applyFusionMetadata(result, state) {
    if (!result) return;
    if (!state.title) {
      if (result.headlines && result.headlines.basic) state.title = String(result.headlines.basic);
      else if (result.basic_headline) state.title = String(result.basic_headline);
      else if (result.title) state.title = String(result.title);
    }
    if (!state.description) {
      if (result.description && result.description.basic) state.description = String(result.description.basic);
      else if (typeof result.description === "string") state.description = result.description;
      else if (result.excerpt) state.description = String(result.excerpt);
    }
    if (!state.publishedAt && result.display_time) state.publishedAt = String(result.display_time);
    if (!state.publishedAt && result.published_time) state.publishedAt = String(result.published_time);
    if (!state.dateModified && result.updated_time) state.dateModified = String(result.updated_time);
    if (!state.section && result.taxonomy) {
      if (result.taxonomy.section && result.taxonomy.section.name) {
        state.section = String(result.taxonomy.section.name);
      } else if (result.taxonomy.primary_section && result.taxonomy.primary_section.name) {
        state.section = String(result.taxonomy.primary_section.name);
      }
    }
    if (!state.author) state.author = extractAuthors(result);

    var body = extractBodyFromFusionResult(result);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      if (!state.source) state.source = "fusion";
    }
  }

  function parseFusionGlobalContentFromText(text) {
    if (!text) return null;
    var marker = "Fusion.globalContent=";
    var start = text.indexOf(marker);
    if (start < 0) return null;
    var i = start + marker.length;
    if (text[i] !== "{") return null;

    var depth = 0;
    var inStr = false;
    var esc = false;
    var quote = "";

    for (; i < text.length; i++) {
      var c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === quote) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        quote = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }

    try {
      return JSON.parse(text.slice(start + marker.length, i));
    } catch (e) {
      return null;
    }
  }

  function readFusionFromOpenPage() {
    if (!window.Fusion || !window.Fusion.globalContent) return null;
    return { fusion: window.Fusion.globalContent, source: "fusionOpenPage" };
  }

  function isBotChallenge(doc) {
    if (!doc) return false;
    var title = (doc.querySelector("title")?.textContent || "").trim();
    if (/^reuters\.com$/i.test(title) && /Please enable JS and disable any ad blocker/i.test(doc.body?.textContent || "")) {
      return true;
    }
    if (/just a moment/i.test(title)) return true;
    if (doc.body && /Enable JavaScript and cookies to continue/i.test(doc.body.textContent || "")) return true;
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
    var els = root.querySelectorAll('[data-testid="ArticleBody"] [data-testid^="paragraph-"]');
    if (!els.length) els = root.querySelectorAll('[data-testid^="paragraph-"]');
    var paragraphs = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 20) continue;
      paragraphs.push(text);
    }
    return sanitizeArticleBody(paragraphs.join("\n\n"));
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      var fusionHit = readFusionFromOpenPage();
      var domBody = extractDomBody(document);
      if ((fusionHit && fusionHit.fusion && fusionHit.fusion.result) || domBody) {
        return { fusionHit: fusionHit, domBody: domBody };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return {
      fusionHit: readFusionFromOpenPage(),
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

  if (!isReutersHostname(hostname)) {
    return {
      error: "Not a Reuters URL",
      hint: "Use an article link from www.reuters.com.",
      action: "bun-browser open https://www.reuters.com",
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
    isAccessibleForFree: null,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 250);
    if (openResult && openResult.fusionHit && openResult.fusionHit.fusion && openResult.fusionHit.fusion.result) {
      applyFusionMetadata(openResult.fusionHit.fusion.result, state);
      if (!state.source) state.source = openResult.fusionHit.source;
      state.finalUrl = location.href || raw;
    }
    if (openResult && openResult.domBody) {
      maybeSetBody(state, openResult.domBody, "dom");
    }
  }

  if (!state.articleBody) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open reuters.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");

    if (isBotChallenge(doc)) {
      return {
        error: "Bot challenge blocked fetch",
        hint: "Open the article in Chrome, wait for the page to load, then retry.",
        action: "bun-browser open " + raw,
        title: state.title || null,
      };
    }

    var fusionData = parseFusionGlobalContentFromText(html);
    if (fusionData && fusionData.result) {
      applyFusionMetadata(fusionData.result, state);
      if (!state.source) state.source = "fusion";
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
          if (typeof item.isAccessibleForFree === "boolean") state.isAccessibleForFree = item.isAccessibleForFree;
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
            state.articleBody = sanitizeArticleBody(String(item.articleBody));
            state.source = "jsonLd";
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
      var pubMeta = doc.querySelector('meta[property="article:published_time"], meta[name="article:published_time"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.dateModified) {
      var modMeta = doc.querySelector('meta[property="article:modified_time"], meta[name="article:modified_time"]');
      if (modMeta) state.dateModified = (modMeta.getAttribute("content") || "").trim();
    }
    if (!state.author) {
      var authorMeta = doc.querySelector('meta[name="article:author"]');
      if (authorMeta) state.author = (authorMeta.getAttribute("content") || "").trim();
    }
    if (!state.section) {
      var sectionMeta = doc.querySelector('meta[name="article:section"]');
      if (sectionMeta) state.section = (sectionMeta.getAttribute("content") || "").trim();
    }

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "Reuters blocked content or the page structure changed. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
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
    section: state.section || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
    isAccessibleForFree: state.isAccessibleForFree,
  };
}
