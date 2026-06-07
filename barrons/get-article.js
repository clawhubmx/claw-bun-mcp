/* @meta
{
  "name": "barrons/get-article",
  "description": "Read Barron's article title, date, and body. Prefers embedded __NEXT_DATA__ (flattenedBody); falls back to live DOM paragraphs on an open article tab.",
  "domain": "www.barrons.com",
  "args": {
    "url": { "required": true, "description": "Barron's article URL (www.barrons.com)" }
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site barrons/get-article https://www.barrons.com/articles/bitcoin-spacex-ethereum-xrp-cryptos-4f28af51"
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

  function isBarronsHostname(hostname) {
    return hostname === "barrons.com" || hostname === "www.barrons.com" || hostname.endsWith(".barrons.com");
  }

  function articleUrlsMatch(a, b) {
    try {
      var ua = new URL(a);
      var ub = new URL(b);
      if (!isBarronsHostname(ua.hostname) || !isBarronsHostname(ub.hostname)) return false;
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
      var b = bylines[i];
      if (!b) continue;
      if (b.type === "author" || b.phrase_type === "author") {
        if (b.name) names.push(String(b.name).trim());
        else if (b.text) names.push(String(b.text).trim());
        continue;
      }
      if (b.text) {
        var t = String(b.text).replace(/^By\s+/i, "").trim();
        if (t && !/^and$/i.test(t)) names.push(t);
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
    if (/Continue reading your article with a (?:WSJ|Barron(?:'|\u2019)s) subscription/i.test(text)) return true;
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

  if (!isBarronsHostname(hostname)) {
    return {
      error: "Not a Barron's URL",
      hint: "Use an article link from www.barrons.com.",
      action: "bun-browser open https://www.barrons.com",
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
        hint: "Article may be unavailable. Open barrons.com in Chrome first, then retry.",
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
      hint: "Barron's paywall blocked content. Open the article in Chrome, wait for it to load, then retry.",
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
      hint: "Full article data was not found. Open barrons.com in Chrome (with subscription if needed) and retry.",
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
