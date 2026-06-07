/* @meta
{
  "name": "stonex/get-article",
  "description": "Read StoneX insights article title, author, date, topics, and body. Parses NewsArticle JSON-LD metadata and article DOM (font-body-md-regular paragraphs before the legal disclaimer).",
  "domain": "www.stonex.com",
  "args": {
    "url": { "required": true, "description": "StoneX insights article URL (www.stonex.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site stonex/get-article https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/"
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

  function isStonexHostname(hostname) {
    return hostname === "stonex.com" || hostname === "www.stonex.com" || hostname.endsWith(".stonex.com");
  }

  function isInsightsPath(pathname) {
    return /\/insights\//i.test(String(pathname || ""));
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isStonexHostname(ua.hostname) || !isStonexHostname(ub.hostname)) return false;
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

  function isDisclaimerParagraph(text) {
    if (!text) return false;
    return (
      /This material should be construed as market commentary/i.test(text) ||
      /StoneX Financial Ltd \(SFL\) is registered in England and Wales/i.test(text) ||
      /StoneX Financial Inc\. \(SFI\) is a member of FINRA/i.test(text) ||
      /The report\/analysis herein is not directed to, or intended for distribution/i.test(text)
    );
  }

  function isRelatedSectionHeading(text) {
    if (!text) return false;
    return /^Discover more insights$/i.test(text) || /^Related articles/i.test(text);
  }

  function isBoilerplateParagraph(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (t.length < 15) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Cookie Policy$/i.test(t)) return true;
    if (/^Accept all cookies$/i.test(t)) return true;
    if (/^By clicking .Accept all cookies/i.test(t)) return true;
    if (/^We provide our clients with the global market access/i.test(t)) return true;
    if (/^Explore StoneX/i.test(t) && t.length < 220) return true;
    if (/^Access our global commodities/i.test(t) && t.length < 220) return true;
    if (/^As a globally recognised financial services company/i.test(t)) return true;
    if (/^Catch up on expert commodities analysis/i.test(t)) return true;
    if (/^Our subscribers have access to comprehensive market analysis/i.test(t)) return true;
    if (/^Our market expertise, advanced platforms/i.test(t)) return true;
    if (/^With access to 40\+ derivatives exchanges/i.test(t)) return true;
    if (/^As a publicly traded company meeting the highest standards/i.test(t)) return true;
    if (/^From our proprietary Market Intelligence platform/i.test(t)) return true;
    if (/^StoneX: We open markets$/i.test(t)) return true;
    if (isDisclaimerParagraph(t)) return true;
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

  function isCloudflareChallenge(doc) {
    if (!doc) return false;
    var title = (doc.querySelector("title")?.textContent || "").trim();
    if (/just a moment/i.test(title)) return true;
    if (doc.body && /Enable JavaScript and cookies to continue/i.test(doc.body.textContent || "")) return true;
    return false;
  }

  function findArticleHeaderSection(root) {
    if (!root) return null;
    var main = root.querySelector("main");
    if (!main) return null;
    var sections = main.children || [];
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].querySelector("h1")) return sections[i];
    }
    return null;
  }

  function findArticleContentSection(root) {
    if (!root) return null;
    var main = root.querySelector("main");
    if (!main) return null;
    var sections = main.children || [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var byline = section.querySelector("p.font-body-lg-bold");
      if (byline && /^By:/i.test(normalizeWhitespace(byline.textContent))) return section;
      var ps = section.querySelectorAll("p");
      for (var j = 0; j < ps.length; j++) {
        if (isDisclaimerParagraph(ps[j].textContent)) return section;
      }
    }
    return null;
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
    var section = findArticleContentSection(root);
    if (!section) return "";

    var blocks = [];
    var stop = false;
    var els = section.querySelectorAll("p, h2, h3, h4, ul, ol");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (stop) break;

      var tag = el.tagName;
      if (tag === "H2" || tag === "H3" || tag === "H4") {
        var heading = normalizeWhitespace(el.textContent);
        if (isRelatedSectionHeading(heading)) {
          stop = true;
          break;
        }
        if (heading) blocks.push(heading);
        continue;
      }

      if (tag === "UL" || tag === "OL") {
        var listLines = extractListItems(el, tag === "OL");
        if (listLines.length) blocks.push(listLines.join("\n"));
        continue;
      }

      if (tag === "P") {
        var cls = el.className ? String(el.className) : "";
        if (/font-body-lg-bold/i.test(cls)) continue;
        var raw = normalizeWhitespace(el.textContent);
        if (isDisclaimerParagraph(raw)) {
          stop = true;
          break;
        }
        var text = extractElementText(el);
        if (text) blocks.push(text);
      }
    }

    return sanitizeArticleBody(blocks.join("\n\n"));
  }

  function parseByline(text) {
    var cleaned = normalizeWhitespace(text).replace(/^By:\s*/i, "");
    if (!cleaned) return { author: "", role: "" };
    var comma = cleaned.indexOf(",");
    if (comma > 0) {
      return {
        author: cleaned.slice(0, comma).trim(),
        role: cleaned.slice(comma + 1).trim(),
      };
    }
    return { author: cleaned, role: "" };
  }

  function extractByline(root) {
    var section = findArticleContentSection(root);
    if (!section) return { author: "", role: "" };
    var bylineEl = section.querySelector("p.font-body-lg-bold");
    if (!bylineEl) return { author: "", role: "" };
    return parseByline(bylineEl.textContent);
  }

  function extractTitle(root) {
    var header = findArticleHeaderSection(root);
    if (header) {
      var h1 = header.querySelector("h1");
      if (h1) return normalizeWhitespace(h1.textContent);
    }
    var h1 = root.querySelector("h1");
    return h1 ? normalizeWhitespace(h1.textContent) : "";
  }

  function extractPublishedAt(root) {
    var section = findArticleContentSection(root) || findArticleHeaderSection(root) || root;
    var timeEl = section.querySelector("time[datetime]");
    return timeEl ? (timeEl.getAttribute("datetime") || "").trim() : "";
  }

  function extractSection(root) {
    var header = findArticleHeaderSection(root);
    if (!header) return "";
    var links = header.querySelectorAll("nav a, a");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      var text = normalizeWhitespace(links[i].textContent);
      if (text && /\/insights\/?$/i.test(href)) return text;
    }
    return "Insights";
  }

  function extractTopicsFromLd(about) {
    if (!about) return [];
    var items = Array.isArray(about) ? about : [about];
    var topics = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) continue;
      if (typeof item === "string") topics.push(item);
      else if (item.name) topics.push(String(item.name));
    }
    var unique = [];
    for (var j = 0; j < topics.length; j++) {
      if (topics[j] && unique.indexOf(topics[j]) < 0) unique.push(topics[j]);
    }
    return unique;
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

      if (!state.title && item.headline) state.title = normalizeWhitespace(String(item.headline));
      if (!state.publishedAt && item.datePublished) state.publishedAt = String(item.datePublished);
      if (!state.dateModified && item.dateModified) state.dateModified = String(item.dateModified);
      if (!state.description && item.description) state.description = normalizeWhitespace(String(item.description));
      if ((!state.topics || !state.topics.length) && item.about) state.topics = extractTopicsFromLd(item.about);

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
        if (state.articleBody) state.source = "jsonLd";
      }
    }
  }

  function applyJsonLdFromDocument(doc, state) {
    if (!doc) return;
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      try {
        var j = JSON.parse(scripts[s].textContent || "{}");
        applyJsonLdMetadata(flattenLd(j), state);
      } catch (e) {}
    }
  }

  function applyHtmlMetadata(doc, state) {
    if (!state.title) {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og) state.title = normalizeWhitespace(og.getAttribute("content") || "");
    }
    if (!state.description) {
      var ogd = doc.querySelector('meta[property="og:description"], meta[name="description"]');
      if (ogd) state.description = normalizeWhitespace(ogd.getAttribute("content") || "");
    }
    if (!state.publishedAt) state.publishedAt = extractPublishedAt(doc);
    if (!state.author) {
      var byline = extractByline(doc);
      if (byline.author) state.author = byline.author;
      if (byline.role && !state.authorRole) state.authorRole = byline.role;
    }
    if (!state.section) state.section = extractSection(doc);
    if (!state.canonicalUrl) {
      var canonical = doc.querySelector('link[rel="canonical"]');
      if (canonical) state.canonicalUrl = (canonical.getAttribute("href") || "").trim();
    }
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      if (isCloudflareChallenge(document)) {
        await new Promise(function (resolve) {
          setTimeout(resolve, delayMs);
        });
        continue;
      }
      var domBody = extractDomBody(document);
      var title = extractTitle(document);
      if (domBody || title) {
        var byline = extractByline(document);
        return {
          title: title,
          author: byline.author,
          authorRole: byline.role,
          publishedAt: extractPublishedAt(document),
          section: extractSection(document),
          domBody: domBody,
        };
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    var bylineFinal = extractByline(document);
    return {
      title: extractTitle(document),
      author: bylineFinal.author,
      authorRole: bylineFinal.role,
      publishedAt: extractPublishedAt(document),
      section: extractSection(document),
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

  var parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch (e) {
    return { error: "Invalid url" };
  }

  if (!isStonexHostname(parsedUrl.hostname)) {
    return {
      error: "Not a StoneX URL",
      hint: "Use an article link from www.stonex.com.",
      action: "bun-browser open https://www.stonex.com/en-gb/insights/",
    };
  }

  if (!isInsightsPath(parsedUrl.pathname)) {
    return {
      error: "Not a StoneX insights article URL",
      hint: "Use a link under /insights/ on www.stonex.com.",
      action: "bun-browser open https://www.stonex.com/en-gb/insights/",
    };
  }

  var state = {
    title: "",
    author: "",
    authorRole: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    section: "",
    topics: [],
    canonicalUrl: "",
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 12, 300);
    if (openResult) {
      if (openResult.title) state.title = openResult.title;
      if (openResult.author) state.author = openResult.author;
      if (openResult.authorRole) state.authorRole = openResult.authorRole;
      if (openResult.publishedAt) state.publishedAt = openResult.publishedAt;
      if (openResult.section) state.section = openResult.section;
      if (openResult.domBody) {
        maybeSetBody(state, openResult.domBody, "openPage");
        state.finalUrl = location.href || raw;
      }
    }
    applyJsonLdFromDocument(document, state);
    applyHtmlMetadata(document, state);
  }

  if (!state.articleBody || !state.title) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open stonex.com in Chrome first, then retry.",
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

    applyJsonLdFromDocument(doc, state);
    applyHtmlMetadata(doc, state);

    if (!state.title) state.title = extractTitle(doc);
    if (!state.author) {
      var bylineDoc = extractByline(doc);
      if (bylineDoc.author) state.author = bylineDoc.author;
      if (bylineDoc.role) state.authorRole = bylineDoc.role;
    }
    if (!state.publishedAt) state.publishedAt = extractPublishedAt(doc);
    if (!state.section) state.section = extractSection(doc);

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract article body",
      hint: "StoneX page did not expose article paragraphs. Open the article in Chrome, wait for it to load, then retry.",
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
    authorRole: state.authorRole || null,
    publishedAt: state.publishedAt || null,
    dateModified: state.dateModified || null,
    description: state.description || null,
    section: state.section || null,
    topics: state.topics && state.topics.length ? state.topics : null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
