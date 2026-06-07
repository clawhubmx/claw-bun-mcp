/* @meta
{
  "name": "medium/get-article",
  "description": "读取 Medium 文章正文与元数据 (get article: title, author, publishedAt, articleBody, url)",
  "domain": "medium.com",
  "args": {
    "url": { "required": true, "description": "Medium post URL (medium.com or *.medium.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site medium/get-article https://medium.com/@user/some-post-slug"
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
      var VERSION = 4;
    
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
    
      var HOLD_CHALLENGE_REASONS = {
        press_and_hold: 1,
        hold_to_confirm: 1,
        px_captcha: 1,
        robot_check: 1,
        fortress_challenge: 1,
      };
    
      function isHoldChallengeReason(reason) {
        return !!HOLD_CHALLENGE_REASONS[reason];
      }
    
      function queryAllDeep(root, selector) {
        var out = [];
        function walk(node) {
          if (!node || !node.querySelectorAll) return;
          var els = node.querySelectorAll(selector);
          for (var i = 0; i < els.length; i++) out.push(els[i]);
          var all = node.querySelectorAll("*");
          for (var j = 0; j < all.length; j++) {
            if (all[j].shadowRoot) walk(all[j].shadowRoot);
          }
        }
        walk(root);
        return out;
      }
    
      function detectChallenge(doc, htmlText) {
        doc = doc || document;
        htmlText = htmlText || (doc.documentElement && doc.documentElement.outerHTML) || "";
    
        if (
          doc.querySelector(
            '#px-captcha, [id*="px-captcha"], .px-captcha, [class*="px-captcha"], ' +
              '[data-px-block], iframe[src*="captcha.px-cloud.net"], iframe[src*="perimeterx"]'
          ) ||
          /px-captcha|perimeterx|human challenge/i.test(htmlText)
        ) {
          return { kind: "dom", reason: "px_captcha" };
        }
    
        if (
          doc.querySelector(
            '.cf-turnstile, #challenge-running, #cf-challenge-running, #cf-wrapper, #challenge-stage, ' +
              '.challenge-form, .cb-lb, .cb-i, #verifying-i, #challenge-spinner, ' +
              'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], ' +
              'form[action*="cdn-cgi/challenge"]'
          )
        ) {
          return { kind: "dom", reason: "cloudflare_challenge_element" };
        }
    
        var title = ((doc.querySelector("title") && doc.querySelector("title").textContent) || "").trim();
        if (/^just a moment/i.test(title)) return { kind: "title", reason: "just_a_moment" };
        if (/attention required/i.test(title)) return { kind: "title", reason: "attention_required" };
    
        var text = getDocText(doc, 6000);
        if (/press\s*(?:&|and)\s*hold/i.test(text)) return { kind: "text", reason: "press_and_hold" };
        if (/hold\s+(?:the\s+)?button/i.test(text)) return { kind: "text", reason: "hold_to_confirm" };
        if (/hold\s+to\s+confirm/i.test(text)) return { kind: "text", reason: "hold_to_confirm" };
        if (/are you a robot/i.test(text)) return { kind: "text", reason: "robot_check" };
        if (/before we continue/i.test(text) && /robot|human|verify/i.test(text)) {
          return { kind: "text", reason: "robot_check" };
        }
        if (/enable javascript and cookies to continue/i.test(text)) return { kind: "text", reason: "enable_js_cookies" };
        if (/verify you are human/i.test(text)) return { kind: "text", reason: "verify_human" };
        if (/checking if the site connection is secure/i.test(text)) return { kind: "text", reason: "checking_connection" };
        if (/cf-browser-verification/i.test(text)) return { kind: "text", reason: "cf_browser_verification" };
        if (/performing security verification/i.test(text)) return { kind: "text", reason: "security_verification" };
        if (/ddos protection by cloudflare/i.test(text)) return { kind: "text", reason: "ddos_protection" };
        if (/challenge-platform/i.test(htmlText) && /cdn-cgi\/challenge/i.test(htmlText)) {
          return { kind: "html", reason: "challenge_platform" };
        }
        if (/fortress/i.test(htmlText) && /press\s*(?:&|and)\s*hold|are you a robot|captcha/i.test(text + htmlText)) {
          return { kind: "html", reason: "fortress_challenge" };
        }
        return null;
      }
    
      function isChallenge(doc, htmlText) {
        return !!detectChallenge(doc, htmlText);
      }
    
      function findHoldButton(doc) {
        doc = doc || document;
        if (!doc.body && !doc.documentElement) return null;
    
        var containers = queryAllDeep(
          doc,
          '#px-captcha, [id*="px-captcha"], .px-captcha, #cf-wrapper, #challenge-stage, ' +
            '.cf-turnstile, [class*="fortress"], [class*="captcha-container"], [class*="robot"]'
        );
        var searchRoots = containers.length ? containers : [doc.body || doc.documentElement];
        var candidates = [];
    
        for (var r = 0; r < searchRoots.length; r++) {
          var buttons = queryAllDeep(
            searchRoots[r],
            'button, [role="button"], a[href="#"], div[tabindex="0"], input[type="button"], span[tabindex="0"]'
          );
          for (var i = 0; i < buttons.length; i++) {
            var el = buttons[i];
            var label = (
              el.innerText ||
              el.textContent ||
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              ""
            ).trim();
            var rect = el.getBoundingClientRect();
            if (rect.width < 16 || rect.height < 12) continue;
            var score = 0;
            if (/press|hold|confirm|verify|human|robot|not a bot/i.test(label)) score += 10;
            if (containers.length && containers.indexOf(searchRoots[r]) >= 0) score += 4;
            if (rect.width >= 80 && rect.height >= 28) score += 2;
            if (score > 0) candidates.push({ el: el, score: score });
          }
        }
    
        if (!candidates.length) {
          var pageText = getDocText(doc, 4000);
          if (/press|hold|robot|verify you are human/i.test(pageText)) {
            var fallback = queryAllDeep(doc, "button, [role='button']");
            for (var k = 0; k < fallback.length; k++) {
              var btn = fallback[k];
              var br = btn.getBoundingClientRect();
              if (br.width >= 80 && br.height >= 28) candidates.push({ el: btn, score: 3 });
            }
          }
        }
    
        candidates.sort(function (a, b) {
          return b.score - a.score;
        });
        return candidates.length ? candidates[0].el : null;
      }
    
      function pointerCoords(el) {
        var rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    
      function dispatchPointer(el, type, coords, buttons) {
        var init = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: coords.x,
          clientY: coords.y,
          button: 0,
          buttons: buttons || 0,
        };
        try {
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: coords.x,
              clientY: coords.y,
              button: 0,
              buttons: buttons || 0,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
            })
          );
        } catch (e) {}
        try {
          el.dispatchEvent(new MouseEvent(type, init));
        } catch (e2) {}
      }
    
      async function dispatchHold(el, holdMs) {
        if (!el) return false;
        try {
          if (typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
          }
          if (typeof el.focus === "function") el.focus();
        } catch (e) {}
    
        var coords = pointerCoords(el);
        dispatchPointer(el, "pointerdown", coords, 1);
        dispatchPointer(el, "mousedown", coords, 1);
    
        var elapsed = 0;
        var step = 250;
        while (elapsed < holdMs) {
          await sleep(step);
          elapsed += step;
          coords.x += (Math.random() - 0.5) * 1.5;
          coords.y += (Math.random() - 0.5) * 1.5;
          dispatchPointer(el, "mousemove", coords, 1);
        }
    
        dispatchPointer(el, "pointerup", coords, 0);
        dispatchPointer(el, "mouseup", coords, 0);
        try {
          el.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: coords.x,
              clientY: coords.y,
              button: 0,
            })
          );
        } catch (e3) {}
        return true;
      }
    
      async function tryKeyboardHold(el, holdMs) {
        if (!el) return false;
        var keys = [" ", "Enter"];
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          try {
            if (typeof el.focus === "function") el.focus();
            el.dispatchEvent(
              new KeyboardEvent("keydown", { key: key, code: key === " " ? "Space" : "Enter", bubbles: true, cancelable: true })
            );
            await sleep(holdMs);
            el.dispatchEvent(
              new KeyboardEvent("keyup", { key: key, code: key === " " ? "Space" : "Enter", bubbles: true, cancelable: true })
            );
            return true;
          } catch (e) {}
        }
        return false;
      }
    
      async function tryTabToHoldButton(doc, holdMs) {
        doc = doc || document;
        var body = doc.body || doc.documentElement;
        if (!body) return false;
        try {
          if (typeof body.focus === "function") body.focus();
        } catch (e) {}
        for (var i = 0; i < 20; i++) {
          try {
            doc.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true })
            );
          } catch (e2) {}
          await sleep(80);
          var active = doc.activeElement;
          if (!active || active === body) continue;
          var label = (
            active.innerText ||
            active.textContent ||
            active.getAttribute("aria-label") ||
            ""
          ).trim();
          if (/press|hold|confirm|verify|human|robot/i.test(label)) {
            return (await tryKeyboardHold(active, holdMs)) || (await dispatchHold(active, holdMs));
          }
        }
        return false;
      }
    
      async function tryHoldChallenge(doc, opts) {
        opts = opts || {};
        doc = doc || document;
        var holdMs = Number(opts.holdMs) || 12000;
        var btn = findHoldButton(doc);
    
        if (btn) {
          var held = await dispatchHold(btn, holdMs);
          if (held) {
            await sleep(Math.min(2000, holdMs / 4));
            if (!isChallenge(doc)) return true;
            if (await tryKeyboardHold(btn, holdMs)) return true;
          }
        }
    
        return (await tryTabToHoldButton(doc, holdMs)) || false;
      }
    
      function tryClickByHumanLabel(doc) {
        doc = doc || document;
        var clicked = false;
        var labels = queryAllDeep(doc, "label, span, div, p");
        for (var i = 0; i < labels.length; i++) {
          var el = labels[i];
          var text = (el.innerText || el.textContent || "").trim();
          if (!/verify you are human/i.test(text)) continue;
          var rect = el.getBoundingClientRect();
          if (rect.width < 8 || rect.height < 8) continue;
          try {
            el.click();
            clicked = true;
          } catch (e) {}
          var coords = pointerCoords(el);
          dispatchPointer(el, "pointerdown", coords, 1);
          dispatchPointer(el, "pointerup", coords, 0);
          clicked = true;
        }
        return clicked;
      }
    
      function tryClickTurnstileIframes(doc) {
        doc = doc || document;
        var iframes = doc.querySelectorAll(
          'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], iframe[title*="Widget"], iframe[title*="challenge"], iframe[title*="Challenge"]'
        );
        var clicked = false;
        for (var i = 0; i < iframes.length; i++) {
          var iframe = iframes[i];
          var rect = iframe.getBoundingClientRect();
          if (rect.width < 16 || rect.height < 16) continue;
          try {
            if (typeof iframe.scrollIntoView === "function") {
              iframe.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
            }
          } catch (e) {}
          // Turnstile checkbox sits on the left edge of the widget (e.g. grok.com).
          var coords = {
            x: rect.left + Math.min(24, rect.width * 0.12),
            y: rect.top + rect.height / 2,
          };
          var target = iframe;
          try {
            var hit = doc.elementFromPoint(coords.x, coords.y);
            if (hit) target = hit;
          } catch (e2) {}
          dispatchPointer(target, "pointerdown", coords, 1);
          dispatchPointer(target, "mousedown", coords, 1);
          dispatchPointer(target, "pointerup", coords, 0);
          dispatchPointer(target, "mouseup", coords, 0);
          try {
            target.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: coords.x,
                clientY: coords.y,
                button: 0,
              })
            );
          } catch (e3) {}
          clicked = true;
        }
        return clicked;
      }
    
      function probeChallengeWidgets(doc) {
        doc = doc || document;
        var iframes = doc.querySelectorAll(
          'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], iframe[title*="Widget"], iframe[title*="challenge"], iframe[title*="Challenge"]'
        );
        var text = getDocText(doc, 4000);
        return {
          turnstile: !!doc.querySelector(".cf-turnstile, [data-sitekey]"),
          cbLb: queryAllDeep(doc, ".cb-lb").length,
          cbCheckbox: queryAllDeep(doc, ".cb-lb input[type='checkbox'], #challenge-stage input[type='checkbox']").length,
          iframes: iframes.length,
          verifyHumanText: /verify you are human/i.test(text),
          securityVerificationText: /performing security verification/i.test(text),
          justAMomentTitle: /^just a moment/i.test(((doc.querySelector("title") && doc.querySelector("title").textContent) || "").trim()),
        };
      }
    
      function tryClickChallenge(doc) {
        doc = doc || document;
        var clicked = false;
        var selectors = [
          "#challenge-stage input[type='checkbox']",
          ".cb-lb input[type='checkbox']",
          ".cb-lb",
          ".cb-i",
          ".ctp-checkbox-label",
          "label.ctp-checkbox-label",
          ".cf-turnstile",
          "#cf-turnstile",
          ".challenge-form button",
          "#challenge-body button",
          "#px-captcha button",
          "[role='button']",
        ];
    
        clicked = tryClickTurnstileIframes(doc) || clicked;
        clicked = tryClickByHumanLabel(doc) || clicked;
    
        for (var i = 0; i < selectors.length; i++) {
          var els = queryAllDeep(doc, selectors[i]);
          for (var j = 0; j < els.length; j++) {
            try {
              els[j].click();
              clicked = true;
            } catch (e) {}
          }
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
    
      function pollOnce(opts) {
        opts = opts || {};
        var autoClick = opts.autoClick !== false;
        var attempt = Number(opts.attempt) || 1;
        var html = document.documentElement ? document.documentElement.outerHTML : "";
        var challenge = detectChallenge(document, html);
        var clicked = false;
        if (challenge && autoClick && attempt % 3 === 1) {
          clicked = tryClickChallenge(document);
        }
        return {
          cleared: !challenge,
          challenge: challenge,
          clicked: clicked,
          widgets: probeChallengeWidgets(document),
          url: location.href,
          title: document.title,
          attempt: attempt,
        };
      }
    
      async function waitForClearance(opts) {
        opts = opts || {};
        var pollMs = Number(opts.pollMs) || 500;
        var url = opts.url || null;
        var autoClick = opts.autoClick !== false;
        var reloadOnce = opts.reloadOnce === true;
        var holdMs = Number(opts.holdMs) || 12000;
        var start = Date.now();
        var attempts = 0;
        var clicked = false;
        var held = false;
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
    
        function maxWaitMs() {
          var base = Number(opts.maxWaitMs) || 30000;
          var challenge = detectChallenge(document, document.documentElement ? document.documentElement.outerHTML : "");
          if (challenge && isHoldChallengeReason(challenge.reason)) {
            return Math.max(base, holdMs + 20000);
          }
          return base;
        }
    
        while (Date.now() - start < maxWaitMs()) {
          attempts++;
          var challenge = detectChallenge(document, document.documentElement ? document.documentElement.outerHTML : "");
          if (!challenge) {
            return {
              cleared: true,
              waitedMs: Date.now() - start,
              attempts: attempts,
              url: location.href,
              held: held,
              clicked: clicked,
              widgets: probeChallengeWidgets(document),
            };
          }
    
          if (autoClick && !held && isHoldChallengeReason(challenge.reason)) {
            held = (await tryHoldChallenge(document, { holdMs: holdMs })) || held;
            if (held) {
              await sleep(2000);
              continue;
            }
          }
    
          if (autoClick && attempts % 3 === 1) {
            clicked = tryClickChallenge(document) || clicked;
            if (!held && isHoldChallengeReason(challenge.reason)) {
              held = (await tryHoldChallenge(document, { holdMs: holdMs })) || held;
            }
          }
    
          if (reloadOnce && !reloaded && Date.now() - start > maxWaitMs() * 0.65) {
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
          held: held,
          clicked: clicked,
          widgets: probeChallengeWidgets(document),
          hint: still
            ? still.reason && isHoldChallengeReason(still.reason)
              ? "Press-and-hold challenge did not clear. Open the URL in Chrome, hold the verification button ~10s, or run: bun-browser site cloudflare/wait <url> holdMs=12000 maxWaitMs=45000"
              : "Cloudflare challenge did not clear in time. Open the URL in Chrome and complete verification, or run: bun-browser site cloudflare/wait <url>"
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
        pollOnce: pollOnce,
        probeChallengeWidgets: probeChallengeWidgets,
        detectChallenge: detectChallenge,
        isChallenge: isChallenge,
        findHoldButton: findHoldButton,
        tryHoldChallenge: tryHoldChallenge,
        tryClickByHumanLabel: tryClickByHumanLabel,
        tryClickTurnstileIframes: tryClickTurnstileIframes,
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

  if (!args.url) return { error: "Missing argument: url" };

  var raw = String(args.url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  var hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch (e) {
    return { error: "Invalid url" };
  }

  if (hostname !== "medium.com" && !hostname.endsWith(".medium.com")) {
    return {
      error: "Not a Medium URL",
      hint: "使用 medium.com 或 *.medium.com 下的文章链接。",
      action: "bun-browser open https://medium.com",
    };
  }

  var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
  if (!resp.ok) {
    return {
      error: "HTTP " + resp.status,
      hint: "文章可能已删除、需要会员或当前未登录。",
      action: "bun-browser open " + raw,
    };
  }

  var html = await resp.text();
  var doc = new DOMParser().parseFromString(html, "text/html");

  var title = "";
  var authorName = "";
  var publishedAt = "";
  var description = "";
  var articleBody = "";

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
          if (types[k] === "BlogPosting" || types[k] === "Article" || types[k] === "NewsArticle") {
            isArticle = true;
            break;
          }
        }
        if (!isArticle) continue;
        if (!title && item.headline) title = String(item.headline);
        if (!title && item.name) title = String(item.name);
        if (!articleBody && item.articleBody) articleBody = String(item.articleBody);
        if (!publishedAt && item.datePublished) publishedAt = String(item.datePublished);
        if (!publishedAt && item.dateCreated) publishedAt = String(item.dateCreated);
        if (!description && item.description) description = String(item.description);
        var auth = item.author;
        if (auth && !authorName) {
          if (typeof auth === "string") authorName = auth;
          else if (auth.name) authorName = String(auth.name);
        }
      }
    } catch (e) {}
  }

  if (!title) {
    var og = doc.querySelector('meta[property="og:title"]');
    if (og) title = (og.getAttribute("content") || "").trim();
  }
  if (!description) {
    var ogd = doc.querySelector('meta[property="og:description"]');
    if (ogd) description = (ogd.getAttribute("content") || "").trim();
  }

  if (!articleBody) {
    var art = doc.querySelector("article");
    if (art) {
      articleBody = (art.innerText || "").replace(/\s+/g, " ").trim();
    }
  }

  var finalUrl = resp.url || raw;

  return {
    url: finalUrl,
    title: title || null,
    author: authorName || null,
    publishedAt: publishedAt || null,
    description: description || null,
    articleBody: articleBody || null,
    bodyCharacterCount: articleBody ? articleBody.length : 0,
  };
}
