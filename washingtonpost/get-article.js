/* @meta
{
  "name": "washingtonpost/get-article",
  "description": "Read Washington Post article title, date, and body. Prefers embedded __NEXT_DATA__ (globalContent.content_elements); falls back to live DOM paragraphs on an open article tab.",
  "domain": "www.washingtonpost.com",
  "args": {
    "url": { "required": true, "description": "Washington Post article URL (www.washingtonpost.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site washingtonpost/get-article https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/"
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

  function isWaPoHostname(hostname) {
    return (
      hostname === "washingtonpost.com" ||
      hostname === "www.washingtonpost.com" ||
      hostname.endsWith(".washingtonpost.com")
    );
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isWaPoHostname(ua.hostname) || !isWaPoHostname(ub.hostname)) return false;
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
    if (/^Listen$/i.test(t)) return true;
    if (/^\(\d+ min\)$/i.test(t)) return true;
    if (/^Gift the gift of knowledge/i.test(t)) return true;
    if (/^Try 1 month for \$1/i.test(t)) return true;
    if (/^Subscribe to read/i.test(t)) return true;
    if (/^Already a subscriber\?/i.test(t)) return true;
    if (/^Sign in to read/i.test(t)) return true;
    if (/^Create an account free articles remaining/i.test(t)) return true;
    if (/^All stories are free/i.test(t) && /subscriber/i.test(t)) return true;
    if (/^By signing up, you agree to/i.test(t)) return true;
    if (/^Most read$/i.test(t)) return true;
    if (/^Share this article$/i.test(t)) return true;
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

  function isReadableContentElement(el) {
    if (!el) return false;
    var type = String(el.type || "").toLowerCase();
    return type === "text" || type === "header" || type === "quote" || type === "list";
  }

  function hasSubscribeCta(elements) {
    if (!elements || !elements.length) return false;
    for (var i = 0; i < elements.length; i++) {
      if (elements[i] && String(elements[i].type || "").toLowerCase() === "subscribe-cta") return true;
    }
    return false;
  }

  function countReadableElements(elements) {
    if (!elements || !elements.length) return 0;
    var count = 0;
    for (var i = 0; i < elements.length; i++) {
      if (isReadableContentElement(elements[i])) count++;
    }
    return count;
  }

  function isTeaserContent(globalContent) {
    if (!globalContent) return false;
    var elements = globalContent.content_elements || [];
    if (!hasSubscribeCta(elements)) return false;
    return countReadableElements(elements) <= 2;
  }

  function extractTextFromListElement(listEl) {
    if (!listEl) return "";
    var items = listEl.items || [];
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) continue;
      var text = sanitizeParagraphText(item.content || item.text || "");
      if (text) parts.push("• " + text);
    }
    return parts.join("\n");
  }

  function extractBodyFromContentElements(elements) {
    if (!elements || !elements.length) return "";
    var parts = [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el) continue;
      var type = String(el.type || "").toLowerCase();
      if (type === "subscribe-cta" || type === "image" || type === "video" || type === "raw_html") continue;
      if (type === "text" || type === "header" || type === "quote") {
        var text = sanitizeParagraphText(el.content || el.text || "");
        if (text) parts.push(text);
      } else if (type === "list") {
        var listText = extractTextFromListElement(el);
        if (listText) parts.push(listText);
      }
    }
    return parts.join("\n\n");
  }

  function getPageProps(nextData) {
    if (!nextData || !nextData.props) return null;
    return nextData.props.pageProps || null;
  }

  function getGlobalContent(pageProps) {
    if (!pageProps) return null;
    return pageProps.globalContent || null;
  }

  function extractAuthors(globalContent) {
    if (!globalContent || !globalContent.credits || !globalContent.credits.by) return "";
    var names = [];
    var bylines = globalContent.credits.by;
    for (var i = 0; i < bylines.length; i++) {
      var author = bylines[i];
      if (!author) continue;
      if (author.name && names.indexOf(author.name) < 0) names.push(String(author.name));
      else if (author.byline && names.indexOf(author.byline) < 0) names.push(String(author.byline));
    }
    return names.join(", ");
  }

  function extractSection(globalContent) {
    if (!globalContent || !globalContent.taxonomy) return "";
    var primary = globalContent.taxonomy.primary_section;
    if (primary && primary.name) return String(primary.name);
    var sections = globalContent.taxonomy.sections || [];
    if (sections.length && sections[0].name) return String(sections[0].name);
    return "";
  }

  function applyArticleMetadata(globalContent, state, source) {
    if (!globalContent) return;

    if (!state.title && globalContent.headlines) {
      state.title = String(globalContent.headlines.basic || globalContent.headlines.meta_title || "");
    }
    if (!state.description && globalContent.description) {
      state.description = String(globalContent.description.basic || globalContent.description);
    }
    if (!state.publishedAt && globalContent.first_publish_date) {
      state.publishedAt = String(globalContent.first_publish_date);
    }
    if (!state.dateModified && globalContent.last_updated_date) {
      state.dateModified = String(globalContent.last_updated_date);
    }
    if (!state.displayDate && globalContent.display_date) {
      state.displayDate = String(globalContent.display_date);
    }
    if (!state.author) state.author = extractAuthors(globalContent);
    if (!state.section) state.section = extractSection(globalContent);
    if (!state.canonicalUrl && globalContent.canonical_url) {
      var canonical = String(globalContent.canonical_url);
      state.canonicalUrl = /^https?:\/\//i.test(canonical)
        ? canonical
        : "https://www.washingtonpost.com" + (canonical.charAt(0) === "/" ? canonical : "/" + canonical);
    }
    if (globalContent.subtype) state.subtype = String(globalContent.subtype);

    state.isTeaserContent = isTeaserContent(globalContent);
    state.hasSubscribeCta = hasSubscribeCta(globalContent.content_elements || []);

    var body = extractBodyFromContentElements(globalContent.content_elements);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      state.source = source;
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
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Subscribe to read/i.test(t)) return true;
    if (/^Already a subscriber\?/i.test(t) && t.length < 500) return true;
    if (/^Sign in to read/i.test(t)) return true;
    if (/^Try 1 month for \$1/i.test(t) && t.length < 700) return true;
    if (/^Create an account free articles remaining/i.test(t)) return true;
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
    var container =
      root.querySelector("[data-qa=article-body]") ||
      root.querySelector(".article-body") ||
      root.querySelector("article") ||
      root.querySelector("main");
    if (!container) return "";
    var els = container.querySelectorAll("p");
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

  if (!isWaPoHostname(hostname)) {
    return {
      error: "Not a Washington Post URL",
      hint: "Use an article link from www.washingtonpost.com.",
      action: "bun-browser open https://www.washingtonpost.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    displayDate: "",
    description: "",
    section: "",
    subtype: "",
    canonicalUrl: "",
    articleBody: "",
    source: "",
    finalUrl: raw,
    isTeaserContent: false,
    hasSubscribeCta: false,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 250);
    if (openResult && openResult.hit && openResult.hit.nextData) {
      var openProps = getPageProps(openResult.hit.nextData);
      applyArticleMetadata(getGlobalContent(openProps), state, openResult.hit.source);
      if (!state.source) state.source = openResult.hit.source;
      state.finalUrl = location.href || raw;
    }
    if (openResult && openResult.domBody && openResult.domBody.length > (state.articleBody || "").length) {
      maybeSetBody(state, openResult.domBody, "dom");
    }
  }

  if (!state.articleBody || state.isTeaserContent) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open washingtonpost.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");
    var nextData = parseNextDataFromDocument(doc);
    var pageProps = getPageProps(nextData);
    var globalContent = getGlobalContent(pageProps);
    if (globalContent) {
      applyArticleMetadata(globalContent, state, "nextData");
      if (!state.source) state.source = "nextData";
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

    if (!state.articleBody || state.isTeaserContent) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "WaPo paywall blocked content. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      isTeaserContent: state.isTeaserContent,
      hasSubscribeCta: state.hasSubscribeCta,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody) || (state.isTeaserContent && state.articleBody.length < 900)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article data was not found. Open washingtonpost.com in Chrome (with subscription if needed) and retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      author: state.author || null,
      publishedAt: state.publishedAt || null,
      preview: state.articleBody.slice(0, 500),
      isTeaserContent: state.isTeaserContent,
      hasSubscribeCta: state.hasSubscribeCta,
    };
  }

  var paywallBypassed = state.source !== "dom" && state.source !== "jsonLd" && !state.isTeaserContent;
  if (state.source === "nextData" || state.source === "openPage" || state.source === "openPageHtml") {
    paywallBypassed = !state.isTeaserContent;
  }

  return {
    url: state.finalUrl,
    canonicalUrl: state.canonicalUrl || state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    displayDate: state.displayDate || null,
    description: state.description || null,
    section: state.section || null,
    subtype: state.subtype || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
    isTeaserContent: state.isTeaserContent,
    hasSubscribeCta: state.hasSubscribeCta,
    paywallBypassed: paywallBypassed,
  };
}
