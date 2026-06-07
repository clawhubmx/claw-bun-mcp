/* @meta
{
  "name": "unherd/get-article",
  "description": "Read UnHerd article title, author, date, and body. Uses JSON-LD NewsArticle metadata and generic article DOM extraction.",
  "domain": "www.unherd.com",
  "args": {
    "url": { "required": true, "description": "UnHerd article URL (www.unherd.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site unherd/get-article https://www.unherd.com/"
}
*/

async function (args) {
  var cf = (function () {
    /**
     * Cloudflare challenge detection and browser-tab bypass helpers.
     * Installed on globalThis.__cloudflareHelpers — inlined by cloudflare/wait.js
     * and get-article adapters (via scripts/inject-cloudflare-module.mjs).
     */
    function installCloudflareHelpers() {
      var VERSION = 1;
    
      if (globalThis.__cloudflareHelpers && globalThis.__cloudflareHelpers.version === VERSION) {
        return globalThis.__cloudflareHelpers;
      }
    
      function sleep(ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      }
    
      function getDocText(doc, maxLen) {
        doc = doc || document;
        maxLen = maxLen || 8000;
        var titleEl = doc.querySelector("title");
        var title = titleEl ? titleEl.textContent || "" : "";
        var body = doc.body ? doc.body.innerText || doc.body.textContent || "" : "";
        var text = title + "\n" + body;
        return text.length > maxLen ? text.slice(0, maxLen) : text;
      }
    
      function detectChallenge(doc, htmlText) {
        doc = doc || document;
        htmlText = htmlText || (doc.documentElement && doc.documentElement.outerHTML) || "";
    
        if (
          doc.querySelector(
            '.cf-turnstile, #challenge-running, #cf-challenge-running, #cf-wrapper, #challenge-stage, ' +
              '.challenge-form, iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], ' +
              'form[action*="cdn-cgi/challenge"]'
          )
        ) {
          return { kind: "dom", reason: "cloudflare_challenge_element" };
        }
    
        var title = ((doc.querySelector("title") && doc.querySelector("title").textContent) || "").trim();
        if (/^just a moment/i.test(title)) return { kind: "title", reason: "just_a_moment" };
        if (/attention required/i.test(title)) return { kind: "title", reason: "attention_required" };
    
        var text = getDocText(doc, 6000);
        if (/enable javascript and cookies to continue/i.test(text)) return { kind: "text", reason: "enable_js_cookies" };
        if (/verify you are human/i.test(text)) return { kind: "text", reason: "verify_human" };
        if (/checking if the site connection is secure/i.test(text)) return { kind: "text", reason: "checking_connection" };
        if (/cf-browser-verification/i.test(text)) return { kind: "text", reason: "cf_browser_verification" };
        if (/performing security verification/i.test(text)) return { kind: "text", reason: "security_verification" };
        if (/ddos protection by cloudflare/i.test(text)) return { kind: "text", reason: "ddos_protection" };
        if (/challenge-platform/i.test(htmlText) && /cdn-cgi\/challenge/i.test(htmlText)) {
          return { kind: "html", reason: "challenge_platform" };
        }
        return null;
      }
    
      function isChallenge(doc, htmlText) {
        return !!detectChallenge(doc, htmlText);
      }
    
      function tryClickChallenge(doc) {
        doc = doc || document;
        var clicked = false;
        var selectors = [
          "#challenge-stage input[type='checkbox']",
          ".ctp-checkbox-label",
          "label.ctp-checkbox-label",
          ".cf-turnstile",
          "#cf-turnstile",
          ".challenge-form button",
          "#challenge-body button",
        ];
    
        for (var i = 0; i < selectors.length; i++) {
          var el = doc.querySelector(selectors[i]);
          if (!el) continue;
          try {
            el.click();
            clicked = true;
          } catch (e) {}
        }
    
        var turnstile = doc.querySelector(".cf-turnstile, [data-sitekey]");
        if (turnstile) {
          try {
            turnstile.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
            );
            clicked = true;
          } catch (e2) {}
        }
    
        return clicked;
      }
    
      async function waitForClearance(opts) {
        opts = opts || {};
        var maxWaitMs = Number(opts.maxWaitMs) || 30000;
        var pollMs = Number(opts.pollMs) || 500;
        var url = opts.url || null;
        var autoClick = opts.autoClick !== false;
        var reloadOnce = opts.reloadOnce === true;
        var start = Date.now();
        var attempts = 0;
        var clicked = false;
        var reloaded = false;
    
        if (url) {
          try {
            var target = new URL(url, location.href);
            var samePath =
              location.pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, "") &&
              location.hostname === target.hostname;
            if (!samePath || !location.href) {
              location.href = target.href;
              await sleep(Math.min(pollMs * 4, 2500));
            }
          } catch (e) {}
        }
    
        while (Date.now() - start < maxWaitMs) {
          attempts++;
          var challenge = detectChallenge(document, document.documentElement ? document.documentElement.outerHTML : "");
          if (!challenge) {
            return {
              cleared: true,
              waitedMs: Date.now() - start,
              attempts: attempts,
              url: location.href,
            };
          }
    
          if (autoClick && attempts % 3 === 1) {
            clicked = tryClickChallenge(document) || clicked;
          }
    
          if (reloadOnce && !reloaded && Date.now() - start > maxWaitMs * 0.65) {
            reloaded = true;
            try {
              location.reload();
              await sleep(2500);
            } catch (e3) {}
          }
    
          await sleep(pollMs);
        }
    
        var still = detectChallenge(document, document.documentElement ? document.documentElement.outerHTML : "");
        return {
          cleared: !still,
          waitedMs: Date.now() - start,
          attempts: attempts,
          url: location.href,
          challenge: still,
          hint: still
            ? "Cloudflare challenge did not clear in time. Open the URL in Chrome and complete verification, or run: bun-browser site cloudflare/wait <url>"
            : null,
        };
      }
    
      async function fetchAfterClearance(url, fetchOpts, waitOpts) {
        var wait = await waitForClearance(Object.assign({ url: url }, waitOpts || {}));
        if (!wait.cleared) {
          return { ok: false, error: "cloudflare_not_cleared", wait: wait };
        }
    
        try {
          var resp = await fetch(url, Object.assign({ credentials: "include", redirect: "follow" }, fetchOpts || {}));
          var html = await resp.text();
          var parsed = new DOMParser().parseFromString(html, "text/html");
          if (isChallenge(parsed, html)) {
            return { ok: false, error: "cloudflare_in_response", status: resp.status, wait: wait };
          }
          return { ok: true, response: resp, html: html, status: resp.status, url: resp.url, wait: wait };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e), wait: wait };
        }
      }
    
      var api = {
        version: VERSION,
        sleep: sleep,
        detectChallenge: detectChallenge,
        isChallenge: isChallenge,
        tryClickChallenge: tryClickChallenge,
        waitForClearance: waitForClearance,
        fetchAfterClearance: fetchAfterClearance,
      };
    
      globalThis.__cloudflareHelpers = api;
      return api;
    }
    return installCloudflareHelpers();
  })();
  var SITE_ROOT = "unherd.com";
  var SITE_HOSTS = ["unherd.com","www.unherd.com"];

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

  function isSiteHostname(hostname) {
    for (var i = 0; i < SITE_HOSTS.length; i++) {
      if (hostname === SITE_HOSTS[i]) return true;
    }
    return hostname.endsWith("." + SITE_ROOT);
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isSiteHostname(ua.hostname) || !isSiteHostname(ub.hostname)) return false;
      return ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch (e) {
      return false;
    }
  }

  function buildFetchUrl(url) {
    try {
      var target = new URL(url);
      if (isSiteHostname(location.hostname) && isSiteHostname(target.hostname)) {
        return target.pathname + target.search + target.hash;
      }
    } catch (e) {}
    return url;
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
    if (!t || t.length < 20) return true;
    if (/^Advertisement$/i.test(t)) return true;
    if (/^Skip to (main )?content$/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Subscribe to /i.test(t) && t.length < 320) return true;
    if (/^Share (this )?on /i.test(t) && t.length < 120) return true;
    if (/^Related (articles|stories|content)$/i.test(t)) return true;
    if (/^Recommended Reading$/i.test(t)) return true;
    if (/^Read more$/i.test(t)) return true;
    if (/^Comments$/i.test(t)) return true;
    if (/^Cookie (policy|preferences)$/i.test(t)) return true;
    if (/^Listen to this article$/i.test(t)) return true;
    if (/^Updated /i.test(t) && t.length < 60) return true;
    if (/^Published /i.test(t) && t.length < 80) return true;
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

  function isBotChallenge(doc, htmlText) {
    return cf.isChallenge(doc, htmlText || (doc && doc.documentElement ? doc.documentElement.outerHTML : ""));
  }

  function isPaywallPreview(text) {
    if (!text) return true;
    if (text.length >= 1200) return false;
    if (/subscribe to (read|continue|unlock)/i.test(text) && text.length < 900) return true;
    if (/^This article is for subscribers only/i.test(text)) return true;
    if (/^Already a subscriber\?/i.test(text) && text.length < 500) return true;
    return false;
  }

  function shouldSkipNode(el) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG" || tag === "IFRAME") return true;
    var id = el.id ? String(el.id) : "";
    var cls = el.className ? String(el.className) : "";
    var blob = (id + " " + cls).toLowerCase();
    if (/\bad-\b|\bad_\b|\badvertisement\b|\badvertising\b|\badslot\b|\bad-container\b|newsletter|signup|paywall|related-posts|recommended|sidebar|comment|social-share|share-bar|promo|subscription|most-popular|trending|footer|nav-|breadcrumb|byline-share|author-bio|tags-list|tag-list|read-next|more-stories|outbrain|taboola|sponsor|partner-content|embed-|video-player|caption-text-only/i.test(blob)) {
      return true;
    }
    if (el.closest && el.closest("aside, nav, footer, header, [role='complementary'], [aria-label*='advertisement' i], [data-ad], [class*=' ad-'], [class^='ad-'], [id^='ad-']")) {
      return true;
    }
    return false;
  }

  function extractElementText(el) {
    if (!el || shouldSkipNode(el)) return "";
    var skipTags = { STYLE: 1, SCRIPT: 1, NOSCRIPT: 1, SVG: 1, IFRAME: 1, FIGURE: 1, ASIDE: 1, NAV: 1 };
    var rootDoc = el.ownerDocument || document;
    var walker = rootDoc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
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

  function findArticleRoot(root) {
    if (!root) return null;
    var selectors = [
      "[itemprop='articleBody']",
      "article .article-body",
      "article .story-body",
      "article .article-content",
      "article .article__body",
      "article .entry-content",
      "article .post-content",
      "article .content-body",
      "article .rich-text",
      "article .c-article-body",
      "article .article-body-content",
      "article .ArticleBody",
      "article .article-content__body",
      "article .article__content",
      "article .article-text",
      "article .story-content",
      "article .body-content",
      "article",
      "[role='main'] article",
      "main article",
      "[role='main']",
      "main",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      if (!el) continue;
      var ps = el.querySelectorAll("p");
      if (ps.length >= 2) return el;
      if (selectors[i].indexOf("article") >= 0 && ps.length >= 1) return el;
    }
    return null;
  }

  function extractDomBody(root) {
    var content = findArticleRoot(root);
    if (!content) return "";

    var blocks = [];
    var els = content.querySelectorAll("p, h2, h3, h4, ul, ol, blockquote");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (shouldSkipNode(el)) continue;
      var tag = el.tagName;
      if (tag === "P" || /^H[2-4]$/.test(tag)) {
        var text = extractElementText(el);
        if (text && text.length >= 25) blocks.push(text);
      } else if (tag === "UL" || tag === "OL") {
        var listLines = extractListItems(el, tag === "OL");
        if (listLines.length) blocks.push(listLines.join("\n"));
      } else if (tag === "BLOCKQUOTE") {
        var quote = extractElementText(el);
        if (quote) blocks.push(quote);
      }
    }

    return sanitizeArticleBody(blocks.join("\n\n"));
  }

  function extractTitle(root) {
    if (!root) return "";
    var h1 = root.querySelector("article h1, main h1, h1");
    if (h1) return normalizeWhitespace(h1.textContent);
    var og = root.querySelector('meta[property="og:title"]');
    if (og) return normalizeWhitespace(og.getAttribute("content") || "");
    return "";
  }

  function extractAuthor(root) {
    if (!root) return "";
    var rel = root.querySelector('[rel="author"], .author a, .byline a, .article-byline a, [itemprop="author"]');
    if (rel) return normalizeWhitespace(rel.textContent);
    var meta = root.querySelector('meta[name="author"], meta[property="article:author"]');
    if (meta) return normalizeWhitespace(meta.getAttribute("content") || "");
    var byline = root.querySelector(".byline, .article-byline, .author-name");
    if (byline) return normalizeWhitespace(byline.textContent).replace(/^By\s+/i, "");
    return "";
  }

  function extractPublishedAt(root) {
    if (!root) return "";
    var timeEl = root.querySelector("article time[datetime], main time[datetime], time[datetime]");
    if (timeEl) return (timeEl.getAttribute("datetime") || "").trim();
    var meta = root.querySelector('meta[property="article:published_time"], meta[name="pubdate"], meta[name="date"], meta[itemprop="datePublished"]');
    if (meta) return (meta.getAttribute("content") || "").trim();
    return "";
  }

  function extractDescription(root) {
    if (!root) return "";
    var deck = root.querySelector("article .dek, article .subhead, article .standfirst, .article-dek, .story-dek");
    if (deck) return normalizeWhitespace(deck.textContent);
    var ogd = root.querySelector('meta[property="og:description"], meta[name="description"]');
    if (ogd) return normalizeWhitespace(ogd.getAttribute("content") || "");
    return "";
  }

  function applyJsonLdMetadata(items, state) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || typeof item !== "object") continue;
      var t = item["@type"];
      var types = Array.isArray(t) ? t : [t];
      var isArticle = false;
      for (var k = 0; k < types.length; k++) {
        if (types[k] === "NewsArticle" || types[k] === "Article" || types[k] === "BlogPosting") {
          isArticle = true;
          break;
        }
      }
      if (!isArticle) continue;

      if (!state.title && item.headline) state.title = normalizeWhitespace(String(item.headline));
      if (!state.publishedAt && item.datePublished) state.publishedAt = String(item.datePublished);
      if (!state.dateModified && item.dateModified) state.dateModified = String(item.dateModified);
      if (!state.description && item.description) state.description = normalizeWhitespace(String(item.description));

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

  function applyMetaTags(doc, state) {
    if (!state.title) state.title = extractTitle(doc);
    if (!state.description) state.description = extractDescription(doc);
    if (!state.publishedAt) state.publishedAt = extractPublishedAt(doc);
    if (!state.author) state.author = extractAuthor(doc);
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      if (isBotChallenge(document)) {
        await cf.waitForClearance({ maxWaitMs: Math.max(delayMs * attempts * 2, 8000), pollMs: delayMs, autoClick: true });
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
          domBody: domBody,
        };
      }
      await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
    return {
      title: extractTitle(document),
      author: extractAuthor(document),
      publishedAt: extractPublishedAt(document),
      description: extractDescription(document),
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

  if (!isSiteHostname(parsedUrl.hostname)) {
    return {
      error: "Not a UnHerd URL",
      hint: "Use an article link from www.unherd.com.",
      action: "bun-browser open https://www.unherd.com",
    };
  }

  var state = {
    title: "",
    author: "",
    publishedAt: "",
    dateModified: "",
    description: "",
    articleBody: "",
    source: "",
    finalUrl: raw,
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 300);
    if (openResult) {
      if (openResult.title) state.title = openResult.title;
      if (openResult.author) state.author = openResult.author;
      if (openResult.publishedAt) state.publishedAt = openResult.publishedAt;
      if (openResult.description) state.description = openResult.description;
      if (openResult.domBody) {
        maybeSetBody(state, openResult.domBody, "openPage");
        state.finalUrl = location.href || raw;
      }
    }
    applyJsonLdFromDocument(document, state);
    applyMetaTags(document, state);
  }

    if (!state.articleBody || !state.title) {
    if (!onArticlePage || isBotChallenge(document)) {
      await cf.waitForClearance({ url: raw, maxWaitMs: 25000, pollMs: 500, autoClick: true });
    }

    var fetchUrl = buildFetchUrl(raw);
    var resp = await fetch(fetchUrl, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      if ((resp.status === 403 || resp.status === 503) && isBotChallenge(document)) {
        var cfBypass = await cf.waitForClearance({ url: raw, maxWaitMs: 30000, autoClick: true });
        if (cfBypass.cleared) {
          resp = await fetch(fetchUrl, { credentials: "include", redirect: "follow" });
        }
      }
      if (!resp.ok) {
        return {
          error: "HTTP " + resp.status,
          hint: "Article may be unavailable. Open www.unherd.com in Chrome first, then retry.",
          action: "bun-browser open " + raw,
        };
      }
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");

    if (isBotChallenge(doc, html)) {
      var cfRetry = await cf.waitForClearance({ url: raw, maxWaitMs: 30000, autoClick: true });
      if (cfRetry.cleared) {
        resp = await fetch(fetchUrl, { credentials: "include", redirect: "follow" });
        html = await resp.text();
        doc = new DOMParser().parseFromString(html, "text/html");
      }
    }

    if (isBotChallenge(doc, html)) {
      return {
        error: "Cloudflare challenge blocked fetch",
        hint: "Run bun-browser site cloudflare/wait on the article URL, wait for clearance, then retry get-article.",
        action: "bun-browser site cloudflare/wait " + raw,
        title: state.title || null,
      };
    }

    applyJsonLdFromDocument(doc, state);
    applyMetaTags(doc, state);

    if (!state.articleBody) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract article body",
      hint: "Page may be paywalled or use an unsupported layout. Open the article in Chrome, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article body was not found. Open the article in Chrome (with subscription if needed) and retry.",
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
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
  };
}
