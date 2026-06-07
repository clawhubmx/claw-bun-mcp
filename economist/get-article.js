/* @meta
{
  "name": "economist/get-article",
  "description": "Read The Economist article title, date, and body. Prefers /_next/data/{buildId}/...json route JSON (pageProps.content.body); falls back to embedded __NEXT_DATA__ and live DOM paragraphs.",
  "domain": "www.economist.com",
  "args": {
    "url": { "required": true, "description": "The Economist article URL (www.economist.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site economist/get-article https://www.economist.com/finance-and-economics/2026/06/05/how-hot-is-americas-labour-market"
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

  function isEconomistHostname(hostname) {
    return (
      hostname === "economist.com" ||
      hostname === "www.economist.com" ||
      hostname.endsWith(".economist.com")
    );
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isEconomistHostname(ua.hostname) || !isEconomistHostname(ub.hostname)) return false;
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
    if (/^Newsletter$/i.test(t)) return true;
    if (/^Subscribe to The Economist/i.test(t)) return true;
    if (/^Enjoy unlimited access/i.test(t)) return true;
    if (/^Register for free to read/i.test(t)) return true;
    if (/^Already have an account\?/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Explore our subscription offers/i.test(t)) return true;
    if (/^Reuse this content/i.test(t)) return true;
    if (/^More from /i.test(t) && t.length < 120) return true;
    if (/^Discover more/i.test(t) && t.length < 120) return true;
    if (/^Listen to this story$/i.test(t)) return true;
    if (/^Share$/i.test(t)) return true;
    if (/^Save$/i.test(t)) return true;
    if (/^Gift this article$/i.test(t)) return true;
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

  function blockText(block) {
    if (!block) return "";
    if (block.text) return sanitizeParagraphText(block.text);
    if (block.textHtml) return sanitizeParagraphText(block.textHtml);
    if (block.caption) return sanitizeParagraphText(block.caption);
    if (block.value) return sanitizeParagraphText(block.value);
    if (block.content) return sanitizeParagraphText(block.content);
    return "";
  }

  function extractBodyFromBlocks(blocks) {
    if (!blocks || !blocks.length) return "";
    var parts = [];
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (!block) continue;
      var type = String(block.type || block.__typename || "").toUpperCase();
      if (
        type === "PARAGRAPH" ||
        type === "CROSSHEAD" ||
        type === "HEADING" ||
        type === "SUBHEADING" ||
        type === "QUOTE" ||
        type === "PULLQUOTE" ||
        type === "BLOCKQUOTE" ||
        type === "INFOBOX" ||
        type === "CALLOUT"
      ) {
        var text = blockText(block);
        if (text) parts.push(text);
        continue;
      }
      if (type === "ORDERED_LIST" || type === "UNORDERED_LIST" || type === "LIST") {
        var items = block.items || block.children || [];
        for (var j = 0; j < items.length; j++) {
          var itemText = blockText(items[j]);
          if (itemText) parts.push(itemText);
        }
        continue;
      }
      if (type === "IMAGE" || type === "PHOTO") {
        var caption = blockText(block);
        if (caption) parts.push(caption);
      }
    }
    return parts.join("\n\n");
  }

  function getPageProps(nextData) {
    if (!nextData || !nextData.props) return null;
    return nextData.props.pageProps || null;
  }

  function getContent(pageProps) {
    if (!pageProps) return null;
    return pageProps.content || null;
  }

  function isSubscriberSession(pageProps) {
    if (!pageProps) return false;
    if (pageProps.isSubscriber === true) return true;
    if (pageProps.auth && pageProps.auth.isSubscriber === true) return true;
    if (pageProps.paywallCheck && pageProps.paywallCheck.shouldDropPaywall === true) return true;
    return false;
  }

  function isContentWalled(pageProps) {
    if (!pageProps) return false;
    if (isSubscriberSession(pageProps)) return false;
    return pageProps.walled === true;
  }

  function extractAuthors(content) {
    if (!content) return "";
    var names = [];
    if (content.byline) names.push(String(content.byline).replace(/^By\s+/i, "").trim());
    var authors = content.authors || [];
    for (var i = 0; i < authors.length; i++) {
      var a = authors[i];
      if (!a) continue;
      if (typeof a === "string") names.push(a);
      else if (a.name) names.push(String(a.name));
      else if (a.displayName) names.push(String(a.displayName));
      else if (a.text) names.push(String(a.text));
    }
    var unique = [];
    for (var j = 0; j < names.length; j++) {
      if (names[j] && unique.indexOf(names[j]) < 0) unique.push(names[j]);
    }
    return unique.join(", ");
  }

  function applyContentMetadata(content, pageProps, state) {
    if (!content) return;
    if (!state.title && content.headline) state.title = String(content.headline).trim();
    if (!state.publishedAt && content.datePublished) state.publishedAt = String(content.datePublished);
    if (!state.publishedAt && content.dateFirstPublished) state.publishedAt = String(content.dateFirstPublished);
    if (!state.dateModified && content.dateModified) state.dateModified = String(content.dateModified);
    if (!state.dateModified && content.dateRevised) state.dateModified = String(content.dateRevised);
    if (!state.description && content.rubric) state.description = String(content.rubric).trim();
    if (!state.description && content.seo && content.seo.description) {
      state.description = String(content.seo.description).trim();
    }
    if (!state.flyTitle && content.flyTitle) state.flyTitle = String(content.flyTitle).trim();
    if (!state.rubric && content.rubric) state.rubric = String(content.rubric).trim();
    if (!state.section && content.section && content.section.name) {
      state.section = String(content.section.name);
    }
    if (!state.author) state.author = extractAuthors(content);

    if (pageProps) {
      state.walled = pageProps.walled;
      state.isSubscriber = isSubscriberSession(pageProps);
    }

    var body = extractBodyFromBlocks(content.body);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      if (!state.source) state.source = "nextData";
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

  function articlePathname(url) {
    try {
      return new URL(url).pathname.replace(/\/$/, "");
    } catch (e) {
      return "";
    }
  }

  function hasFullArticleBody(state) {
    var content = state.contentMeta;
    var bodyLen = (state.articleBody || "").length;
    if (content && content.body && content.body.length >= 2 && bodyLen >= 1500) return true;
    if (bodyLen >= 2500) return true;
    return false;
  }

  async function applyNextDataRoute(nextData, state, pageUrl) {
    if (!nextData || !nextData.buildId) return false;
    var pathname = articlePathname(pageUrl || state.finalUrl);
    if (!pathname) return false;
    var routeUrl = "/_next/data/" + nextData.buildId + pathname + ".json";
    try {
      var resp = await fetch(routeUrl, { credentials: "include", redirect: "follow" });
      if (!resp.ok) return false;
      var ct = resp.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0) return false;
      var payload = await resp.json();
      var pageProps = payload && payload.pageProps;
      var content = getContent(pageProps);
      if (!content) return false;
      var beforeLen = (state.articleBody || "").length;
      applyContentMetadata(content, pageProps, state);
      state.contentMeta = content;
      state.pagePropsMeta = pageProps;
      if ((state.articleBody || "").length > beforeLen) {
        state.source = "nextDataRoute";
        return true;
      }
    } catch (e) {}
    return false;
  }

  function isBotChallenge(doc) {
    if (!doc) return false;
    var title = (doc.querySelector("title")?.textContent || "").trim();
    if (/^just a moment/i.test(title)) return true;
    if (doc.body && /Enable JavaScript and cookies to continue/i.test(doc.body.textContent || "")) return true;
    return false;
  }

  function isPaywallPreview(text, pageProps, content) {
    if (isSubscriberSession(pageProps)) return false;
    if (!text) return true;
    if (content && content.body && content.body.length >= 2 && text.length >= 1500) return false;
    if (/■\s*$/.test(text.trim()) && text.length >= 1500) return false;
    if (isContentWalled(pageProps)) {
      var blockCount = content && content.body ? content.body.length : 0;
      if (blockCount <= 1 && text.length < 4000) return true;
    }
    if (/^Subscribe to The Economist/i.test(text) && text.length < 800) return true;
    if (/Enjoy unlimited access to our/i.test(text) && text.length < 800) return true;
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
    var article = root.querySelector('article[data-testid="Article"]') || root.querySelector("article");
    if (!article) return "";
    var els = article.querySelectorAll('p[data-component="paragraph"]');
    if (!els.length) els = article.querySelectorAll("p");
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

  if (!isEconomistHostname(hostname)) {
    return {
      error: "Not an Economist URL",
      hint: "Use an article link from www.economist.com.",
      action: "bun-browser open https://www.economist.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    rubric: "",
    flyTitle: "",
    section: "",
    articleBody: "",
    source: "",
    finalUrl: raw,
    walled: null,
    isSubscriber: null,
    contentMeta: null,
    pagePropsMeta: null,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 250);
    if (openResult && openResult.hit && openResult.hit.nextData) {
      var openProps = getPageProps(openResult.hit.nextData);
      var openContent = getContent(openProps);
      applyContentMetadata(openContent, openProps, state);
      state.contentMeta = openContent;
      state.pagePropsMeta = openProps;
      if (!state.source) state.source = openResult.hit.source;
      state.finalUrl = location.href || raw;
      await applyNextDataRoute(openResult.hit.nextData, state, state.finalUrl);
    }
    if (openResult && openResult.domBody && openResult.domBody.length > (state.articleBody || "").length) {
      maybeSetBody(state, openResult.domBody, "dom");
    }
  }

  if (!hasFullArticleBody(state)) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open economist.com in Chrome first, then retry.",
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

    var nextData = parseNextDataFromDocument(doc);
    var pageProps = getPageProps(nextData);
    var content = getContent(pageProps);
    if (content) {
      applyContentMetadata(content, pageProps, state);
      state.contentMeta = content;
      state.pagePropsMeta = pageProps;
      if (!state.source) state.source = "nextData";
    }
    if (nextData) await applyNextDataRoute(nextData, state, state.finalUrl);

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

    if (!state.articleBody || isContentWalled(pageProps)) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  var contentForPaywall = state.contentMeta;
  var pagePropsForPaywall = state.pagePropsMeta;

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "The Economist paywall blocked content. Open the article in Chrome, wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      walled: state.walled,
      isSubscriber: state.isSubscriber,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody, pagePropsForPaywall, contentForPaywall)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article data was not found. Open economist.com in Chrome (with subscription if needed) and retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      author: state.author || null,
      publishedAt: state.publishedAt || null,
      section: state.section || null,
      rubric: state.rubric || null,
      preview: state.articleBody.slice(0, 500),
      walled: state.walled,
      isSubscriber: state.isSubscriber,
    };
  }

  var paywallBypassed =
    state.source === "nextDataRoute" ||
    (state.source !== "dom" && (state.isSubscriber === true || state.walled !== true));

  return {
    url: state.finalUrl,
    title: state.title || null,
    author: state.author || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    rubric: state.rubric || null,
    flyTitle: state.flyTitle || null,
    section: state.section || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
    walled: state.walled,
    isSubscriber: state.isSubscriber,
    paywallBypassed: paywallBypassed,
  };
}
