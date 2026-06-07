/* @meta
{
  "name": "nytimes/get-article",
  "description": "Read NYTimes article title, date, and body. Bypasses paywall via embedded page data (preloadedData), not the metered DOM preview.",
  "domain": "www.nytimes.com",
  "args": {
    "url": { "required": true, "description": "NYTimes article URL (www.nytimes.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site nytimes/get-article https://www.nytimes.com/2026/06/05/us/politics/trump-wisconsin-farmers-midterms.html"
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

  function isNytHostname(hostname) {
    return hostname === "nytimes.com" || hostname === "www.nytimes.com" || hostname.endsWith(".nytimes.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isNytHostname(ua.hostname) || !isNytHostname(ub.hostname)) return false;
      return ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
    } catch (e) {
      return false;
    }
  }

  function extractJsObjectLiteral(source, marker) {
    if (!source) return null;
    var start = source.indexOf(marker);
    if (start < 0) return null;
    var jsonStart = start + marker.length;
    var depth = 0;
    var inStr = false;
    var esc = false;
    var end = jsonStart;
    for (var i = jsonStart; i < source.length; i++) {
      var c = source[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
    }
    if (depth !== 0) return null;
    try {
      return new Function("return " + source.slice(jsonStart, end))();
    } catch (e) {
      return null;
    }
  }

  function getArticleFromPreloaded(preloaded) {
    if (!preloaded || !preloaded.initialData || !preloaded.initialData.data) return null;
    return preloaded.initialData.data.article || null;
  }

  function blockText(block) {
    if (!block || !block.__typename) return "";
    var type = block.__typename;
    if (type === "ParagraphBlock" || type.indexOf("Heading") === 0) {
      var parts = block.content || [];
      var text = "";
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && parts[i].text) text += parts[i].text;
      }
      return text.trim();
    }
    return "";
  }

  function extractSprinkledBody(article) {
    if (!article || !article.sprinkledBody || !article.sprinkledBody.content) return "";
    var blocks = article.sprinkledBody.content;
    var paragraphs = [];
    for (var i = 0; i < blocks.length; i++) {
      var text = blockText(blocks[i]);
      if (text) paragraphs.push(text);
    }
    return paragraphs.join("\n\n");
  }

  function extractAuthorsFromBylines(bylines) {
    if (!bylines || !bylines.length) return "";
    var names = [];
    for (var i = 0; i < bylines.length; i++) {
      var byline = bylines[i];
      if (byline.renderedRepresentation) {
        names.push(String(byline.renderedRepresentation).replace(/^By\s+/i, "").trim());
        continue;
      }
      var creators = byline.creators || [];
      for (var j = 0; j < creators.length; j++) {
        if (creators[j] && creators[j].displayName) names.push(String(creators[j].displayName));
      }
    }
    var unique = [];
    for (var k = 0; k < names.length; k++) {
      if (names[k] && unique.indexOf(names[k]) < 0) unique.push(names[k]);
    }
    return unique.join(", ");
  }

  function applyArticleMetadata(article, state) {
    if (!article) return;
    if (!state.title && article.headline && article.headline.default) state.title = String(article.headline.default);
    if (!state.publishedAt && article.firstPublished) state.publishedAt = String(article.firstPublished);
    if (!state.dateModified && article.lastModified) state.dateModified = String(article.lastModified);
    if (!state.description && article.summary) state.description = String(article.summary);
    if (!state.section && article.section && article.section.displayName) state.section = String(article.section.displayName);
    if (!state.author) state.author = extractAuthorsFromBylines(article.bylines);
    var body = extractSprinkledBody(article);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      state.source = state.source || "preloadedData";
    }
  }

  function isPaywallPreview(text) {
    if (!text) return true;
    if (/Want all of The Times/i.test(text)) return true;
    if (/^You have a preview/i.test(text)) return true;
    if (/Subscribe to continue/i.test(text)) return true;
    return false;
  }

  function extractDomBody(doc) {
    var body = doc.querySelector('section[name="articleBody"]') || doc.querySelector("section.meteredContent");
    if (!body) return "";
    var ps = body.querySelectorAll("p");
    var paragraphs = [];
    for (var i = 0; i < ps.length; i++) {
      var text = (ps[i].textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (/^Want all of The Times/i.test(text)) continue;
      paragraphs.push(text);
    }
    return paragraphs.join("\n\n");
  }

  function readPreloadedFromOpenPage() {
    var live = getArticleFromPreloaded(window.__preloadedData);
    if (live) return { article: live, source: "openPage" };

    var html = document.documentElement && document.documentElement.innerHTML;
    var parsed = extractJsObjectLiteral(html, "window.__preloadedData = ");
    var fromDom = getArticleFromPreloaded(parsed);
    if (fromDom) return { article: fromDom, source: "openPageHtml" };

    return null;
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      var hit = readPreloadedFromOpenPage();
      if (hit && hit.article) return hit;
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return readPreloadedFromOpenPage();
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

  if (!isNytHostname(hostname)) {
    return {
      error: "Not a NYTimes URL",
      hint: "Use an article link from www.nytimes.com.",
      action: "bun-browser open https://www.nytimes.com",
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
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openHit = await waitForOpenPageArticle(raw, 8, 200);
    if (openHit && openHit.article) {
      applyArticleMetadata(openHit.article, state);
      state.source = openHit.source;
      state.finalUrl = location.href || raw;
    }
  }

  if (!state.articleBody) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open nytimes.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");
    var preloaded = extractJsObjectLiteral(html, "window.__preloadedData = ");
    var article = getArticleFromPreloaded(preloaded);
    if (article) {
      applyArticleMetadata(article, state);
      if (!state.source) state.source = "preloadedData";
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

    if (!state.articleBody) {
      var domBody = extractDomBody(doc);
      if (domBody && !isPaywallPreview(domBody)) {
        state.articleBody = domBody;
        state.source = "dom";
      }
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "NYT paywall blocked visible content. Open the article in Chrome, then retry. Embedded page data was unavailable.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      publishedAt: state.publishedAt || null,
    };
  }

  if (isPaywallPreview(state.articleBody)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article data was not found in page source. Open nytimes.com in Chrome and retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
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
    section: state.section || null,
    articleBody: state.articleBody,
    bodyCharacterCount: state.articleBody.length,
    source: state.source || null,
    paywallBypassed: state.source !== "dom",
  };
}
