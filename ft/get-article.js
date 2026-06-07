/* @meta
{
  "name": "ft/get-article",
  "description": "Read Financial Times article title, date, and body. Prefers embedded initial-props (bodyTree/bodyXML); falls back to live DOM paragraphs on an open article tab.",
  "domain": "www.ft.com",
  "args": {
    "url": { "required": true, "description": "FT article URL (www.ft.com/content/...)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site ft/get-article https://www.ft.com/content/aa9dae8f-be1a-425b-8339-c012d9720852"
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

  function isFtHostname(hostname) {
    return hostname === "ft.com" || hostname === "www.ft.com" || hostname.endsWith(".ft.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isFtHostname(ua.hostname) || !isFtHostname(ub.hostname)) return false;
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
    if (/^Newsletter Sign-up$/i.test(t)) return true;
    if (/^Listen$/i.test(t)) return true;
    if (/^\(\d+ min\)$/i.test(t)) return true;
    if (/^\d+$/.test(t)) return true;
    if (/^Subscribe to unlock this article/i.test(t)) return true;
    if (/^Try unlimited access/i.test(t)) return true;
    if (/^Keep reading for /i.test(t)) return true;
    if (/^Explore our full range of subscriptions/i.test(t)) return true;
    if (/^Terms & Conditions apply$/i.test(t)) return true;
    if (/^Check whether you already have access/i.test(t)) return true;
    if (/^Sign up for /i.test(t) && /newsletter/i.test(t)) return true;
    if (/^Accessibility help$/i.test(t)) return true;
    if (/^Skip to /i.test(t)) return true;
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

  function isPaywallPreview(text) {
    if (!text) return true;
    var t = normalizeWhitespace(text);
    if (!t) return true;
    if (/^Subscribe to read$/i.test(t)) return true;
    if (/Subscribe to unlock this article/i.test(t)) return true;
    if (/Try unlimited access/i.test(t) && t.length < 900) return true;
    if (/Keep reading for /i.test(t) && t.length < 900) return true;
    if (/Only HK\$|Only \u00a3|per month/i.test(t) && /subscription|trial/i.test(t) && t.length < 1200) return true;
    return false;
  }

  function parseJsonScript(doc, id) {
    if (!doc) return null;
    var el = doc.getElementById(id);
    if (!el) return null;
    var raw = (el.textContent || "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function getAppContext(doc) {
    return parseJsonScript(doc, "page-kit-app-context");
  }

  function isBarrierContext(ctx) {
    if (!ctx) return false;
    if (ctx.appName === "barrier-page") return true;
    if (ctx.app === "opportunity-page") return true;
    var pvc = ctx.trackingData && ctx.trackingData.pageViewContext;
    if (pvc && pvc.barrier === true) return true;
    return false;
  }

  function extractTextFromNode(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) {
      var out = "";
      for (var i = 0; i < node.length; i++) out += extractTextFromNode(node[i]);
      return out;
    }
    if (typeof node !== "object") return "";
    if (node.type === "text" && node.value) return String(node.value);
    if (node.text) return String(node.text);
    if (node.data && node.data.text) return String(node.data.text);
    var children = node.children || node.content;
    if (children) return extractTextFromNode(children);
    return "";
  }

  function extractBodyFromBodyTree(tree) {
    if (!tree) return "";
    var blocks = [];
    var blockTypes = {
      paragraph: 1,
      heading: 1,
      "list-item": 1,
      blockquote: 1,
      "scrolly-copy": 1,
    };

    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i]);
        return;
      }
      if (typeof node !== "object") return;
      var type = String(node.type || "").toLowerCase();
      if (blockTypes[type] || type.indexOf("heading") >= 0) {
        var text = sanitizeParagraphText(extractTextFromNode(node));
        if (text && !isBoilerplateParagraph(text)) blocks.push(text);
        return;
      }
      if (node.tree) walk(node.tree);
      if (node.bodyTree) walk(node.bodyTree);
      if (node.children) walk(node.children);
      if (node.content) walk(node.content);
    }

    walk(tree);
    return blocks.join("\n\n");
  }

  function extractBodyFromBodyXml(xml) {
    if (!xml) return "";
    var wrapped = String(xml).trim();
    if (!wrapped) return "";
    if (wrapped.indexOf("<body") < 0) wrapped = "<body>" + wrapped + "</body>";
    var doc = new DOMParser().parseFromString(wrapped, "text/html");
    var root = doc.querySelector("body") || doc.body;
    if (!root) return "";
    var els = root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote");
    var parts = [];
    for (var i = 0; i < els.length; i++) {
      var text = sanitizeParagraphText(els[i].textContent || "");
      if (!text || text.length < 20) continue;
      if (isBoilerplateParagraph(text)) continue;
      parts.push(text);
    }
    return parts.join("\n\n");
  }

  function findArticlePayload(obj, depth, seen) {
    if (!obj || depth > 8) return null;
    if (typeof obj !== "object") return null;
    if (seen.has(obj)) return null;
    seen.add(obj);

    if (obj.bodyTree || obj.bodyXML || obj.bodyXml) return obj;
    if (obj.body && (obj.body.tree || obj.body.bodyTree || obj.body.bodyXML)) return obj.body;
    if (obj.article && (obj.article.bodyTree || obj.article.bodyXML || obj.article.body)) return obj.article;
    if (obj.content && (obj.content.bodyTree || obj.content.bodyXML || obj.content.body)) return obj.content;

    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var val = obj[keys[i]];
      if (!val || typeof val !== "object") continue;
      var hit = findArticlePayload(val, depth + 1, seen);
      if (hit) return hit;
    }
    return null;
  }

  function applyArticlePayload(payload, state) {
    if (!payload) return;
    if (!state.title && payload.title) state.title = String(payload.title);
    if (!state.title && payload.headline) {
      state.title = typeof payload.headline === "string" ? payload.headline : String(payload.headline.text || payload.headline);
    }
    if (!state.author && payload.byline) state.author = String(payload.byline);
    if (!state.publishedAt && payload.publishedDate) state.publishedAt = String(payload.publishedDate);
    if (!state.publishedAt && payload.firstPublishedDate) state.publishedAt = String(payload.firstPublishedDate);
    if (!state.publishedAt && payload.datePublished) state.publishedAt = String(payload.datePublished);
    if (!state.dateModified && payload.lastModified) state.dateModified = String(payload.lastModified);
    if (!state.dateModified && payload.dateModified) state.dateModified = String(payload.dateModified);
    if (!state.description && payload.standfirst) state.description = stripHtml(payload.standfirst);
    if (!state.description && payload.summary) state.description = stripHtml(payload.summary);
    if (!state.description && payload.dek) state.description = stripHtml(payload.dek);

    var body = "";
    if (payload.bodyTree) body = extractBodyFromBodyTree(payload.bodyTree);
    if (!body && payload.body && payload.body.tree) body = extractBodyFromBodyTree(payload.body.tree);
    if (!body && payload.body && payload.body.bodyTree) body = extractBodyFromBodyTree(payload.body.bodyTree);
    if (!body && payload.bodyXML) body = extractBodyFromBodyXml(payload.bodyXML);
    if (!body && payload.bodyXml) body = extractBodyFromBodyXml(payload.bodyXml);
    if (!body && payload.body && payload.body.bodyXML) body = extractBodyFromBodyXml(payload.body.bodyXML);
    if (!body && payload.articleBody) body = sanitizeArticleBody(String(payload.articleBody));

    body = sanitizeArticleBody(body);
    if (body && body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      if (!state.source) {
        if (payload.bodyTree || (payload.body && payload.body.tree)) state.source = "bodyTree";
        else state.source = "bodyXML";
      }
    }
  }

  function applyJsonLd(items, state) {
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
        state.articleBody = sanitizeArticleBody(String(item.articleBody));
        state.source = "jsonLd";
      }
      if (item.isAccessibleForFree === false || item.isAccessibleForFree === "False") {
        state.isAccessibleForFree = false;
      }
    }
  }

  function applyMetaTags(doc, state) {
    if (!doc) return;
    if (!state.title) {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og) state.title = (og.getAttribute("content") || "").trim();
    }
    if (!state.description) {
      var ogd = doc.querySelector('meta[property="og:description"]');
      if (ogd) state.description = (ogd.getAttribute("content") || "").trim();
    }
    if (!state.publishedAt) {
      var pubMeta = doc.querySelector('meta[property="article:published_time"]');
      if (pubMeta) state.publishedAt = (pubMeta.getAttribute("content") || "").trim();
    }
    if (!state.title) {
      var h1 = doc.querySelector("h1");
      if (h1) state.title = (h1.textContent || "").trim();
    }
    if (!state.publishedAt) {
      var timeEl = doc.querySelector("time[datetime]");
      if (timeEl) state.publishedAt = (timeEl.getAttribute("datetime") || "").trim();
    }
  }

  function extractElementText(el) {
    if (!el) return "";
    var skipTags = { STYLE: 1, SCRIPT: 1, NOSCRIPT: 1, SVG: 1 };
    var rootDoc = el.ownerDocument || document;
    var walker = rootDoc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
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
    var selectors = [
      ".article__content-body.n-content-body p",
      ".article__content-body p",
      ".n-content-body p",
      "[data-trackable='article-body'] p",
      ".o3-type-body-content-base",
      "article .n-content-body p",
      "article p",
    ];
    var els = [];
    for (var s = 0; s < selectors.length; s++) {
      els = root.querySelectorAll(selectors[s]);
      if (els.length) break;
    }
    var paragraphs = [];
    for (var i = 0; i < els.length; i++) {
      var text = extractElementText(els[i]);
      if (!text || text.length < 30) continue;
      if (isBoilerplateParagraph(text)) continue;
      paragraphs.push(text);
    }
    return sanitizeArticleBody(paragraphs.join("\n\n"));
  }

  function readEmbeddedFromDocument(doc) {
    if (!doc) return null;
    var initialProps = parseJsonScript(doc, "initial-props");
    var dataEmbed = parseJsonScript(doc, "data-embed");
    var payload = null;
    if (initialProps) payload = findArticlePayload(initialProps, 0, new Set());
    if (!payload && dataEmbed) payload = findArticlePayload(dataEmbed, 0, new Set());
    return { initialProps: initialProps, dataEmbed: dataEmbed, payload: payload };
  }

  function readFromOpenPage() {
    var doc = document;
    var embedded = readEmbeddedFromDocument(doc);
    var domBody = extractDomBody(doc);
    if ((embedded && embedded.payload) || domBody) {
      return { embedded: embedded, domBody: domBody, source: "openPage" };
    }
    return domBody ? { embedded: embedded, domBody: domBody, source: "openPageDom" } : null;
  }

  async function waitForOpenPageArticle(url, attempts, delayMs) {
    for (var i = 0; i < attempts; i++) {
      if (!articleUrlsMatch(location.href, url)) return null;
      var hit = readFromOpenPage();
      if (hit && ((hit.embedded && hit.embedded.payload) || hit.domBody)) return hit;
      if (isBarrierContext(getAppContext(document))) return readFromOpenPage();
      await new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      });
    }
    return readFromOpenPage();
  }

  function maybeSetBody(state, body, source) {
    body = sanitizeArticleBody(body);
    if (!body || isPaywallPreview(body)) return;
    if (body.length > (state.articleBody || "").length) {
      state.articleBody = body;
      state.source = source;
    }
  }

  function applyAppContext(ctx, state) {
    if (!ctx) return;
    state.isUserLoggedIn = typeof ctx.isUserLoggedIn === "boolean" ? ctx.isUserLoggedIn : null;
    state.isBarrierPage = isBarrierContext(ctx);
    if (ctx.appName) state.appName = String(ctx.appName);
    var pvc = ctx.trackingData && ctx.trackingData.pageViewContext;
    if (pvc && pvc.content && pvc.content.topics && pvc.content.topics.article_main_topic) {
      state.section = String(pvc.content.topics.article_main_topic.label || "");
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

  if (!isFtHostname(hostname)) {
    return {
      error: "Not an FT URL",
      hint: "Use an article link from www.ft.com/content/...",
      action: "bun-browser open https://www.ft.com",
    };
  }

  if (!/^\/content\/[0-9a-f-]{36}/i.test(new URL(raw).pathname)) {
    return {
      error: "Not an FT article URL",
      hint: "Use a /content/{uuid} article link.",
      action: "bun-browser open https://www.ft.com",
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
    isBarrierPage: null,
    isUserLoggedIn: null,
    isAccessibleForFree: null,
    appName: "",
  };

  var onArticlePage = articleUrlsMatch(location.href, raw);
  if (onArticlePage) {
    var openResult = await waitForOpenPageArticle(raw, 10, 250);
    if (openResult && openResult.embedded && openResult.embedded.payload) {
      applyArticlePayload(openResult.embedded.payload, state);
      if (!state.source) state.source = openResult.source;
      state.finalUrl = location.href || raw;
    }
    applyAppContext(getAppContext(document), state);
    if (openResult && openResult.domBody) {
      maybeSetBody(state, openResult.domBody, "dom");
    }
  }

  if (!state.articleBody || state.isBarrierPage) {
    var resp = await fetch(raw, { credentials: "include", redirect: "follow" });
    if (!resp.ok) {
      return {
        error: "HTTP " + resp.status,
        hint: "Article may be unavailable. Open ft.com in Chrome first, then retry.",
        action: "bun-browser open " + raw,
      };
    }

    state.finalUrl = resp.url || raw;
    var html = await resp.text();
    var doc = new DOMParser().parseFromString(html, "text/html");
    var appCtx = getAppContext(doc);
    applyAppContext(appCtx, state);

    var embedded = readEmbeddedFromDocument(doc);
    if (embedded && embedded.payload) {
      applyArticlePayload(embedded.payload, state);
      if (!state.source) state.source = "initialProps";
    }

    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      try {
        var j = JSON.parse(scripts[s].textContent || "{}");
        applyJsonLd(flattenLd(j), state);
      } catch (e) {}
    }

    applyMetaTags(doc, state);

    if (!state.articleBody || state.isBarrierPage) {
      var fetchedDomBody = extractDomBody(doc);
      if (fetchedDomBody) maybeSetBody(state, fetchedDomBody, "dom");
    }
  }

  if (!state.articleBody) {
    return {
      error: "Could not extract full article body",
      hint: "FT paywall blocked content. Open the article in Chrome (with subscription if needed), wait for it to load, then retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      author: state.author || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
      isBarrierPage: state.isBarrierPage,
      isUserLoggedIn: state.isUserLoggedIn,
    };
  }

  state.articleBody = sanitizeArticleBody(state.articleBody);

  if (isPaywallPreview(state.articleBody)) {
    return {
      error: "Only paywall preview available",
      hint: "Full article data was not found. Open ft.com in Chrome (with subscription if needed) and retry.",
      action: "bun-browser open " + raw,
      title: state.title || null,
      author: state.author || null,
      publishedAt: state.publishedAt || null,
      description: state.description || null,
      preview: state.articleBody.slice(0, 500),
      isBarrierPage: state.isBarrierPage,
      isUserLoggedIn: state.isUserLoggedIn,
    };
  }

  var paywallBypassed =
    state.source !== "dom" &&
    state.source !== "jsonLd" &&
    state.isBarrierPage !== true;

  if (state.isAccessibleForFree === true) paywallBypassed = true;
  if (state.source === "bodyTree" || state.source === "bodyXML" || state.source === "initialProps") {
    paywallBypassed = true;
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
    isBarrierPage: state.isBarrierPage,
    isUserLoggedIn: state.isUserLoggedIn,
    paywallBypassed: paywallBypassed,
  };
}
