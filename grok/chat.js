/* @meta
{
  "name": "grok/chat",
  "description": "向 Grok 提问 (AI chat: answer, model, conversationId)",
  "domain": "grok.com",
  "args": {
    "query": {"required": true, "description": "Prompt to send to Grok"},
    "model": {"required": false, "description": "Grok mode id: fast, auto, expert, heavy, beta, or full id from grok/modes (e.g. grok-420-computer-use-sa). heavy and beta are separate modes. Default fast."},
    "disableSearch": {"required": false, "description": "Disable Grok web search (default false)"},
    "newChat": {"required": false, "description": "Start a new chat thread (default true)"},
    "waitOnly": {"required": false, "description": "Skip new chat / submit; only poll for the in-flight assistant reply (default false)"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms (default by mode: fast/auto/beta 15m, expert 25m, heavy 40m)"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/chat \"Explain quantum computing in one paragraph\""
}
*/

async function(args) {
  if (!args.query) {
    return {error: 'Missing argument: query', hint: 'Provide a prompt for Grok'};
  }

  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  const loggedIn = hasCookie('sso') || hasCookie('x-userid');
  if (!loggedIn) {
    return {
      error: 'Not logged in',
      hint: '需要先在浏览器中登录 grok.com（X/xAI 账号）',
      action: 'bun-browser open https://grok.com/'
    };
  }

                var h = (function installGrokChatHelpers() {
{
  var HELPERS_VERSION = 23;

  // Default wait when mode is unrecognized (fast/auto)
  var GROK_CHAT_WAIT_MS = 15 * 60 * 1000;
  var GROK_CHAT_POLL_MS = 500;
  // Per-mode default max wait (ms): expert 25m, heavy 40m, beta/beta-related 15m, fast/auto 15m
  var MODE_WAIT_MS = {
    fast: 15 * 60 * 1000,
    auto: 15 * 60 * 1000,
    expert: 25 * 60 * 1000,
    heavy: 40 * 60 * 1000,
    beta: 15 * 60 * 1000
  };
  if (globalThis.__grokChatHelpers && globalThis.__grokChatHelpers.version === HELPERS_VERSION) {
    return globalThis.__grokChatHelpers;
  }

  var MODE_LABELS = {
    fast: 'Fast',
    auto: 'Auto',
    expert: 'Expert',
    heavy: 'Heavy',
    beta: 'Beta'
  };

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function clickElement(el) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    el.click();
    var rect = el.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click'].forEach(function(type) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
      }));
    });
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return el.offsetParent !== null || style.position === 'fixed' || style.position === 'sticky';
  }

  function findVisibleElement(candidates) {
    if (!candidates || !candidates.length) return null;
    for (var i = 0; i < candidates.length; i++) {
      if (isElementVisible(candidates[i])) return candidates[i];
    }
    return candidates[0];
  }

  function getAssistantMessages() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-testid="assistant-message"]'));
  }

  function isProgressLine(line) {
    var t = String(line || '').trim();
    if (!t) return false;
    if (/^Preview:/i.test(t)) return true;
    if (/^Searched web\b/i.test(t)) return true;
    if (/^Searched 𝕏\b/i.test(t)) return true;
    if (/^Evaluating .+ • \d+s/i.test(t)) return true;
    if (/^\d+ results$/i.test(t)) return true;
    if (/^\d+ posts$/i.test(t)) return true;
    if (/^(Searching|Reading|Browsing|Fetching|Running tool|Open page)\b/i.test(t)) return true;
    if (/^Thought for \d+s$/i.test(t)) return true;
    if (/^Agents thinking$/i.test(t)) return true;
    if (/^Agent \d+$/i.test(t)) return true;
    if (/^(Structuring|Compiling|Drafting|Formulating|Evaluating|Preparing|Organizing)\b/i.test(t)) return true;
    if (/^.+\s+(thinking|response|JSON response)$/i.test(t) && t.length < 80) return true;
    return false;
  }

  function extractBalancedObject(text, startChar, endChar) {
    if (!text) return '';
    var start = text.indexOf(startChar);
    if (start < 0) return '';
    var slice = text.slice(start);
    try {
      JSON.parse(slice);
      return slice;
    } catch (e) {}
    var depth = 0;
    var inString = false;
    var escape = false;
    for (var i = 0; i < slice.length; i++) {
      var ch = slice[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === startChar) depth++;
      else if (ch === endChar) {
        depth--;
        if (depth === 0) {
          var candidate = slice.slice(0, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch (e2) {}
        }
      }
    }
    return '';
  }

  function extractJsonBlock(text) {
    if (!text) return '';
    var t = String(text).trim();

    // Markdown fenced blocks: ```json ... ``` or ``` ... ```
    var fenceRe = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
    var fenceMatch;
    while ((fenceMatch = fenceRe.exec(t)) !== null) {
      var fromFence = extractBalancedObject(fenceMatch[1].trim(), '{', '}');
      if (fromFence) return fromFence;
    }

    return extractBalancedObject(t, '{', '}');
  }

  function parseAnswerJson(text) {
    var json = extractJsonBlock(text);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function hasParsedJsonAnswer(text) {
    return parseAnswerJson(text) != null;
  }

  function isProgressText(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t) return false;
    if (/^Preview:/i.test(t)) return true;
    if (/^Open page\b/i.test(t)) return true;
    if (/Searched web/i.test(t) && /Evaluating .+ • \d+s/i.test(t)) return true;
    if (/Searched web/i.test(t) && /\d+ results/i.test(t) && !/[.!?]/.test(t)) return true;
    if (/Searched 𝕏/i.test(t) && /\d+ posts/i.test(t) && !/[.!?]/.test(t)) return true;
    if (/^Searched web/i.test(t) && t.length < 500) return true;
    if (/Agents thinking/i.test(t) && extractJsonBlock(t) === '') return true;
    if (/^(Structuring|Compiling|Drafting|Formulating|Preparing|Organizing)\b/i.test(t) && t.length < 120) return true;
    var lines = t.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return false;
    return lines.every(isProgressLine);
  }

  function detectGrokUnableToReply(text) {
    if (!text) return false;
    var t = String(text);
    if (/grok was unable to reply/i.test(t)) return true;
    if (/unable to reply to your last message/i.test(t)) return true;
    return false;
  }

  function looksLikeFinalAnswer(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t || isProgressText(t)) return false;
    if (detectGrokUnableToReply(t)) return false;
    if (/^open page\b/i.test(t)) return false;
    var json = extractJsonBlock(t);
    if (json) {
      try {
        JSON.parse(json);
        return true;
      } catch (e) {}
    }
    if (/Searched web/i.test(t) && /\d+ results/i.test(t)) return false;
    if (/^Searched web/i.test(t)) return false;
    if (t.length < 12) return false;
    if (/[.!?]/.test(t) && /[A-Za-z]{3,}/.test(t)) return true;
    if (t.length >= 20 && !/Searched 𝕏|Searched web|\d+ results|\d+ posts/i.test(t)) return true;
    return false;
  }

  function cleanAssistantText(text) {
    if (!text) return '';
    var cleaned = String(text).replace(/^Thought for \d+s\n+/i, '').trim();
    cleaned = cleaned.replace(/^Preview:\s*['']?[^\n]*(?:\n|$)/i, '').trim();
    var lines = cleaned.split('\n');
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      if (!isProgressLine(lines[i])) kept.push(lines[i]);
    }
    cleaned = kept.join('\n').trim();
    var json = extractJsonBlock(cleaned);
    if (json) return json;
    return cleaned;
  }

  function getAssistantText(el) {
    if (!el) return '';

    var candidates = [];
    var seen = {};
    function pushCandidate(raw) {
      var cleaned = cleanAssistantText(raw || '');
      if (!cleaned || seen[cleaned]) return;
      seen[cleaned] = true;
      candidates.push(cleaned);
    }

    // Code blocks often hold JSON when prose is only a short intro line.
    var codeNodes = el.querySelectorAll('pre code, pre');
    for (var c = 0; c < codeNodes.length; c++) {
      pushCandidate(codeNodes[c].innerText || codeNodes[c].textContent || '');
    }

    var proseSelectors = [
      '[data-testid="message-content"]',
      '[data-testid="response-content"]',
      '[class*="prose"]',
      '[class*="markdown"]'
    ];
    for (var s = 0; s < proseSelectors.length; s++) {
      var proseNodes = el.querySelectorAll(proseSelectors[s]);
      for (var p = 0; p < proseNodes.length; p++) {
        pushCandidate(proseNodes[p].innerText || proseNodes[p].textContent || '');
      }
    }

    var clone = el.cloneNode(true);
    var removeSelectors = [
      'button',
      'svg',
      '[aria-hidden="true"]',
      '[class*="search"]',
      '[class*="tool"]',
      '[class*="preview"]',
      '[class*="progress"]'
    ];
    for (var r = 0; r < removeSelectors.length; r++) {
      var nodes = clone.querySelectorAll(removeSelectors[r]);
      for (var n = 0; n < nodes.length; n++) nodes[n].remove();
    }
    pushCandidate(clone.innerText || el.innerText || '');

    for (var i = 0; i < candidates.length; i++) {
      var json = extractJsonBlock(candidates[i]);
      if (json) {
        try {
          JSON.parse(json);
          return json;
        } catch (e) {}
      }
    }

    for (var j = 0; j < candidates.length; j++) {
      if (looksLikeFinalAnswer(candidates[j])) return candidates[j];
    }
    return '';
  }

  function isGrokGenerating() {
    var messages = getAssistantMessages();
    var latest = messages[messages.length - 1];
    if (latest) {
      var extracted = getAssistantText(latest);
      if (extracted && hasParsedJsonAnswer(extracted)) return false;
    }

    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < buttons.length; i++) {
      var label = (buttons[i].getAttribute('aria-label') || '').toLowerCase();
      if (label === 'stop' || label.indexOf('stop generating') !== -1) {
        if (!buttons[i].disabled) return true;
      }
    }

    if (!latest) return false;

    if (latest.querySelector('[aria-busy="true"], [data-testid="loading"], .animate-pulse, .animate-spin')) {
      return true;
    }
    if (latest.querySelector('[class*="streaming"], [class*="typing"], [data-testid="streaming"]')) {
      return true;
    }

    var latestText = latest.innerText || '';
    if (/Agents thinking/i.test(latestText) && !getAssistantText(latest)) {
      return true;
    }

    return false;
  }

  function getChatInput() {
    var editor = document.querySelector('[data-testid="chat-input"] [contenteditable="true"]');
    if (editor) return editor;
    return document.querySelector('textarea') || null;
  }

  function normalizePromptText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u2013|\u2014/g, '-')
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\n+$/, '');
  }

  function getChatInputText() {
    var editor = getChatInput();
    if (!editor) return '';
    var raw = editor.innerText != null ? editor.innerText : (editor.textContent || editor.value || '');
    return normalizePromptText(raw);
  }

  function inputMatchesExpected(got, expected) {
    got = normalizePromptText(got);
    expected = normalizePromptText(expected);
    if (got === expected) return true;
    if (got.length < Math.floor(expected.length * 0.98)) return false;
    if (expected.length >= 40 && got.slice(0, 40) !== expected.slice(0, 40)) return false;
    if (expected.length >= 40 && got.slice(-40) !== expected.slice(-40)) return false;
    return Math.abs(got.length - expected.length) <= 3;
  }

  function verifyChatInput(expected) {
    expected = String(expected == null ? '' : expected);
    var got = getChatInputText();
    var ok = inputMatchesExpected(got, expected);
    var out = {
      ok: ok,
      expectedLen: expected.length,
      actualLen: got.length
    };
    if (!ok) {
      out.kind = got.length < expected.length * 0.98 ? 'truncated' : 'mismatch';
      out.expectedHead = expected.slice(0, 80);
      out.actualHead = got.slice(0, 80);
      out.expectedTail = expected.slice(-80);
      out.actualTail = got.slice(-80);
    }
    return out;
  }

  function setChatInput(value) {
    value = String(value == null ? '' : value);
    var editor = getChatInput();
    if (!editor) return false;
    editor.focus();
    try { editor.click(); } catch (e) {}

    if (editor.getAttribute('contenteditable') === 'true' || editor.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
      if (inputMatchesExpected(getChatInputText(), value)) {
        editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
        return true;
      }
      editor.textContent = '';
      var beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      });
      editor.dispatchEvent(beforeInput);
      if (!beforeInput.defaultPrevented) {
        editor.textContent = value;
      }
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
      editor.dispatchEvent(new Event('change', {bubbles: true}));
      return inputMatchesExpected(getChatInputText(), value);
    }

    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(editor, value);
    else editor.value = value;
    editor.dispatchEvent(new Event('input', {bubbles: true}));
    editor.dispatchEvent(new Event('change', {bubbles: true}));
    return inputMatchesExpected(getChatInputText(), value);
  }

  async function fillChatInput(value) {
    value = String(value == null ? '' : value);
    if (!getChatInput()) {
      return { ok: false, error: 'Chat input not found', kind: 'composer_missing' };
    }
    var lastCheck = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(250);
      if (!setChatInput(value)) continue;
      await sleep(attempt === 0 ? 200 : 350);
      lastCheck = verifyChatInput(value);
      if (lastCheck.ok) {
        return { ok: true, inputCheck: lastCheck, attempts: attempt + 1 };
      }
    }
    lastCheck = lastCheck || verifyChatInput(value);
    return {
      ok: false,
      kind: lastCheck.kind || 'input_truncated',
      error: 'Prompt truncated in composer',
      inputCheck: lastCheck,
      attempts: 2
    };
  }

  async function pollModeLabel(requested, catalog, rounds, delayMs) {
    for (var i = 0; i < rounds; i++) {
      await sleep(delayMs);
      var label = readGrokModeLabel();
      if (modeLabelsMatch(requested, label, catalog)) return label;
    }
    return readGrokModeLabel();
  }

  async function tryApplyGrokModeViaMenu(requested, catalog) {
    for (var menuTry = 0; menuTry < 2; menuTry++) {
      if (!(await openModelMenu())) continue;
      var option = findModeOptionElement(requested, catalog);
      if (!option) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(200);
        continue;
      }
      option.click();
      writeStoredGrokMode(requested);
      var appliedLabel = await pollModeLabel(requested, catalog, 12, 350);
      if (modeLabelsMatch(requested, appliedLabel, catalog)) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return {
          ok: true,
          changed: true,
          mode: requested,
          label: appliedLabel,
          modeTitle: getModeTitle(requested, catalog),
          appliedVia: 'ui'
        };
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(250);
    }
    return null;
  }

  function getSubmitButton() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    return buttons.find(function(b) {
      var label = (b.getAttribute('aria-label') || '').toLowerCase();
      return label === 'submit';
    }) || null;
  }

  function isSubmitDisabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    return false;
  }

  function getVisiblePageText(maxLen) {
    maxLen = maxLen || 12000;
    var text = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function extractRateLimitDetail(text) {
    var m = String(text || '').match(/(\d+)\s*minutes?\s+before\s+limit\s+is\s+gone/i);
    if (m) return { minutesUntilReset: Number(m[1]) };
    return null;
  }

  function detectCloudflareBlock() {
    if (document.querySelector(
      '.cf-turnstile, #challenge-running, #cf-challenge-running, #cf-wrapper, ' +
      'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], ' +
      'form[action*="cdn-cgi/challenge"]'
    )) {
      return true;
    }
    var title = (document.title || '').toLowerCase();
    if (/just a moment|attention required|cloudflare|please wait|verify you are human/i.test(title)) {
      return true;
    }
    var text = getVisiblePageText(4000);
    if (!document.querySelector('[data-testid="chat-input"]') &&
      /verify you are human|checking if the site connection is secure|enable javascript and cookies|cf-browser-verification|performing security verification|ddos protection by cloudflare/i.test(text)) {
      return true;
    }
    return false;
  }

  function detectRateLimitText(text) {
    if (/minutes?\s+before\s+limit\s+is\s+gone/i.test(text)) return true;
    if (/you can continue chatting once it resets/i.test(text)) return true;
    if (/message\s+limit\s+reached/i.test(text)) return true;
    if (/supergrok\s+heavy\s+limit\s+reached/i.test(text)) return true;
    if (/supergrok/i.test(text) && /your\s+limit\s+will\s+reset\s+soon/i.test(text)) return true;
    if (/rate\s+limit/i.test(text) && /reset|wait|try again|minutes?/i.test(text)) return true;
    if (/too many (messages|requests)/i.test(text)) return true;
    return false;
  }

  function isSuperGrokHeavyLimit(text) {
    return /supergrok\s+heavy\s+limit\s+reached/i.test(text) ||
      (/supergrok/i.test(text) && /your\s+limit\s+will\s+reset\s+soon/i.test(text));
  }

  function findGrokRetryButton(rootEl) {
    var scopes = [];
    if (rootEl) scopes.push(rootEl);
    else {
      scopes.push(document);
      var latest = getAssistantMessages().slice(-1)[0];
      if (latest) scopes.push(latest);
    }
    var candidates = [];
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    for (var s = 0; s < scopes.length; s++) {
      var nodes = Array.prototype.slice.call(scopes[s].querySelectorAll(
        'button, [role="button"], a'
      ));
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (seen) {
          if (seen.has(el)) continue;
          seen.add(el);
        }
        var label = el.getAttribute('aria-label') || '';
        var text = (el.innerText || el.textContent || '').trim();
        if (/^retry$/i.test(text) || /^retry$/i.test(label) ||
            /^try again$/i.test(text) || /^try again$/i.test(label)) {
          candidates.push(el);
        }
      }
    }
    return findVisibleElement(candidates);
  }

  async function clickGrokRetry(rootEl) {
    var btn = findGrokRetryButton(rootEl);
    if (!btn) return { ok: false };
    clickElement(btn);
    await sleep(400);
    return { ok: true };
  }

  function getLatestAssistantResponseText() {
    var messages = getAssistantMessages();
    var latest = messages[messages.length - 1];
    if (!latest) return '';
    return (latest.innerText || latest.textContent || '').trim();
  }

  function buildGrokTransientError(sourceText, rootEl) {
    var message = '';
    if (sourceText) {
      var lines = String(sourceText).split('\n').map(function(line) {
        return line.trim();
      }).filter(Boolean);
      for (var i = 0; i < lines.length; i++) {
        if (detectGrokUnableToReply(lines[i])) {
          message = lines[i];
          break;
        }
      }
      if (!message) message = lines.slice(0, 4).join(' ');
    }
    return {
      error: 'Grok generation failed',
      kind: 'transient_error',
      message: message || 'Grok was unable to reply to your last message.',
      hint: 'Transient Grok error. The adapter clicks Retry automatically; you can also retry the same command.',
      action: 'retry same command',
      canRetry: !!findGrokRetryButton(rootEl)
    };
  }

  function detectGrokResponseBlock(text, rootEl) {
    var sources = [];
    if (text) sources.push(String(text));
    if (rootEl) {
      sources.push((rootEl.innerText || rootEl.textContent || '').trim());
    }
    for (var i = 0; i < sources.length; i++) {
      if (detectGrokUnableToReply(sources[i])) {
        return buildGrokTransientError(sources[i], rootEl);
      }
    }
    if (rootEl && findGrokRetryButton(rootEl)) {
      return buildGrokTransientError(text || getLatestAssistantResponseText(), rootEl);
    }
    return null;
  }

  function checkGrokAnswerBlocked(answer) {
    var block = detectGrokResponseBlock(answer);
    if (!block) block = detectGrokResponseBlock(getLatestAssistantResponseText());
    if (!block) {
      var latest = getAssistantMessages().slice(-1)[0];
      if (latest) block = detectGrokResponseBlock('', latest);
    }
    if (!block) {
      var pageText = getVisiblePageText(8000);
      if (detectGrokUnableToReply(pageText) || findGrokRetryButton()) {
        block = buildGrokTransientError(pageText, null);
      }
    }
    return block;
  }

  function detectGrokPageAbnormal(opts) {
    opts = opts || {};
    var skipSubmitCheck = opts.skipSubmitCheck === true;

    if (detectCloudflareBlock()) {
      return {
        error: 'Cloudflare verification required',
        kind: 'cloudflare',
        hint: 'Cloudflare bot/challenge page detected. Open grok.com in the browser and complete verification manually.',
        action: 'bun-browser open https://grok.com/'
      };
    }

    var pageText = getVisiblePageText();
    var rateDetail = null;

    if (detectRateLimitText(pageText)) {
      rateDetail = extractRateLimitDetail(pageText);
      var superGrokHeavy = isSuperGrokHeavyLimit(pageText);
      var rateHint = superGrokHeavy
        ? 'SuperGrok Heavy quota reached. Your limit will reset soon.'
        : (rateDetail && rateDetail.minutesUntilReset
          ? 'Rate limit active: about ' + rateDetail.minutesUntilReset + ' minutes until reset. You can continue chatting once it resets.'
          : 'Rate limit or quota message detected on page. Wait for reset before retrying.');
      var rateOut = {
        error: superGrokHeavy ? 'SuperGrok Heavy limit reached' : 'Chat rate limit reached',
        kind: 'rate_limit',
        hint: rateHint,
        action: 'wait for limit reset, then retry'
      };
      if (rateDetail) rateOut.minutesUntilReset = rateDetail.minutesUntilReset;
      return rateOut;
    }

    if (!document.querySelector('[data-testid="assistant-message"]')) {
      if (/service (is )?(temporarily )?unavailable|under maintenance|unable to load chat/i.test(pageText)) {
        return {
          error: 'Chat service unavailable',
          kind: 'service_unavailable',
          hint: 'Grok chat appears unavailable or down. Check grok.com status or retry later.',
          action: 'retry later or bun-browser open https://grok.com/'
        };
      }
    }

    if (!skipSubmitCheck) {
      var submit = getSubmitButton();
      if (submit && isSubmitDisabled(submit)) {
        var inputArea = document.querySelector('[data-testid="chat-input"]');
        var contextText = inputArea
          ? ((inputArea.closest('[data-testid="chat-composer"], form, section') || inputArea.parentElement || document.body).innerText || '')
          : pageText;
        if (detectRateLimitText(contextText)) {
          rateDetail = extractRateLimitDetail(contextText);
          var superGrokHeavy = isSuperGrokHeavyLimit(contextText);
          var submitHint = superGrokHeavy
            ? 'Submit disabled: SuperGrok Heavy limit reached. Your limit will reset soon.'
            : (rateDetail && rateDetail.minutesUntilReset
              ? 'Submit disabled: ' + rateDetail.minutesUntilReset + ' minutes before limit resets.'
              : 'Submit is disabled due to rate/quota limit.');
          var submitOut = {
            error: 'Chat submission blocked',
            kind: 'submit_disabled',
            reason: 'rate_limit',
            hint: submitHint,
            action: 'wait for limit reset, then retry'
          };
          if (rateDetail) submitOut.minutesUntilReset = rateDetail.minutesUntilReset;
          return submitOut;
        }
        return {
          error: 'Chat submission blocked',
          kind: 'submit_disabled',
          hint: 'Submit button is disabled — common causes: rate limits, account restrictions, or Grok still processing a prior request.',
          action: 'bun-browser open https://grok.com/ to inspect the page'
        };
      }
    }

    return null;
  }

  function clickSubmit() {
    var submit = getSubmitButton();
    if (!submit) return false;
    if (isSubmitDisabled(submit)) return false;
    submit.click();
    return true;
  }

  function dismissCookieBanner() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var labels = ['allow all', 'reject all', 'accept all', 'confirm my choices', 'close preference center'];
    for (var i = 0; i < labels.length; i++) {
      var match = buttons.find(function(b) {
        var text = ((b.innerText || b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
        return text.indexOf(labels[i]) !== -1;
      });
      if (match) {
        match.click();
        return true;
      }
    }
    return false;
  }

  function resolveGrokMode(raw) {
    var text = String(raw || 'fast').trim().toLowerCase();
    var aliases = {
      'grok-3': 'fast',
      'grok-4': 'expert',
      'grok-4-heavy': 'heavy',
      'team-of-experts': 'heavy'
    };
    if (aliases[text]) return aliases[text];
    if (MODE_LABELS[text]) return text;
    return text;
  }

  function isBetaRelatedMode(modeId) {
    var m = String(modeId || '').trim().toLowerCase();
    if (m === 'beta') return true;
    if (m.indexOf('beta') !== -1) return true;
    if (m.indexOf('grok-420') !== -1) return true;
    if (/grok[\s_-]?4\.3/.test(m)) return true;
    return false;
  }

  function resolveGrokModeWaitMs(modeId) {
    var resolved = resolveGrokMode(modeId);
    if (MODE_WAIT_MS[resolved] != null) return MODE_WAIT_MS[resolved];
    if (isBetaRelatedMode(resolved)) return MODE_WAIT_MS.beta;
    return MODE_WAIT_MS.fast;
  }

  function buildWaitOpts(rawArgs, modeId) {
    var opts = {};
    var hasMax = rawArgs.maxWaitMs != null && rawArgs.maxWaitMs !== '';
    opts.maxWaitMs = Math.max(
      1000,
      hasMax ? Number(rawArgs.maxWaitMs) : resolveGrokModeWaitMs(modeId)
    );
    if (rawArgs.graceWaitMs != null && rawArgs.graceWaitMs !== '') {
      opts.graceWaitMs = Math.max(0, Number(rawArgs.graceWaitMs));
    }
    return opts;
  }

  async function fetchModesCatalog() {
    if (globalThis.__grokModesCatalog) return globalThis.__grokModesCatalog;
    try {
      var resp = await fetch('/rest/modes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!resp.ok) return null;
      var data = await resp.json();
      var map = {};
      var modes = data.modes || [];
      for (var i = 0; i < modes.length; i++) {
        map[modes[i].id] = modes[i];
      }
      globalThis.__grokModesCatalog = map;
      return map;
    } catch (e) {
      return null;
    }
  }

  function getModeTitle(modeId, catalog) {
    if (catalog && catalog[modeId] && catalog[modeId].title) {
      return catalog[modeId].title;
    }
    return MODE_LABELS[modeId] || modeId;
  }

  function isModeAvailable(modeId, catalog) {
    if (!catalog) return true;
    if (!catalog[modeId]) {
      // API omits unavailable modes (e.g. beta); don't treat missing as available.
      return !MODE_LABELS[modeId];
    }
    var availability = catalog[modeId].availability;
    if (!availability) return true;
    if (availability.requiresUpgrade) return false;
    if (availability.available === false) return false;
    return true;
  }

  function getModelMenuRoot() {
    return document.querySelector('[role="menu"], [data-radix-menu-content]');
  }

  function isModeTriggerElement(el) {
    var trigger = getModelSelectButton();
    return !!(trigger && (el === trigger || trigger.contains(el)));
  }

  function modeLabelsMatch(requestedMode, currentLabel, catalog) {
    if (!currentLabel) return false;
    var expectedTitle = getModeTitle(requestedMode, catalog);
    var current = String(currentLabel).trim().toLowerCase();
    var expected = String(expectedTitle).trim().toLowerCase();
    if (current === expected) return true;
    if (requestedMode === 'beta' && /grok 4\.3/i.test(currentLabel)) return false;
    if (requestedMode === 'grok-420-computer-use-sa' && current === 'beta') return false;
    if (requestedMode === 'heavy' && current === 'beta') return false;
    if (requestedMode === 'beta' && current === 'heavy') return false;
    return false;
  }

  function getModelSelectButton() {
    return document.getElementById('model-select-trigger') || Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b) {
      var label = (b.getAttribute('aria-label') || '').toLowerCase();
      return label === 'model select';
    }) || null;
  }

  function readStoredGrokMode() {
    try {
      var raw = localStorage.getItem('modes-selected-id');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeStoredGrokMode(modeId) {
    try {
      localStorage.setItem('modes-selected-id', JSON.stringify(modeId));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function openModelMenu() {
    dismissCookieBanner();
    var btn = getModelSelectButton();
    if (!btn) return false;

    btn.focus();
    btn.click();
    await sleep(1200);
    if (btn.getAttribute('data-state') === 'open' || btn.getAttribute('aria-expanded') === 'true') {
      return true;
    }

    var rect = btn.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    ['mousedown', 'mouseup', 'click'].forEach(function(type) {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    });
    await sleep(1200);
    return btn.getAttribute('data-state') === 'open' ||
      btn.getAttribute('aria-expanded') === 'true' ||
      !!document.querySelector('[role="menu"], [data-radix-menu-content]');
  }

  function readGrokModeLabel() {
    var btn = getModelSelectButton();
    if (!btn) return null;
    var text = (btn.innerText || btn.textContent || '').trim();
    if (!text) return null;
    return text.split('\n')[0].trim();
  }

  function modeLabelMatches(requestedMode, currentLabel, catalog) {
    return modeLabelsMatch(requestedMode, currentLabel, catalog);
  }

  function findModeOptionElement(modeId, catalog) {
    var menu = getModelMenuRoot();
    var root = menu || document;
    var modeTitle = getModeTitle(modeId, catalog);
    var wantedTitle = String(modeTitle).trim().toLowerCase();
    var wantedId = String(modeId).trim().toLowerCase();

    var attrSelectors = [
      '[data-mode-id="' + modeId + '"]',
      '[data-value="' + modeId + '"]',
      '[data-mode="' + modeId + '"]'
    ];
    for (var a = 0; a < attrSelectors.length; a++) {
      var byAttr = root.querySelector(attrSelectors[a]);
      if (byAttr && !isModeTriggerElement(byAttr)) return byAttr;
    }

    var selectors = 'button, [role="menuitem"], [role="option"], [role="menuitemradio"], div[role="button"], [data-radix-collection-item]';
    var options = Array.prototype.slice.call(root.querySelectorAll(selectors));
    for (var i = 0; i < options.length; i++) {
      var el = options[i];
      if (isModeTriggerElement(el)) continue;
      var text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;
      var firstLine = text.split('\n')[0].trim().toLowerCase();
      if (firstLine === wantedTitle) return el;
      if (firstLine === wantedId) return el;
    }

    var scope = menu || document.body;
    var leaves = Array.prototype.slice.call(scope.querySelectorAll('span, div, p, li'));
    for (var j = 0; j < leaves.length; j++) {
      var node = leaves[j];
      if (node.children.length > 0) continue;
      var nodeText = (node.textContent || '').trim();
      if (nodeText.toLowerCase() !== wantedTitle) continue;
      var clickable = node.closest('button,[role="menuitem"],[role="option"],[role="menuitemradio"],div[role="button"],[data-radix-collection-item],label');
      if (clickable && !isModeTriggerElement(clickable)) return clickable;
    }
    return null;
  }

  async function setGrokMode(modeId) {
    var requested = resolveGrokMode(modeId);
    var reloadKey = '__grokModePendingReload';
    var catalog = await fetchModesCatalog();
    dismissCookieBanner();

    if (catalog && !isModeAvailable(requested, catalog)) {
      return {
        ok: false,
        needsRetry: false,
        mode: requested,
        error: 'Mode not available for this account: ' + requested,
        hint: 'Run bun-browser site grok/modes to see available modes (heavy and beta are separate modes)'
      };
    }

    var pendingReload = null;
    try { pendingReload = sessionStorage.getItem(reloadKey); } catch (e) {}
    if (pendingReload === requested) {
      try { sessionStorage.removeItem(reloadKey); } catch (e) {}
      var reloadedLabel = readGrokModeLabel();
      var storedAfterReload = readStoredGrokMode();
      if (storedAfterReload === requested || modeLabelsMatch(requested, reloadedLabel, catalog)) {
        return {
          ok: true,
          changed: true,
          mode: requested,
          label: reloadedLabel,
          modeTitle: getModeTitle(requested, catalog),
          appliedVia: 'reload'
        };
      }
    }

    var storedMode = readStoredGrokMode();
    var currentLabel = readGrokModeLabel();
    if (storedMode === requested && modeLabelsMatch(requested, currentLabel, catalog)) {
      return {
        ok: true,
        changed: false,
        mode: requested,
        label: currentLabel,
        modeTitle: getModeTitle(requested, catalog)
      };
    }
    if (modeLabelsMatch(requested, currentLabel, catalog)) {
      writeStoredGrokMode(requested);
      return {
        ok: true,
        changed: false,
        mode: requested,
        label: currentLabel,
        modeTitle: getModeTitle(requested, catalog)
      };
    }

    var viaMenu = await tryApplyGrokModeViaMenu(requested, catalog);
    if (viaMenu && viaMenu.ok) return viaMenu;

    writeStoredGrokMode(requested);
    var storageLabel = await pollModeLabel(requested, catalog, 8, 400);
    if (modeLabelsMatch(requested, storageLabel, catalog)) {
      return {
        ok: true,
        changed: true,
        mode: requested,
        label: storageLabel,
        modeTitle: getModeTitle(requested, catalog),
        appliedVia: 'storage'
      };
    }

    writeStoredGrokMode(requested);
    var reloadResult = {
      ok: false,
      needsRetry: true,
      changed: true,
      mode: requested,
      modeTitle: getModeTitle(requested, catalog),
      error: 'Mode change requires page reload',
      hint: 'Re-run the same command to continue after Grok switches to ' + requested + ' (' + getModeTitle(requested, catalog) + ')'
    };
    try {
      if (sessionStorage.getItem(reloadKey) !== requested) {
        sessionStorage.setItem(reloadKey, requested);
        setTimeout(function() { location.reload(); }, 50);
      }
    } catch (e) {}
    return reloadResult;
  }

  var lastWaitPending = false;
  var lastWaitAbnormal = null;

  function wasLastWaitPending() {
    return lastWaitPending;
  }

  function getLastWaitAbnormal() {
    return lastWaitAbnormal;
  }

  function isGrokReplyPending(beforeCount, beforeText) {
    var messages = getAssistantMessages();
    if (messages.length <= beforeCount) return true;
    var latest = messages[messages.length - 1];
    if (!latest) return false;

    var text = getAssistantText(latest);
    if (text && text !== beforeText) {
      if (hasParsedJsonAnswer(text)) return false;
      if (looksLikeFinalAnswer(text)) return false;
    }

    if (isGrokGenerating()) return true;
    var latestRaw = (latest.innerText || latest.textContent || '').trim();
    if (!latestRaw) return true;
    if (isProgressText(latestRaw) && !hasParsedJsonAnswer(text)) return true;
    if (/Agents thinking/i.test(latestRaw) && !extractJsonBlock(latestRaw)) return true;
    if (latest.querySelector(
      '[aria-busy="true"], [data-testid="loading"], .animate-pulse, .animate-spin, [class*="streaming"], [class*="typing"]'
    )) {
      if (!hasParsedJsonAnswer(text)) return true;
    }
    if (/\{/.test(latestRaw) && !extractJsonBlock(latestRaw)) return true;
    if (/^```(?:json)?/im.test(latestRaw) && !extractJsonBlock(latestRaw)) return true;
    if (text && !looksLikeFinalAnswer(text)) return true;
    return false;
  }

  async function waitForAssistantAnswer(beforeCount, beforeText, opts) {
    opts = opts || {};
    var pollMs = opts.pollMs || GROK_CHAT_POLL_MS;
    var totalWaitMs = Math.max(1000, Number(opts.maxWaitMs) || GROK_CHAT_WAIT_MS);
    if (opts.graceWaitMs != null && opts.graceWaitMs !== '') {
      totalWaitMs += Math.max(0, Number(opts.graceWaitMs));
    }
    var stableNeeded = opts.stableNeeded || 2;
    var deadline = Date.now() + totalWaitMs;

    var answer = '';
    var stableRounds = 0;
    var lastText = '';
    var sawInFlight = false;
    lastWaitPending = false;
    lastWaitAbnormal = null;

    while (Date.now() < deadline) {
      await sleep(pollMs);
      var abnormal = detectGrokPageAbnormal({ skipSubmitCheck: true });
      if (abnormal) {
        lastWaitAbnormal = abnormal;
        lastWaitPending = false;
        return '';
      }
      var messages = getAssistantMessages();
      var latest = messages[messages.length - 1];
      var generating = isGrokGenerating();
      var pending = isGrokReplyPending(beforeCount, beforeText);
      if (generating || pending) sawInFlight = true;
      var rawText = latest ? getAssistantText(latest) : '';
      answer = rawText ? cleanAssistantText(rawText) : '';
      if (latest && messages.length > beforeCount && !generating && !pending) {
        var streamBlock = detectGrokResponseBlock(answer, latest);
        if (streamBlock) {
          lastWaitAbnormal = streamBlock;
          lastWaitPending = false;
          return '';
        }
      }
      var ready = looksLikeFinalAnswer(answer);

      var hasNewMessage = messages.length > beforeCount && ready;
      var hasUpdatedMessage = messages.length === beforeCount && ready && answer !== beforeText;

      if (hasNewMessage || hasUpdatedMessage) {
        if (hasParsedJsonAnswer(answer)) {
          if (answer === lastText) stableRounds++;
          else stableRounds = 0;
          lastText = answer;
          if (stableRounds >= stableNeeded) break;
        } else if (!generating && !pending) {
          if (answer === lastText) stableRounds++;
          else stableRounds = 0;
          lastText = answer;
          if (stableRounds >= stableNeeded) break;
        } else {
          stableRounds = 0;
          lastText = '';
        }

        if (Date.now() >= deadline - pollMs * 10 && ready && !generating && !pending && stableRounds >= 1) break;
      }
    }

    if (hasParsedJsonAnswer(answer)) {
      lastWaitPending = false;
      var parsedJson = extractJsonBlock(answer);
      return parsedJson || answer;
    }
    if (!looksLikeFinalAnswer(answer) || isGrokGenerating() || isGrokReplyPending(beforeCount, beforeText)) {
      var latestMsg = getAssistantMessages().slice(-1)[0];
      var pendingBlock = latestMsg ? detectGrokResponseBlock(getLatestAssistantResponseText(), latestMsg) : null;
      if (pendingBlock) {
        lastWaitAbnormal = pendingBlock;
        lastWaitPending = false;
        return '';
      }
      lastWaitPending = sawInFlight || isGrokReplyPending(beforeCount, beforeText) || isGrokGenerating();
      return '';
    }
    lastWaitPending = false;
    var finalBlock = detectGrokResponseBlock(answer);
    if (finalBlock) {
      lastWaitAbnormal = finalBlock;
      return '';
    }
    var json = extractJsonBlock(answer);
    return json || answer;
  }

  globalThis.__grokChatHelpers = {
    version: HELPERS_VERSION,
    GROK_CHAT_WAIT_MS: GROK_CHAT_WAIT_MS,
    MODE_WAIT_MS: MODE_WAIT_MS,
    GROK_CHAT_POLL_MS: GROK_CHAT_POLL_MS,
    sleep: sleep,
    getAssistantMessages: getAssistantMessages,
    getAssistantText: getAssistantText,
    cleanAssistantText: cleanAssistantText,
    isProgressText: isProgressText,
    looksLikeFinalAnswer: looksLikeFinalAnswer,
    isGrokGenerating: isGrokGenerating,
    isGrokReplyPending: isGrokReplyPending,
    wasLastWaitPending: wasLastWaitPending,
    getLastWaitAbnormal: getLastWaitAbnormal,
    detectGrokPageAbnormal: detectGrokPageAbnormal,
    detectGrokUnableToReply: detectGrokUnableToReply,
    findGrokRetryButton: findGrokRetryButton,
    clickGrokRetry: clickGrokRetry,
    detectGrokResponseBlock: detectGrokResponseBlock,
    checkGrokAnswerBlocked: checkGrokAnswerBlocked,
    getSubmitButton: getSubmitButton,
    resolveGrokMode: resolveGrokMode,
    resolveGrokModeWaitMs: resolveGrokModeWaitMs,
    buildWaitOpts: buildWaitOpts,
    readStoredGrokMode: readStoredGrokMode,
    readGrokModeLabel: readGrokModeLabel,
    setGrokMode: setGrokMode,
    getChatInput: getChatInput,
    getChatInputText: getChatInputText,
    verifyChatInput: verifyChatInput,
    fillChatInput: fillChatInput,
    setChatInput: setChatInput,
    clickSubmit: clickSubmit,
    waitForAssistantAnswer: waitForAssistantAnswer,
    extractJsonBlock: extractJsonBlock,
    parseAnswerJson: parseAnswerJson,
    hasParsedJsonAnswer: hasParsedJsonAnswer
  };
  return globalThis.__grokChatHelpers;})();

  function getConversationId() {
    var match = location.pathname.match(/\/c\/([^/?]+)/);
    return match ? match[1] : null;
  }

  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  var modeId = h.resolveGrokMode(args.model || 'fast');
  var waitOpts = h.buildWaitOpts(args, modeId);
  var waitOnly = parseBool(args.waitOnly, false);

  var accessBlock = h.detectGrokPageAbnormal();
  if (accessBlock) return accessBlock;

  if (waitOnly) {
    var existingMessages = h.getAssistantMessages();
    var pollBeforeCount = Math.max(0, existingMessages.length - 1);
    var pollBeforeText = pollBeforeCount < existingMessages.length
      ? h.getAssistantText(existingMessages[pollBeforeCount]) || ''
      : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal && waitAbnormal.kind === 'transient_error') {
        var waitRetryClick = await h.clickGrokRetry();
        if (waitRetryClick.ok) {
          waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
          if (!waitedAnswer) waitAbnormal = h.getLastWaitAbnormal();
        }
      }
      if (!waitedAnswer) {
        if (waitAbnormal) return waitAbnormal;
        var waitReplyBlock = h.checkGrokAnswerBlocked('');
        if (waitReplyBlock) return waitReplyBlock;
        if (h.wasLastWaitPending()) {
          return {
            error: 'Still generating',
            hint: 'Grok 仍在生成，请用 waitOnly 继续等待当前回复',
            action: 'retry with waitOnly: true'
          };
        }
        return {
          error: 'Empty response',
          hint: 'Grok 未返回内容，可能页面结构已变化',
          action: 'bun-browser open https://grok.com/'
        };
      }
    }
    var waitReplyAnswerBlock = h.checkGrokAnswerBlocked(waitedAnswer);
    if (waitReplyAnswerBlock) return waitReplyAnswerBlock;
    var waitOut = {
      query: args.query,
      model: modeId,
      modeLabel: h.readGrokModeLabel(),
      answer: waitedAnswer,
      conversationId: getConversationId(),
      waitOnly: true
    };
    var waitAnswerJson = h.parseAnswerJson(waitedAnswer);
    if (waitAnswerJson) {
      waitOut.answerJson = waitAnswerJson;
      waitOut.answerFormat = 'json';
    }
    return waitOut;
  }

  const startNewChat = args.newChat !== false;

  if (startNewChat) {
    var newChat = document.querySelector('[data-testid="new-chat"]');
    if (newChat) {
      newChat.click();
      await h.sleep(1200);
    } else if (location.pathname.indexOf('/c/') === 0) {
      location.href = 'https://grok.com/';
      await h.sleep(1500);
    }
  }

  if (!document.querySelector('[data-testid="chat-input"]')) {
    return {
      error: 'Chat input not found',
      hint: 'Grok 页面未加载完成，请刷新 grok.com 后重试',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var modeResult = await h.setGrokMode(modeId);
  if (modeResult.needsRetry) {
    return {
      error: 'Mode change requires page reload',
      hint: modeResult.hint || ('Re-run the same command after Grok switches to ' + modeId),
      requestedMode: modeId,
      action: 'retry same command'
    };
  }
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.error || ('Could not select Grok mode "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site grok/modes'
    };
  }
  var beforeCount = h.getAssistantMessages().length;
  var beforeText = h.getAssistantMessages().map(h.getAssistantText).join('\n');

  var fillResult = await h.fillChatInput(args.query);
  if (!fillResult.ok) {
    return {
      error: fillResult.error || 'Prompt truncated in composer',
      kind: fillResult.kind || 'input_truncated',
      hint: 'Grok composer did not accept the full prompt (' + (fillResult.inputCheck?.actualLen || 0) + '/' + (fillResult.inputCheck?.expectedLen || args.query.length) + ' chars).',
      inputCheck: fillResult.inputCheck,
      action: 'retry same command or shorten prompt'
    };
  }
  await h.sleep(200);

  accessBlock = h.detectGrokPageAbnormal();
  if (accessBlock) return accessBlock;

  if (!h.clickSubmit()) {
    accessBlock = h.detectGrokPageAbnormal();
    if (accessBlock) return accessBlock;
    return {
      error: 'Submit button not found',
      hint: '无法在 Grok 页面找到发送按钮，请刷新页面后重试',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);

  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal && answerAbnormal.kind === 'transient_error') {
      var retryClick = await h.clickGrokRetry();
      if (retryClick.ok) {
        answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
        if (!answer) answerAbnormal = h.getLastWaitAbnormal();
      }
    }
    if (!answer) {
      if (answerAbnormal) return answerAbnormal;
      var replyBlock = h.checkGrokAnswerBlocked('');
      if (replyBlock) return replyBlock;
      if (h.wasLastWaitPending()) {
        return {
          error: 'Still generating',
          hint: 'Grok 仍在生成（搜索/工具调用/流式输出中），请用 waitOnly 继续等待',
          action: 'retry with waitOnly: true'
        };
      }
      return {
        error: 'Empty response',
        hint: 'Grok 未返回内容，可能页面结构已变化',
        action: 'bun-browser open https://grok.com/'
      };
    }
  }

  var replyAnswerBlock = h.checkGrokAnswerBlocked(answer);
  if (replyAnswerBlock) return replyAnswerBlock;

  var out = {
    query: args.query,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readGrokModeLabel(),
    answer: answer,
    conversationId: getConversationId()
  };
  var answerJson = h.parseAnswerJson(answer);
  if (answerJson) {
    out.answerJson = answerJson;
    out.answerFormat = 'json';
  }
    if (args.disableSearch === true) out.disableSearch = true;
  return out;
}
