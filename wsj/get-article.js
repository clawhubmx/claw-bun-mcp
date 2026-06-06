/* @meta
{
  "name": "wsj/get-article",
  "description": "Read WSJ article title, date, and body. Prefers embedded __NEXT_DATA__ (flattenedBody); falls back to live DOM paragraphs on an open article tab.",
  "domain": "www.wsj.com",
  "args": {
    "url": { "required": true, "description": "WSJ article URL (www.wsj.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site wsj/get-article https://www.wsj.com/finance/stocks/strong-job-growth-weakens-stocks-4fd74931"
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

  function isWsjHostname(hostname) {
    return hostname === "wsj.com" || hostname === "www.wsj.com" || hostname.endsWith(".wsj.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isWsjHostname(ua.hostname) || !isWsjHostname(ub.hostname)) return false;
      return ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch (e) {
      return false;
    }
  }

  function extractTextNodes(nodes) {
    if (!nodes) return "";
    if (typeof nodes === "string") return nodes;
    if (!Array.isArray(nodes)) nodes = [nodes];
    var out = "";
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n) continue;
      if (typeof n === "string") {
        out += n;
        continue;
      }
      if (n.text) out += String(n.text);
      if (n.content) out += extractTextNodes(n.content);
    }
    return out;
  }

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isCssArtifact(text) {
    if (!text) return true;
    var t = text.trim();
    if (/^\.css-[a-z0-9-]+/i.test(t)) return true;
    if (/\.css-[a-z0-9-]+[^{]*\{/.test(t) && (t.match(/\{/g) || []).length >= 2) return true;
    if (/@media\s*\(/.test(t) && /text-decoration:|outline-offset:|transition-property:/.test(t)) return true;
    if (/var\(--color-interactiveLink|var\(--outlineOffsetDefault\)/.test(t)) return true;
    return false;
  }

  function stripCssFromText(text) {
    if (!text) return "";
    var cleaned = String(text).replace(/<[^>]+>/g, " ");
    var cssStart = cleaned.search(/\.css-[a-z0-9-]+[^{]*\{/i);
    if (cssStart > 0) cleaned = cleaned.slice(0, cssStart);
    while (/\.css-[a-z0-9-]+[^{]*\{[^}]*\}/i.test(cleaned)) {
      cleaned = cleaned.replace(/\.css-[a-z0-9-]+[^{]*\{[^}]*\}/gi, " ");
    }
    while (/@media[^{]+\{[^}]*\}/i.test(cleaned)) {
      cleaned = cleaned.replace(/@media[^{]+\{[^}]*\}/gi, " ");
    }
    return normalizeWhitespace(cleaned);
  }

  function sanitizeParagraphText(text) {
    var cleaned = stripCssFromText(text);
    if (!cleaned || isCssArtifact(cleaned)) return "";
    return cleaned;
  }

  function sanitizeArticleBody(body) {
    if (!body) return "";
    var parts = String(body).split(/\n\n+/);
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      var part = sanitizeParagraphText(parts[i]);
      if (!part || isBoilerplateParagraph(part)) continue;
      kept.push(part);
    }
    return kept.join("\n\n");
  }

  function extractBodyFromFlattened(blocks) {
    if (!blocks || !blocks.length) return "";
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block) continue;
      var type = String(block.type || block.__typename || "").toLowerCase();
      if (type === "paragraph" || type === "hed" || type === "list" || type.indexOf("heading") >= 0) {
        var text = sanitizeParagraphText(extractTextNodes(block.content || block.textAndDecorations || block.text));
        if (text && !isBoilerplateParagraph(text)) parts.push(text);
      }
    }
    return parts.join("\n\n");
  }

  function getPageProps(nextData) {
    if (!nextData || !nextData.props) return null;
    return nextData.props.pageProps || null;
  }

  function getArticleData(pageProps) {
    if (!pageProps) return null;
    return pageProps.articleData || null;
  }

  function extractAuthors(articleData) {
    if (!articleData) return "";
    var names = [];
    var bylines = articleData.byline || [];
    for (var i = 0; i < bylines.length; i++) {
      if (bylines[i] && bylines[i].text) {
        names.push(String(bylines[i].text).replace(/^By\s+/i, "").trim());
      }
    }
    var authors = articleData.authors || [];
    for (var j = 0; j < authors.length; j++) {
      var a = authors[j];
      if (!a) continue;
      if (typeof a === "string") names.push(a);
      else if (a.name) names.push(String(a.name));
      else if (a.text) names.push(String(a.text));
    }
    var unique = [];
    for (var k = 0; k < names.length; k++) {
      if (names[k] && unique.indexOf(names[k]) < 0) unique.push(names[k]);
    }
    return unique.join(", ");
  }

  function applyArticleMetadata(articleData, pageProps, state) {
    if (!articleData) return;
    if (!state.title && articleData.headline) {
      state.title = String(articleData.headline.text || articleData.headline);
    }
    if (!state.publishedAt && articleData.publishedDateTimeUtc) {
      state.publishedAt = String(articleData.publishedDateTimeUtc);
    }
    if (!state.dateModified && articleData.updatedDateTimeUtc) {
      state.dateModified = String(articleData.updatedDateTimeUtc);
    }
    if (!state.description && articleData.standFirst && articleData.standFirst.content && articleData.standFirst.content.text) {
      state.description = String(articleData.standFirst.content.text);
    }
    if (!state.section && articleData.sectionName) state.section = String(articleData.sectionName);
    if (!state.author) state.author = extractAuthors(articleData);

    if (pageProps) {
      if (typeof pageProps.isSnippetView === "boolean") state.isSnippetView = pageProps.isSnippetView;
      if (typeof pageProps.isServerUnlockedContent === "boolean") {
        state.isServerUnlockedContent = pageProps.isServerUnlockedContent;
      }
    }

    var blocks = articleData.flattenedBody;
    if ((!blocks || !blocks.length) && pageProps && pageProps.snippet) blocks = pageProps.snippet;
    var body = extractBodyFromFlattened(blocks);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      if (!state.source) {
        state.source = pageProps && pageProps.isSnippetView ? "snippet" : "nextData";
      }
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

  function isPaywallPreview(text) {
    if (!text) return true;
    if (/This copy is for your personal, non-commercial use only/i.test(text)) return true;
    if (/^Subscribe to read/i.test(text)) return true;
    if (/Continue reading your article with a WSJ subscription/i.test(text)) return true;
    if (/Sign in to read/i.test(text)) return true;
    return false;
  }

  function isBoilerplateParagraph(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Newsletter Sign-up$/i.test(t)) return true;
    if (/^Listen$/i.test(t)) return true;
    if (/^\(\d+ min\)$/i.test(t)) return true;
    if (/^\d+$/.test(t)) return true;
    if (/^This is an edition of the .+ newsletter/i.test(t)) return true;
    if (/If you(?:'|\u2019)re not subscribed,\s*sign up here/i.test(t)) return true;
    if (/free in your inbox daily/i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Be prepared for the trading day ahead/i.test(t)) return true;
    if (/^Markets P\.M\. catches you up/i.test(t)) return true;
    if (/^What(?:'|\u2019)s News catches you up/i.test(t)) return true;
    if (/sign up for .+ newsletter/i.test(t) && t.length < 320) return true;
    if (/^This email was prepared by/i.test(t)) return true;
    if (/To send us your feedback, reply to this email/i.test(t)) return true;
    if (/Got a tip for us\?/i.test(t) && /submit/i.test(t) && t.length < 420) return true;
    if (/^This copy is for your personal, non-commercial use only/i.test(t)) return true;
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
    var els = root.querySelectorAll('[data-type="paragraph"]');
    if (!els.length) els = root.querySelectorAll("article section p");
    var paragraphs = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 40) continue;
      if (isBoilerplateParagraph(text)) continue;
      paragraphs.push(text);
    }
    return sanitizeArticleBody(paragraphs.join("\n\n"));
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

  if (!isWsjHostname(hostname)) {
    return {
      error: "Not a WSJ URL",
      hint: "Use an article link from www.wsj.com.",
      action: "bun-browser open https://www.wsj.com",
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
    isSnippetView: null,
    isServerUnlockedContent: null,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 250);
    if (openResult && openResult.hit && openResult.hit.nextData) {
      var openProps = getPageProps(openResult.hit.nextData);
      applyArticleMetadata(getArticleData(openProps), openProps, state);
      if (!state.source) state.source = openResult.hit.source;
      state.finalUrl = location.href || raw;
    }
    if (openResult && openResult.domBody && openResult.domBody.length > (state.articleBody || "").length) {
      maybeSetBody(state, openResult.domBody, "dom");
    }
  }

  if (!state.articleBody || state.isSnippetView) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open wsj.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");
    var nextData = parseNextDataFromDocument(doc);
    var pageProps = getPageProps(nextData);
    var articleData = getArticleData(pageProps);
    if (articleData) {
      applyArticleMetadata(articleData, pageProps, state);
      if (!state.source) state.source = pageProps && pageProps.isSnippetView ? "snippet" : "nextData";
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
            state.articleBody = String(item.articleBody);
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
      var pubMeta = doc.querySelector('meta[property="article:published_time"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var timeEl = doc.querySelector("time[datetime]");
      if (timeEl) state.publishedAt = (timeEl.getAttribute("datetime") || "").trim();
    }

    if (!state.articleBody || (state.isSnippetView && state.source === "snippet")) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "WSJ paywall blocked content. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      isSnippetView: state.isSnippetView,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article data was not found. Open wsj.com in Chrome (with subscription if needed) and retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      preview: state.articleBody.slice(0, 500),
      isSnippetView: state.isSnippetView,
    };
  }

  var paywallBypassed =
    state.source !== "dom" &&
    state.source !== "snippet" &&
    state.isSnippetView !== true;

  if (state.isServerUnlockedContent === true) paywallBypassed = true;
  if (state.source === "nextData" && state.isSnippetView !== true) paywallBypassed = true;

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
    isSnippetView: state.isSnippetView,
    paywallBypassed: paywallBypassed,
  };
}
