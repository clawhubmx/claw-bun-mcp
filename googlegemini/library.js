/* @meta
{
  "name": "googlegemini/library",
  "description": "List Gemini Library creations: Canvas docs, Deep Research, images, videos (My Stuff)",
  "domain": "gemini.google.com",
  "args": {
    "section": {"required": false, "description": "all (default), media, documents"},
    "limit": {"required": false, "description": "Max items per section (default 20, max 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/library"
}
*/

async function(args) {
  var h = (function installGeminiChatHelpers() {
  var HELPERS_VERSION = 13;
  var GEMINI_MOBILE_BREAKPOINT = 768;

  var GEMINI_CHAT_WAIT_MS = 15 * 60 * 1000;
  var GEMINI_CHAT_POLL_MS = 500;
  var MODE_WAIT_MS = {
    flash: 15 * 60 * 1000,
    thinking: 25 * 60 * 1000,
    pro: 25 * 60 * 1000
  };

  var MODE_LABELS = {
    flash: '3.5 Flash',
    thinking: '3.5 Thinking',
    pro: '3.1 Pro'
  };

  if (globalThis.__geminiChatHelpers && globalThis.__geminiChatHelpers.version === HELPERS_VERSION) {
    return globalThis.__geminiChatHelpers;
  }

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

  function tapElement(el) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    el.click();
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

  function findElementsByAriaLabel(pattern, root) {
    root = root || document;
    var re = pattern instanceof RegExp ? pattern : new RegExp('^' + pattern + '$', 'i');
    var nodes = Array.prototype.slice.call(root.querySelectorAll(
      'button, a, [role="button"], [role="menuitem"], [role="option"]'
    ));
    return nodes.filter(function(el) {
      var label = el.getAttribute('aria-label') || '';
      var text = (el.innerText || el.textContent || '').trim();
      return re.test(label) || (text && re.test(text));
    });
  }

  function findVisibleElement(candidates) {
    if (!candidates || !candidates.length) return null;
    for (var i = 0; i < candidates.length; i++) {
      if (isElementVisible(candidates[i])) return candidates[i];
    }
    return candidates[0];
  }

  function findByAriaLabel(pattern, root) {
    return findVisibleElement(findElementsByAriaLabel(pattern, root));
  }

  async function dismissOpenOverlays() {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
  }

  function getAssistantMessages() {
    return Array.prototype.slice.call(document.querySelectorAll('model-response'));
  }

  function getStopButton() {
    return findVisibleElement(Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b) {
      var label = (b.getAttribute('aria-label') || '').toLowerCase();
      return label.indexOf('stop') !== -1;
    })) || null;
  }

  function stripRolePrefix(text) {
    if (!text) return '';
    return String(text)
      .replace(/^Gemini said\s*\n+/i, '')
      .replace(/^You said\s*\n+/i, '')
      .trim();
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

  function isProgressLine(line) {
    var t = String(line || '').trim();
    if (!t) return false;
    if (/^Gemini said$/i.test(t)) return true;
    if (/^You said$/i.test(t)) return true;
    if (/^Show thinking$/i.test(t)) return true;
    if (/^Hide thinking$/i.test(t)) return true;
    if (/^Thinking\b/i.test(t)) return true;
    if (/^Drafting\b/i.test(t)) return true;
    if (/^Searching\b/i.test(t)) return true;
    if (/^Reading\b/i.test(t)) return true;
    return false;
  }

  function isProgressText(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t) return true;
    if (/^Show thinking$/i.test(t)) return true;
    if (/^Hide thinking$/i.test(t)) return true;
    var lines = t.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return true;
    return lines.every(isProgressLine);
  }

  function looksLikeFinalAnswer(text) {
    if (!text) return false;
    var t = stripRolePrefix(String(text).trim());
    if (!t || isProgressText(t)) return false;
    var json = extractJsonBlock(t);
    if (json) {
      try {
        JSON.parse(json);
        return true;
      } catch (e) {}
    }
    if (t.length < 2) return false;
    if (/^[A-Za-z0-9_-]+$/.test(t)) return true;
    if (/[.!?]/.test(t) && /[A-Za-z0-9]{2,}/.test(t)) return true;
    if (t.length >= 8) return true;
    return false;
  }

  function cleanAssistantText(text) {
    if (!text) return '';
    var cleaned = stripRolePrefix(String(text));
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

    var contentSelectors = [
      'message-content.model-response-text .markdown',
      'message-content.model-response-text',
      '.response-content message-content',
      '.response-content .markdown',
      'message-content',
      '.response-content'
    ];
    for (var s = 0; s < contentSelectors.length; s++) {
      var node = el.querySelector(contentSelectors[s]);
      if (node) pushCandidate(node.innerText || node.textContent || '');
    }

    var codeNodes = el.querySelectorAll('pre code, pre');
    for (var c = 0; c < codeNodes.length; c++) {
      pushCandidate(codeNodes[c].innerText || codeNodes[c].textContent || '');
    }

    pushCandidate(el.innerText || el.textContent || '');

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

  function isGeminiGenerating() {
    var stop = getStopButton();
    if (stop && !stop.disabled && stop.getAttribute('aria-disabled') !== 'true') return true;

    var messages = getAssistantMessages();
    var latest = messages[messages.length - 1];
    if (!latest) return false;

    if (latest.querySelector('[aria-busy="true"], mat-progress-spinner, .loading, .animate-pulse, .animate-spin')) {
      return true;
    }

    var extracted = getAssistantText(latest);
    if (extracted && hasParsedJsonAnswer(extracted)) return false;
    if (extracted && looksLikeFinalAnswer(extracted)) return false;

    return false;
  }

  function getChatEditor() {
    var selectors = [
      '.ql-editor[contenteditable="true"]',
      '[aria-label="Enter a prompt for Gemini"][contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
      '.ql-editor',
      'div.textarea.new-input-ui[contenteditable="true"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(selectors[i]));
      var visible = findVisibleElement(nodes);
      if (visible) return visible;
    }
    return null;
  }

  function setChatInput(value) {
    var editor = getChatEditor();
    if (!editor) return false;
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, value);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return true;
  }

  function getSubmitButton() {
    return findByAriaLabel(/^send message$/i) ||
      findVisibleElement(Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(b) {
        return /send/i.test(b.getAttribute('aria-label') || '');
      }));
  }

  function isSubmitDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    return false;
  }

  function clickSubmit() {
    var submit = getSubmitButton();
    if (!submit || isSubmitDisabled(submit)) return false;
    clickElement(submit);
    return true;
  }

  function getVisiblePageText(maxLen) {
    maxLen = maxLen || 12000;
    var text = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function findSignInButton() {
    return Array.prototype.slice.call(document.querySelectorAll('button, a')).find(function(el) {
      var label = ((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
      return /^sign in$/i.test(label);
    }) || null;
  }

  function hasGoogleAuthCookie() {
    var names = ['SID', 'HSID', 'SSID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'];
    var cookies = document.cookie.split(';').map(function(c) { return c.trim().split('=')[0]; });
    for (var i = 0; i < names.length; i++) {
      if (cookies.indexOf(names[i]) !== -1) return true;
    }
    return false;
  }

  function getLoginState() {
    if (hasGoogleAuthCookie()) return { loggedIn: true, anonymous: false };
    if (findSignInButton()) return { loggedIn: false, anonymous: true };
    return { loggedIn: true, anonymous: false };
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
    if (!getChatEditor() &&
      /verify you are human|checking if the site connection is secure|cf-browser-verification|ddos protection by cloudflare/i.test(text)) {
      return true;
    }
    return false;
  }

  function detectRateLimitText(text) {
    if (/message\s+limit\s+reached/i.test(text)) return true;
    if (/rate\s+limit/i.test(text) && /reset|wait|try again|minutes?/i.test(text)) return true;
    if (/too many (messages|requests)/i.test(text)) return true;
    if (/you.?ve reached your limit/i.test(text)) return true;
    if (/quota/i.test(text) && /exceeded|limit|reached/i.test(text)) return true;
    return false;
  }

  function detectGeminiPageAbnormal(opts) {
    opts = opts || {};
    var skipSubmitCheck = opts.skipSubmitCheck === true;

    if (detectCloudflareBlock()) {
      return {
        error: 'Cloudflare verification required',
        kind: 'cloudflare',
        hint: 'Cloudflare challenge detected. Open gemini.google.com in the browser and complete verification manually.',
        action: 'bun-browser open https://gemini.google.com/'
      };
    }

    var pageText = getVisiblePageText();
    if (detectRateLimitText(pageText)) {
      return {
        error: 'Chat rate limit reached',
        kind: 'rate_limit',
        hint: 'Rate limit or quota message detected on page. Wait before retrying.',
        action: 'wait for limit reset, then retry'
      };
    }

    if (!skipSubmitCheck) {
      var submit = getSubmitButton();
      if (submit && isSubmitDisabled(submit)) {
        var editor = getChatEditor();
        var editorText = editor ? String(editor.innerText || editor.textContent || '').trim() : '';
        if (!editorText) {
          return null;
        }
        var contextText = getVisiblePageText(6000);
        if (detectRateLimitText(contextText)) {
          return {
            error: 'Chat submission blocked',
            kind: 'submit_disabled',
            reason: 'rate_limit',
            hint: 'Submit is disabled due to rate/quota limit.',
            action: 'wait for limit reset, then retry'
          };
        }
        return {
          error: 'Chat submission blocked',
          kind: 'submit_disabled',
          hint: 'Send button is disabled — common causes: empty input, rate limits, or Gemini still processing a prior request.',
          action: 'bun-browser open https://gemini.google.com/'
        };
      }
    }

    return null;
  }

  function detectGeminiWorkspaceRequired(text) {
    if (!text) return false;
    var t = String(text);
    if (/connect\s+google\s+workspace/i.test(t)) return true;
    if (/need to connect google workspace/i.test(t)) return true;
    if (/google\s+workspace/i.test(t) && /turn on this app|connect\b/i.test(t)) return true;
    return false;
  }

  function buildGeminiWorkspaceError(sourceText) {
    var message = '';
    if (sourceText) {
      var lines = String(sourceText).split('\n').map(function(line) {
        return line.trim();
      }).filter(Boolean);
      for (var i = 0; i < lines.length; i++) {
        if (/connect.*workspace|workspace.*turn on|need to connect/i.test(lines[i])) {
          message = lines[i];
          break;
        }
      }
      if (!message) message = lines.slice(0, 3).join(' ');
    }
    return {
      error: 'Google Workspace not connected',
      kind: 'workspace_required',
      message: message || 'Connect Google Workspace to use this Gemini feature (e.g. Canvas).',
      hint: 'Open gemini.google.com in the browser and connect Google Workspace when prompted.',
      action: 'bun-browser open https://gemini.google.com/app'
    };
  }

  function getLatestAssistantResponseText() {
    var messages = getAssistantMessages();
    var latest = messages[messages.length - 1];
    if (!latest) return '';
    return stripRolePrefix((latest.innerText || latest.textContent || '').trim());
  }

  function detectGeminiResponseBlock(text, rootEl) {
    var sources = [];
    if (text) sources.push(String(text));
    if (rootEl) {
      sources.push(stripRolePrefix((rootEl.innerText || rootEl.textContent || '').trim()));
    }
    for (var i = 0; i < sources.length; i++) {
      if (detectGeminiWorkspaceRequired(sources[i])) {
        return buildGeminiWorkspaceError(sources[i]);
      }
    }
    return null;
  }

  function checkGeminiAnswerBlocked(answer) {
    var block = detectGeminiResponseBlock(answer);
    if (!block) block = detectGeminiResponseBlock(getLatestAssistantResponseText());
    if (!block) {
      var latest = getAssistantMessages().slice(-1)[0];
      if (latest) block = detectGeminiResponseBlock('', latest);
    }
    return block;
  }

  function resolveGeminiMode(raw) {
    var text = String(raw || 'flash').trim().toLowerCase();
    var aliases = {
      '3.5-flash': 'flash',
      '3.5flash': 'flash',
      'flash-3.5': 'flash',
      '3.5-thinking': 'thinking',
      '3.5thinking': 'thinking',
      'thinking-3.5': 'thinking',
      '3.1-pro': 'pro',
      '3.1pro': 'pro',
      'pro-3.1': 'pro',
      'gemini-pro': 'pro'
    };
    if (aliases[text]) return aliases[text];
    if (MODE_LABELS[text]) return text;
    return text;
  }

  function resolveGeminiModeWaitMs(modeId) {
    var resolved = resolveGeminiMode(modeId);
    if (MODE_WAIT_MS[resolved] != null) return MODE_WAIT_MS[resolved];
    return GEMINI_CHAT_WAIT_MS;
  }

  function buildWaitOpts(rawArgs, modeId) {
    var opts = {};
    var hasMax = rawArgs.maxWaitMs != null && rawArgs.maxWaitMs !== '';
    opts.maxWaitMs = Math.max(
      1000,
      hasMax ? Number(rawArgs.maxWaitMs) : resolveGeminiModeWaitMs(modeId)
    );
    if (rawArgs.graceWaitMs != null && rawArgs.graceWaitMs !== '') {
      opts.graceWaitMs = Math.max(0, Number(rawArgs.graceWaitMs));
    }
    return opts;
  }

  function getModelPickerButton() {
    return findByAriaLabel(/^open mode picker/i);
  }

  function readGeminiModeLabel() {
    var btn = getModelPickerButton();
    if (!btn) return null;
    var label = btn.getAttribute('aria-label') || '';
    var match = label.match(/currently\s+(.+)$/i);
    if (match) return match[1].trim();
    var text = (btn.innerText || btn.textContent || '').trim();
    return text ? text.split('\n')[0].trim() : null;
  }

  function normalizeModeLabel(label) {
    return String(label || '').trim().toLowerCase();
  }

  function modeLabelMatches(requestedMode, currentLabel) {
    if (!currentLabel) return false;
    var resolved = resolveGeminiMode(requestedMode);
    var current = normalizeModeLabel(currentLabel);

    if (resolved === 'flash') {
      if (/flash-lite/i.test(current) || (/\/lite\b/i.test(current) && /flash/i.test(current))) return true;
      if (/pro|thinking/i.test(current) && !/flash/i.test(current)) return false;
      if (/flash/i.test(current) || current === 'flash') return true;
    }
    if (resolved === 'thinking') {
      if (/thinking/i.test(current)) return true;
    }
    if (resolved === 'pro') {
      if (/pro/i.test(current)) return true;
    }

    var expected = MODE_LABELS[resolved] || requestedMode;
    var wanted = normalizeModeLabel(expected);
    if (current === wanted) return true;
    if (current.indexOf(wanted) !== -1 || wanted.indexOf(current) !== -1) return true;
    return false;
  }

  async function openModelMenu() {
    await dismissOpenOverlays();
    var btn = getModelPickerButton();
    if (!btn) return false;
    btn.click();
    await sleep(800);
    return !!document.querySelector('[role="menu"], [role="listbox"], [role="menuitem"]');
  }

  function getModeMenuRoot() {
    return document.querySelector('[role="menu"], [role="listbox"]') || document;
  }

  function findModeOptionElement(modeId) {
    var resolved = resolveGeminiMode(modeId);
    var title = MODE_LABELS[resolved] || resolved;
    var wanted = String(title).trim().toLowerCase();
    var root = getModeMenuRoot();
    var options = Array.prototype.slice.call(root.querySelectorAll('[role="menuitem"], [role="option"], button'))
      .filter(isElementVisible);

    function firstLine(el) {
      return ((el.innerText || el.textContent || '').trim().split('\n')[0] || '').trim().toLowerCase();
    }

    for (var i = 0; i < options.length; i++) {
      var line = firstLine(options[i]);
      if (!line) continue;
      if (line === wanted) return options[i];
      if (line.indexOf(wanted) === 0) return options[i];
    }

    if (resolved === 'flash') {
      for (var j = 0; j < options.length; j++) {
        var flashLine = firstLine(options[j]);
        if (flashLine.indexOf('3.5') !== -1 && flashLine.indexOf('flash') !== -1) return options[j];
      }
      for (var k = 0; k < options.length; k++) {
        var genericFlash = firstLine(options[k]);
        if (genericFlash === 'flash') return options[k];
        if (genericFlash.indexOf('flash') !== -1 &&
          genericFlash.indexOf('lite') === -1 &&
          genericFlash.indexOf('thinking') === -1) {
          return options[k];
        }
      }
      for (var l = 0; l < options.length; l++) {
        var liteLine = firstLine(options[l]);
        if (liteLine.indexOf('flash') !== -1 && liteLine.indexOf('lite') !== -1) return options[l];
      }
    }
    if (resolved === 'pro') {
      for (var p = 0; p < options.length; p++) {
        if (firstLine(options[p]).indexOf('pro') !== -1) return options[p];
      }
    }
    if (resolved === 'thinking') {
      for (var t = 0; t < options.length; t++) {
        if (firstLine(options[t]).indexOf('thinking') !== -1) return options[t];
      }
    }
    return null;
  }

  async function setGeminiMode(modeId) {
    var requested = resolveGeminiMode(modeId);
    var currentLabel = readGeminiModeLabel();
    if (modeLabelMatches(requested, currentLabel)) {
      return {
        ok: true,
        changed: false,
        mode: requested,
        label: currentLabel,
        modeTitle: MODE_LABELS[requested] || requested
      };
    }

    if (!getModelPickerButton()) {
      if (modeLabelMatches(requested, currentLabel) || !currentLabel) {
        return {
          ok: true,
          changed: false,
          mode: requested,
          label: currentLabel,
          modeTitle: MODE_LABELS[requested] || requested,
          appliedVia: 'unavailable-picker'
        };
      }
    }

    if (await openModelMenu()) {
      var option = findModeOptionElement(requested);
      if (option) {
        clickElement(option);
        await sleep(1200);
        var appliedLabel = readGeminiModeLabel();
        if (modeLabelMatches(requested, appliedLabel)) {
          return {
            ok: true,
            changed: true,
            mode: requested,
            label: appliedLabel,
            modeTitle: MODE_LABELS[requested] || requested,
            appliedVia: 'ui'
          };
        }
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);
    }

    var finalLabel = readGeminiModeLabel();
    if (modeLabelMatches(requested, finalLabel)) {
      return {
        ok: true,
        changed: false,
        mode: requested,
        label: finalLabel,
        modeTitle: MODE_LABELS[requested] || requested,
        appliedVia: 'current'
      };
    }

    return {
      ok: false,
      changed: false,
      mode: requested,
      modeTitle: MODE_LABELS[requested] || requested,
      currentLabel: finalLabel,
      error: 'Mode selection failed',
      hint: 'Could not switch to ' + (MODE_LABELS[requested] || requested) +
        (finalLabel ? (' (current: ' + finalLabel + ')') : '') +
        '. Run googlegemini/modes to see available models.'
    };
  }

  async function listGeminiModesFromUi() {
    if (!(await openModelMenu())) {
      return { modes: [], current: readGeminiModeLabel() };
    }
    var items = Array.prototype.slice.call(document.querySelectorAll('[role="menuitem"]'));
    var modes = [];
    for (var i = 0; i < items.length; i++) {
      var text = (items[i].innerText || items[i].textContent || '').trim();
      if (!text || /sign in for all models/i.test(text)) continue;
      var lines = text.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
      if (!lines.length) continue;
      modes.push({
        title: lines[0],
        description: lines[1] || null,
        available: true
      });
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    return { modes: modes, current: readGeminiModeLabel() };
  }

  async function startNewChat() {
    var onFreshApp = location.pathname.match(/^\/app\/?$/) &&
      document.querySelectorAll('model-response').length === 0;
    if (onFreshApp) return { ok: true, navigated: false };

    await dismissOpenOverlays();
    var btn = findByAriaLabel(/^new chat$/i);
    if (btn) {
      btn.click();
      await sleep(1500);
      var cleared = document.querySelectorAll('model-response').length === 0;
      var onApp = !!location.pathname.match(/^\/app\/?$/);
      if (cleared || onApp) return { ok: true, navigated: false };
      return {
        ok: false,
        navigated: true,
        hint: 'New chat is still loading. Re-run the same command.',
        action: 'retry same command'
      };
    }

    return {
      ok: false,
      navigated: true,
      hint: 'Open a fresh Gemini tab before starting a new chat.',
      action: 'bun-browser open https://gemini.google.com/app'
    };
  }

  var lastWaitPending = false;
  var lastWaitAbnormal = null;

  function wasLastWaitPending() {
    return lastWaitPending;
  }

  function getLastWaitAbnormal() {
    return lastWaitAbnormal;
  }

  function isGeminiReplyPending(beforeCount, beforeText) {
    var messages = getAssistantMessages();
    if (messages.length <= beforeCount) return true;
    var latest = messages[messages.length - 1];
    if (!latest) return false;

    var text = getAssistantText(latest);
    if (text && text !== beforeText) {
      if (hasParsedJsonAnswer(text)) return false;
      if (looksLikeFinalAnswer(text)) return false;
    }

    if (isGeminiGenerating()) return true;
    var latestRaw = stripRolePrefix((latest.innerText || latest.textContent || '').trim());
    if (!latestRaw) return true;
    if (isProgressText(latestRaw) && !hasParsedJsonAnswer(text)) return true;
    if (text && !looksLikeFinalAnswer(text)) return true;
    return false;
  }

  async function waitForAssistantAnswer(beforeCount, beforeText, opts) {
    opts = opts || {};
    var pollMs = opts.pollMs || GEMINI_CHAT_POLL_MS;
    var totalWaitMs = Math.max(1000, Number(opts.maxWaitMs) || GEMINI_CHAT_WAIT_MS);
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
      var abnormal = detectGeminiPageAbnormal({ skipSubmitCheck: true });
      if (abnormal) {
        lastWaitAbnormal = abnormal;
        lastWaitPending = false;
        return '';
      }
      var messages = getAssistantMessages();
      var latest = messages[messages.length - 1];
      var generating = isGeminiGenerating();
      var pending = isGeminiReplyPending(beforeCount, beforeText);
      if (generating || pending) sawInFlight = true;
      var rawText = latest ? getAssistantText(latest) : '';
      answer = rawText ? cleanAssistantText(rawText) : '';
      if (latest && messages.length > beforeCount && !generating && !pending) {
        var streamBlock = detectGeminiResponseBlock(answer, latest);
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
          if (stableRounds >= 1) break;
        } else if (!generating && !pending) {
          if (answer === lastText) stableRounds++;
          else stableRounds = 0;
          lastText = answer;
          if (stableRounds >= stableNeeded) break;
        } else {
          stableRounds = 0;
          lastText = '';
        }

        if (Date.now() >= deadline - pollMs * 10 && ready && !generating && !pending) break;
      }
    }

    if (hasParsedJsonAnswer(answer)) {
      lastWaitPending = false;
      var parsedJson = extractJsonBlock(answer);
      return parsedJson || answer;
    }
    if (!looksLikeFinalAnswer(answer) || isGeminiGenerating() || isGeminiReplyPending(beforeCount, beforeText)) {
      var latestMsg = getAssistantMessages().slice(-1)[0];
      var pendingBlock = latestMsg ? detectGeminiResponseBlock(getLatestAssistantResponseText(), latestMsg) : null;
      if (pendingBlock) {
        lastWaitAbnormal = pendingBlock;
        lastWaitPending = false;
        return '';
      }
      lastWaitPending = sawInFlight || isGeminiReplyPending(beforeCount, beforeText) || isGeminiGenerating();
      return '';
    }
    lastWaitPending = false;
    var finalBlock = detectGeminiResponseBlock(answer);
    if (finalBlock) {
      lastWaitAbnormal = finalBlock;
      return '';
    }
    var json = extractJsonBlock(answer);
    return json || answer;
  }

  function getGeminiViewport() {
    var width = Math.round(window.innerWidth || document.documentElement.clientWidth || 0);
    var height = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
    var layout = width > 0 && width < GEMINI_MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
    if (document.querySelector('.is-mobile, chat-app.is-mobile, [class*="is-mobile"]')) {
      layout = 'mobile';
    }
    return { width: width, height: height, layout: layout };
  }

  function isGeminiMobileLayout() {
    return getGeminiViewport().layout === 'mobile';
  }

  function isGeminiSidebarOpen() {
    var closeBtn = findByAriaLabel(/^close sidebar$/i);
    if (closeBtn && isElementVisible(closeBtn)) return true;
    var opened = document.querySelector(
      'mat-sidenav.mat-drawer-opened, mat-sidenav.opened, mat-sidenav[opened]'
    );
    if (opened && isElementVisible(opened)) return true;
    if (!isGeminiMobileLayout()) {
      var nav = document.querySelector('side-navigation-v2, mat-sidenav');
      if (nav && isElementVisible(nav)) return true;
    }
    return false;
  }

  async function ensureGeminiSidebarOpen() {
    if (isGeminiSidebarOpen()) return { ok: true, changed: false };
    var openBtn = findByAriaLabel(/^open sidebar$/i);
    if (!openBtn) return { ok: false, changed: false };
    clickElement(openBtn);
    await sleep(500);
    return { ok: isGeminiSidebarOpen(), changed: true };
  }

  async function dismissGeminiSidebarIfBlocking() {
    if (!isGeminiMobileLayout()) return { ok: true, changed: false };
    var closeBtn = findByAriaLabel(/^close sidebar$/i);
    if (!closeBtn || !isElementVisible(closeBtn)) return { ok: true, changed: false };
    clickElement(closeBtn);
    await sleep(400);
    return { ok: true, changed: true };
  }

  async function waitForGeminiSelector(selectors, timeoutMs) {
    var list = selectors || [];
    var deadline = Date.now() + (timeoutMs || 12000);
    while (Date.now() < deadline) {
      for (var i = 0; i < list.length; i++) {
        if (document.querySelector(list[i])) return list[i];
      }
      await sleep(250);
    }
    return null;
  }

  async function navigateToGeminiPath(path, opts) {
    opts = opts || {};
    var normalized = path.charAt(0) === '/' ? path : '/' + path;
    var target = path.indexOf('http') === 0 ? path : 'https://gemini.google.com' + normalized;
    var current = location.href.replace(/#.*$/, '');
    if (current !== target.replace(/#.*$/, '')) {
      location.href = target;
      await sleep(opts.waitMs || 2000);
    }
    if (opts.selectors && opts.selectors.length) {
      var matched = await waitForGeminiSelector(opts.selectors, opts.timeoutMs || 12000);
      if (!matched) {
        return {
          ok: false,
          url: location.href,
          viewport: getGeminiViewport(),
          error: 'Page did not load expected content'
        };
      }
    }
    return { ok: true, url: location.href, viewport: getGeminiViewport() };
  }

  function parseConversationIdFromPath(path) {
    var match = String(path || '').match(/\/app\/([0-9a-f]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function parseConversationIdFromLocation() {
    return parseConversationIdFromPath(location.pathname);
  }

  function getGeminiSearchInput() {
    return findVisibleElement(Array.prototype.slice.call(document.querySelectorAll(
      'input[aria-label="Search chats"], input[placeholder="Search chats"]'
    )));
  }

  async function ensureGeminiSearchPage() {
    var nav = await navigateToGeminiPath('/search', {
      selectors: [
        'input[aria-label="Search chats"]',
        'search-zero-state',
        '.recent-conversations-container'
      ],
      timeoutMs: 12000
    });
    if (nav.ok && getGeminiSearchInput()) return nav;

    await ensureGeminiSidebarOpen();
    var searchNav = document.querySelector(
      '[data-test-id=search-chats-button] a, a[aria-label="Search chats"]'
    );
    if (searchNav) {
      clickElement(searchNav);
      await sleep(2000);
    }
    await dismissGeminiSidebarIfBlocking();
    return {
      ok: !!getGeminiSearchInput(),
      url: location.href,
      viewport: getGeminiViewport()
    };
  }

  function scrapeGeminiRecentChats(limit) {
    var root = document.querySelector('search-zero-state, .recent-conversations-container');
    if (!root) root = document;
    var items = Array.prototype.slice.call(
      root.querySelectorAll('.conversation-container[role="option"]')
    );
    return items.slice(0, limit).map(function(el) {
      var titleEl = el.querySelector('.title, .left-content-container .title');
      var dateEl = el.querySelector('.date, .right-content-container');
      var title = titleEl
        ? (titleEl.innerText || '').trim()
        : (el.innerText || '').split('\n')[0].trim();
      return {
        title: title,
        date: dateEl ? (dateEl.innerText || '').trim() : null,
        _clickTarget: el
      };
    }).filter(function(x) { return x.title; });
  }

  function scrapeGeminiSearchResults(limit) {
    var items = Array.prototype.slice.call(document.querySelectorAll('search-snippet'));
    return items.slice(0, limit).map(function(el) {
      var titleEl = el.querySelector('.title');
      var snippetEl = el.querySelector('.snippet, .snippet-content .gds-body-m, .result .gds-body-m');
      var dateEl = el.querySelector('.date, .right-content-container');
      var highlights = Array.prototype.slice.call(el.querySelectorAll('.highlighted-text'))
        .map(function(node) { return (node.innerText || '').trim(); })
        .filter(Boolean);
      return {
        title: titleEl ? (titleEl.innerText || '').trim() : '',
        snippet: snippetEl ? (snippetEl.innerText || '').trim().slice(0, 500) : null,
        date: dateEl ? (dateEl.innerText || '').trim() : null,
        highlights: highlights.length ? highlights : undefined,
        _clickTarget: el.querySelector('.snippet-container, .title') || el
      };
    }).filter(function(x) { return x.title; });
  }

  async function runGeminiChatSearch(query) {
    var input = getGeminiSearchInput();
    if (!input) return { ok: false, error: 'Search input not found' };
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
    await sleep(isGeminiMobileLayout() ? 3500 : 2500);
    var hasResults = document.querySelectorAll('search-snippet').length > 0;
    return { ok: hasResults, hasResults: hasResults };
  }

  async function resolveGeminiConversationId(clickTarget) {
    if (!clickTarget) return null;
    var beforePath = location.pathname;
    clickElement(clickTarget);
    await sleep(isGeminiMobileLayout() ? 2800 : 2000);
    var id = parseConversationIdFromPath(location.pathname);
    if (id && location.pathname !== beforePath) {
      history.back();
      await sleep(isGeminiMobileLayout() ? 1600 : 1200);
      return id;
    }
    return null;
  }

  async function resolveGeminiConversationIds(items, limit) {
    var resolved = [];
    var resolveCount = Math.min(items.length, Math.max(0, limit || 0));
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var out = {
        title: item.title,
        date: item.date || null
      };
      if (item.snippet) out.snippet = item.snippet;
      if (item.highlights) out.highlights = item.highlights;
      if (i < resolveCount && item._clickTarget) {
        var id = await resolveGeminiConversationId(item._clickTarget);
        if (id) {
          out.conversationId = id;
          out.url = 'https://gemini.google.com/app/' + id;
        }
      }
      resolved.push(out);
    }
    return resolved;
  }

  function dedupeLibraryItems(items) {
    var seen = {};
    return items.filter(function(item) {
      var key = (item.url || item.thumbnailUrl || '') + '|' + (item.title || '');
      if (seen[key]) return false;
      seen[key] = true;
      return !!(item.title || item.url);
    });
  }

  function inferLibraryDocumentType(el) {
    var icon = el.querySelector('mat-icon, gem-icon');
    var name = icon
      ? (icon.getAttribute('data-mat-icon-name') || icon.getAttribute('fonticon') || '')
      : '';
    if (/code/i.test(name)) return 'code';
    if (/report|research/i.test(name)) return 'research';
    return 'document';
  }

  function scrapeGeminiLibrarySection(parent, kind) {
    var items = [];
    if (!parent) return items;
    var selectors = kind === 'media'
      ? 'a, [role="button"], [tabindex="0"], img'
      : 'a, [role="button"], [tabindex="0"], .document-item, [class*="document"]';
    Array.prototype.slice.call(parent.querySelectorAll(selectors)).forEach(function(el) {
      if (el.tagName === 'IMG' && !el.closest('a, [role="button"]')) return;
      var titleNode = el.querySelector('.title, .gds-body-l, .gds-body-m') || el;
      var title = (el.getAttribute('aria-label') || titleNode.innerText || '').trim();
      if (!title || title.length > 240) return;
      if (/^(media|documents?|library|new chat|view all)$/i.test(title)) return;
      var entry = {
        title: title.split('\n')[0].trim(),
        url: el.href || null,
        type: kind === 'media' ? 'media' : inferLibraryDocumentType(el)
      };
      items.push(entry);
    });
    return items;
  }

  function isLibraryPlaceholderText(text) {
    if (!text) return true;
    return /will appear here|any documents or media you create/i.test(text);
  }

  function scrapeGeminiLibraryMediaCards(page) {
    var media = [];
    Array.prototype.slice.call(page.querySelectorAll('library-item-card')).forEach(function(card) {
      var img = card.querySelector('img.thumbnail, img');
      var btn = card.querySelector('.library-item-card[role="button"], [role="button"].library-item-card');
      var alt = img ? (img.getAttribute('alt') || '').trim() : '';
      var aria = btn ? (btn.getAttribute('aria-label') || '').trim() : '';
      var title = alt.replace(/^Image of\s*/i, '').trim() ||
        aria.replace(/^Preview or open\s*/i, '').trim() ||
        'Generated image';
      if (isLibraryPlaceholderText(title)) return;
      media.push({
        title: title,
        thumbnailUrl: img ? img.src : null,
        type: 'media'
      });
    });
    return media;
  }

  function scrapeGeminiLibrary() {
    var page = document.querySelector('library-sections-overview-page');
    if (!page) return { ok: false, error: 'Library page not found' };

    if (page.querySelector('[data-test-id=empty-state-disclaimer]') &&
        !page.querySelector('library-item-card')) {
      return {
        ok: true,
        empty: true,
        media: [],
        documents: [],
        message: 'Any documents or media you create will appear here'
      };
    }

    var media = scrapeGeminiLibraryMediaCards(page);
    var documents = [];
    var headings = Array.prototype.slice.call(page.querySelectorAll(
      '.gds-headline-m, .gds-headline-s, .gds-title-m, h2, h3, .section-title, .gds-emphasized-body-l'
    ));

    for (var h = 0; h < headings.length; h++) {
      var headingText = (headings[h].innerText || '').trim();
      var sectionParent = headings[h].closest('[class*="section"], .media-container, .sections-container') ||
        headings[h].parentElement;
      if (/^media$/i.test(headingText)) {
        media = media.concat(scrapeGeminiLibrarySection(sectionParent, 'media'));
      } else if (/^documents?$/i.test(headingText)) {
        documents = documents.concat(scrapeGeminiLibrarySection(sectionParent, 'document'));
      }
    }

    Array.prototype.slice.call(page.querySelectorAll(
      '[data-test-id*="media-item"], [data-test-id*="media"] a, a[href*="/mystuff/media"]'
    )).forEach(function(el) {
      var title = (el.getAttribute('aria-label') || el.innerText || '').trim();
      if (title && !isLibraryPlaceholderText(title)) {
        media.push({ title: title.split('\n')[0].trim(), url: el.href || null, type: 'media' });
      }
    });

    Array.prototype.slice.call(page.querySelectorAll(
      'library-document-card, [data-test-id*="document-item"], .library-document-item, a[href*="/mystuff/documents"], a[href*="canvas"]'
    )).forEach(function(el) {
      if (el.closest('[data-test-id=documents-empty-state], .section-empty-state')) return;
      var title = (el.querySelector('.title, .gds-body-l, .gds-body-m') || el).innerText.trim();
      if (!title || isLibraryPlaceholderText(title)) return;
      documents.push({
        title: title.split('\n')[0].trim(),
        url: el.href || null,
        type: inferLibraryDocumentType(el)
      });
    });

    media = dedupeLibraryItems(media);
    documents = dedupeLibraryItems(documents);

    return {
      ok: true,
      empty: !media.length && !documents.length,
      media: media,
      documents: documents
    };
  }

  function scrapeGeminiLibraryDocumentsPage(limit) {
    var root = document.querySelector(
      'library-documents-page, library-sections-overview-page, [data-test-id=documents-list], mat-sidenav-content'
    ) || document;
    var items = [];
    Array.prototype.slice.call(root.querySelectorAll(
      'a[href], [role="button"], [role="listitem"], .document-item, [data-test-id*="document"]'
    )).forEach(function(el) {
      var title = (el.querySelector('.title, .gds-body-l, .gds-body-m') || el).innerText.trim();
      if (!title || title.length > 240) return;
      items.push({
        title: title.split('\n')[0].trim(),
        url: el.href || null,
        type: inferLibraryDocumentType(el)
      });
    });
    return dedupeLibraryItems(items).slice(0, limit);
  }

  async function ensureGeminiLibraryPage() {
    var nav = await navigateToGeminiPath('/library', {
      selectors: ['library-sections-overview-page'],
      timeoutMs: 12000
    });
    if (nav.ok) {
      await dismissGeminiSidebarIfBlocking();
      return nav;
    }

    await ensureGeminiSidebarOpen();
    var libraryNav = document.querySelector(
      '[data-test-id=my-stuff-side-nav-entry-button] a, a[aria-label="Library"]'
    );
    if (libraryNav) {
      clickElement(libraryNav);
      await sleep(2000);
    }
    await dismissGeminiSidebarIfBlocking();
    return {
      ok: !!document.querySelector('library-sections-overview-page'),
      url: location.href,
      viewport: getGeminiViewport()
    };
  }

  var GEMINI_PUSH_ID = 'feeds/mcudyrk2a4khkz';
  var GEMINI_MODEL_SPECS = {
    flash: { modelId: 'fbb127bbb056c959', capacity: 1 },
    thinking: { modelId: '5bf011840784117a', capacity: 1 },
    pro: { modelId: '9d8ca3786ebdfbea', capacity: 1 }
  };

  function conversationHexToCid(conversationHexId) {
    if (!conversationHexId) return null;
    var hex = String(conversationHexId).trim().toLowerCase();
    if (/^c_/.test(hex)) return hex;
    if (/^[0-9a-f]+$/.test(hex)) return 'c_' + hex;
    return null;
  }

  function conversationCidToHex(cid) {
    if (!cid) return null;
    var text = String(cid).trim();
    return text.replace(/^c_/, '').toLowerCase();
  }

  function guessGeminiMimeType(fileName) {
    var lower = String(fileName || '').toLowerCase();
    if (/\.(txt|md|csv|log)$/.test(lower)) return 'text/plain';
    if (/\.json$/.test(lower)) return 'application/json';
    if (/\.html?$/.test(lower)) return 'text/html';
    if (/\.pdf$/.test(lower)) return 'application/pdf';
    if (/\.png$/.test(lower)) return 'image/png';
    if (/\.jpe?g$/.test(lower)) return 'image/jpeg';
    if (/\.gif$/.test(lower)) return 'image/gif';
    if (/\.webp$/.test(lower)) return 'image/webp';
    return 'application/octet-stream';
  }

  function decodeGeminiBase64(fileBase64) {
    var cleaned = String(fileBase64 || '').replace(/\s+/g, '');
    var binary = atob(cleaned);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function prepareGeminiAttachmentPlan(args) {
    args = args || {};
    var context = args.context != null ? String(args.context).trim() : '';
    var query = String(args.query || '').trim();
    if (context) {
      query = '--- External context ---\n' + context + '\n--- End context ---\n\n' + query;
    }
    var files = [];
    var hasFileContent = args.fileContent != null && String(args.fileContent).length > 0;
    var hasFileBase64 = args.fileBase64 != null && String(args.fileBase64).trim().length > 0;
    if (hasFileContent || hasFileBase64) {
      var fileName = String(args.fileName || 'attachment.txt').trim() || 'attachment.txt';
      var bytes = hasFileBase64
        ? decodeGeminiBase64(args.fileBase64)
        : String(args.fileContent);
      files.push({
        fileName: fileName,
        bytes: bytes,
        mimeType: guessGeminiMimeType(fileName)
      });
    }
    return {
      query: query,
      files: files,
      hasFiles: files.length > 0,
      hasContext: !!context
    };
  }

  function getGeminiSessionParams() {
    var wiz = globalThis.WIZ_global_data || {};
    var sid = wiz.FdrFJe != null ? String(wiz.FdrFJe) : '';
    var bl = wiz.cfb2h != null ? String(wiz.cfb2h) : '';
    var at = wiz.SNlM0e != null ? String(wiz.SNlM0e) : '';
    if (!sid || !bl || !at) {
      return {
        ok: false,
        error: 'Gemini session unavailable',
        hint: 'Open gemini.google.com in a logged-in tab and retry.'
      };
    }
    return { ok: true, sid: sid, bl: bl, at: at };
  }

  function getGeminiModelSpec(modeId) {
    return GEMINI_MODEL_SPECS[modeId] || GEMINI_MODEL_SPECS.flash;
  }

  function buildGeminiModelHeaderValue(modeId) {
    var spec = getGeminiModelSpec(modeId);
    return '[1,null,null,null,"' + spec.modelId + '",null,null,0,[4],null,null,' + spec.capacity + ']';
  }

  async function uploadGeminiFileBytes(fileName, bytes, mimeType) {
    mimeType = mimeType || guessGeminiMimeType(fileName);
    var boundary = '----GeminiFormBoundary' + Math.random().toString(36).slice(2);
    var header = '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' +
      fileName + '"\r\nContent-Type: ' + mimeType + '\r\n\r\n';
    var footer = '\r\n--' + boundary + '--\r\n';
    var body;
    if (typeof bytes === 'string') {
      body = header + bytes + footer;
    } else {
      var enc = new TextEncoder();
      var headerBytes = enc.encode(header);
      var footerBytes = enc.encode(footer);
      body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
      body.set(headerBytes, 0);
      body.set(bytes, headerBytes.length);
      body.set(footerBytes, headerBytes.length + bytes.length);
    }
    var resp = await fetch('https://content-push.googleapis.com/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'multipart/form-data; boundary=' + boundary,
        'push-id': GEMINI_PUSH_ID,
        'X-Tenant-Id': 'bard-storage'
      },
      body: body
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: 'File upload failed',
        status: resp.status,
        hint: 'Gemini rejected the file upload. Check file type/size and retry.'
      };
    }
    var fileId = (await resp.text()).trim();
    if (!fileId || fileId.indexOf('/contrib_service/') !== 0) {
      return {
        ok: false,
        error: 'Invalid upload response',
        hint: fileId.slice(0, 200) || 'Empty upload response'
      };
    }
    return { ok: true, fileId: fileId, fileName: fileName, mimeType: mimeType };
  }

  function parseGeminiConversationMetadataFromReadChat(text) {
    if (!text) return null;
    var match = text.match(/c_[0-9a-f]+\\?",\\"r_[0-9a-f]+/i) ||
      text.match(/c_[0-9a-f]+","r_[0-9a-f]+/i);
    if (!match) return null;
    var parts = match[0].split(/\\?",\\"|","/);
    return { cid: parts[0], rid: parts[1] };
  }

  async function readGeminiConversationMetadata(conversationHexId) {
    var cid = conversationHexToCid(conversationHexId);
    if (!cid) {
      return { ok: false, error: 'Invalid conversation id', hint: 'Provide a hex conversation id from googlegemini/chat' };
    }
    var session = getGeminiSessionParams();
    if (!session.ok) return session;
    var sourcePath = '/app/' + String(conversationHexId).replace(/^c_/, '').toLowerCase();
    var fReq = JSON.stringify([[[ 'hNvQHb', JSON.stringify([cid]), null, 'generic' ]]]);
    var reqId = Math.floor(Math.random() * 900000) + 100000;
    var url = 'https://gemini.google.com/_/BardChatUi/data/batchexecute' +
      '?rpcids=hNvQHb&source-path=' + encodeURIComponent(sourcePath) +
      '&bl=' + encodeURIComponent(session.bl) +
      '&f.sid=' + encodeURIComponent(session.sid) +
      '&hl=en&_reqid=' + reqId + '&rt=c';
    var resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-same-domain': '1'
      },
      body: 'f.req=' + encodeURIComponent(fReq) + '&at=' + encodeURIComponent(session.at)
    });
    if (!resp.ok) {
      return { ok: false, error: 'Failed to read conversation', status: resp.status };
    }
    var text = await resp.text();
    var meta = parseGeminiConversationMetadataFromReadChat(text);
    if (!meta) {
      return {
        ok: false,
        error: 'Conversation metadata not found',
        hint: 'Open the conversation in Gemini and retry chatfollow.'
      };
    }
    return { ok: true, metadata: [meta.cid, meta.rid, '', null, null, null, null, null, null, ''] };
  }

  function unescapeGeminiStreamChunk(text) {
    return String(text || '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  function parseGeminiStreamGenerateText(text) {
    if (!text) return '';
    var chunks = [];
    var re = /rc_[0-9a-f]+(?:\\",\[\\"|","\[\")((?:\\.|[^"\\])+?)(?:\\"|")/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var piece = unescapeGeminiStreamChunk(m[1]);
      if (piece) chunks.push(piece);
    }
    if (chunks.length) return chunks[chunks.length - 1];

    var tailMatches = text.match(/,\[\\?"((?:\\.|[^"\\])+?)\\?",0\]/g) ||
      text.match(/,\["((?:\\.|[^"\\])+?)",0\]/g);
    if (tailMatches && tailMatches.length) {
      var last = tailMatches[tailMatches.length - 1];
      var tm = last.match(/\[\\?"((?:\\.|[^"\\])+?)\\?",0\]/) ||
        last.match(/\["((?:\\.|[^"\\])+?)",0\]/);
      if (tm) return unescapeGeminiStreamChunk(tm[1]);
    }
    return '';
  }

  function extractGeminiConversationHexFromStream(text) {
    if (!text) return null;
    var match = text.match(/\\"c_([0-9a-f]+)\\"/i) || text.match(/"c_([0-9a-f]+)"/i);
    return match ? match[1].toLowerCase() : null;
  }

  function buildGeminiStreamInnerRequest(options) {
    options = options || {};
    var fileRefs = options.fileRefs || [];
    var fileData = fileRefs.length
      ? fileRefs.map(function(ref) { return [[ref.fileId], ref.fileName]; })
      : null;
    var messageContent = [options.query, 0, null, fileData, null, null, 0];
    var inner = new Array(69).fill(null);
    inner[0] = messageContent;
    inner[1] = [options.lang || 'en'];
    inner[2] = options.metadata || null;
    inner[6] = [1];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[0]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [1];
    inner[53] = 0;
    inner[55] = [[1]];
    inner[61] = [];
    inner[68] = 2;
    inner[59] = (globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID().toUpperCase()
      : String(Math.random()).slice(2).toUpperCase());
    return inner;
  }

  async function submitGeminiWithAttachments(options) {
    options = options || {};
    var files = options.files || [];
    if (!options.query) {
      return { ok: false, error: 'Missing query', hint: 'Provide a prompt for Gemini' };
    }
    if (!files.length) {
      return { ok: false, error: 'No files to attach', hint: 'Provide fileName with fileContent or fileBase64' };
    }

    var session = getGeminiSessionParams();
    if (!session.ok) return session;

    var uploaded = [];
    for (var i = 0; i < files.length; i++) {
      var upload = await uploadGeminiFileBytes(files[i].fileName, files[i].bytes, files[i].mimeType);
      if (!upload.ok) return upload;
      uploaded.push(upload);
    }

    var metadata = options.metadata || null;
    if (!metadata && options.conversationHexId) {
      var readMeta = await readGeminiConversationMetadata(options.conversationHexId);
      if (!readMeta.ok) return readMeta;
      metadata = readMeta.metadata;
    }

    var inner = buildGeminiStreamInnerRequest({
      query: options.query,
      fileRefs: uploaded,
      metadata: metadata,
      lang: options.lang || 'en'
    });
    var uuid = inner[59];
    var fReq = JSON.stringify([null, JSON.stringify(inner)]);
    var reqId = Math.floor(Math.random() * 900000) + 100000;
    var url = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate' +
      '?bl=' + encodeURIComponent(session.bl) +
      '&f.sid=' + encodeURIComponent(session.sid) +
      '&hl=en&_reqid=' + reqId + '&rt=c';
    var resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-same-domain': '1',
        'x-goog-ext-525005358-jspb': JSON.stringify([uuid, 1]),
        'x-goog-ext-525001261-jspb': buildGeminiModelHeaderValue(options.modeId || 'flash'),
        'x-goog-ext-73010989-jspb': '[0]'
      },
      body: 'f.req=' + encodeURIComponent(fReq) + '&at=' + encodeURIComponent(session.at)
    });
    var respText = await resp.text();
    if (!resp.ok) {
      return {
        ok: false,
        error: 'Gemini generation failed',
        status: resp.status,
        hint: respText.slice(0, 300) || 'StreamGenerate request failed'
      };
    }
    var answer = parseGeminiStreamGenerateText(respText);
    if (!answer) {
      return {
        ok: false,
        error: 'Empty response',
        hint: 'Gemini returned no content for the file attachment request.'
      };
    }
    var conversationId = options.conversationHexId
      ? String(options.conversationHexId).replace(/^c_/, '').toLowerCase()
      : extractGeminiConversationHexFromStream(respText);
    return {
      ok: true,
      answer: answer,
      attachments: uploaded.map(function(item) {
        return { fileName: item.fileName, fileId: item.fileId, mimeType: item.mimeType };
      }),
      conversationId: conversationId,
      transport: 'stream_generate'
    };
  }

  function parseConversationIdArg(raw) {
    if (raw == null || raw === '') return null;
    var text = String(raw).trim();
    var fromPath = text.match(/\/app\/([0-9a-f]+)/i);
    if (fromPath) return fromPath[1].toLowerCase();
    if (/^c_[0-9a-f]+$/i.test(text)) return text.slice(2).toLowerCase();
    if (/^[0-9a-f]+$/i.test(text)) return text.toLowerCase();
    return null;
  }

  function scrapeGeminiConversationSnapshot() {
    var responseEls = getAssistantMessages();
    var userEls = Array.prototype.slice.call(document.querySelectorAll('user-query'));
    var responses = responseEls.map(function(el) {
      return cleanAssistantText(getAssistantText(el)).slice(0, 500);
    });
    var users = responseEls.map(function(_, index) {
      var el = userEls[index];
      if (!el) return '';
      return stripRolePrefix((el.innerText || el.textContent || '').trim()).slice(0, 500);
    });
    return {
      turnCount: responses.length,
      userQueries: users,
      responses: responses
    };
  }

  function findAssistantMessageActions(index) {
    var allActions = Array.prototype.slice.call(document.querySelectorAll('message-actions'));
    if (allActions[index]) return allActions[index];
    var responses = getAssistantMessages();
    var response = responses[index];
    if (!response) return null;
    var container = response.closest('response-container');
    if (container) {
      var inContainer = container.querySelector('message-actions');
      if (inContainer) return inContainer;
    }
    var sibling = response.nextElementSibling;
    while (sibling) {
      if (String(sibling.tagName || '').toLowerCase() === 'message-actions') return sibling;
      sibling = sibling.nextElementSibling;
    }
    return null;
  }

  function findBranchMenuItem() {
    var menu = document.querySelector('gem-menu, [role="menu"]');
    var root = menu || document;
    var items = Array.prototype.slice.call(
      root.querySelectorAll('gem-menu-item[role="menuitem"], [role="menuitem"]')
    );
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var label = el.getAttribute('aria-label') || '';
      var text = (el.innerText || el.textContent || '').trim();
      if (/branch in new chat/i.test(label + ' ' + text)) return el;
    }
    return null;
  }

  async function openAssistantMoreMenu(messageIndex) {
    var actions = findAssistantMessageActions(messageIndex);
    if (!actions) {
      return {
        ok: false,
        error: 'Message actions not found',
        hint: 'Could not locate message-actions for assistant message ' + messageIndex + '.'
      };
    }

    var moreBtn = findByAriaLabel(/^show more options$/i, actions);
    if (!moreBtn) {
      return {
        ok: false,
        error: 'Show more options button not found',
        hint: 'Gemini message action bar may have changed.'
      };
    }

    await dismissOpenOverlays();
    await sleep(200);

    var branchItem = findBranchMenuItem();
    if (!branchItem) {
      tapElement(moreBtn);
      for (var attempt = 0; attempt < 8; attempt++) {
        await sleep(attempt === 0 ? 500 : 250);
        branchItem = findBranchMenuItem();
        if (branchItem) break;
      }
    }

    if (!branchItem) {
      await dismissOpenOverlays();
      return {
        ok: false,
        error: 'Branch in new chat menu item not found',
        hint: 'Open Show more options on an assistant reply and confirm Branch in new chat is available.'
      };
    }

    return { ok: true, branchItem: branchItem, moreBtn: moreBtn };
  }

  async function ensureGeminiConversationPage(conversationId, opts) {
    opts = opts || {};
    var hex = parseConversationIdArg(conversationId);
    if (!hex) {
      return { ok: false, error: 'Invalid conversation id' };
    }
    var target = 'https://gemini.google.com/app/' + hex;
    var current = parseConversationIdFromLocation();
    if (current !== hex) {
      location.href = target;
      await sleep(opts.waitMs || 2500);
    }
    var matched = await waitForGeminiSelector([
      'model-response',
      'user-query',
      'rich-textarea',
      '[contenteditable="true"]'
    ], opts.timeoutMs || 15000);
    if (!matched) {
      return {
        ok: false,
        error: 'Conversation page did not load',
        url: location.href,
        viewport: getGeminiViewport()
      };
    }
    await dismissGeminiSidebarIfBlocking();
    return {
      ok: true,
      url: location.href,
      conversationId: hex,
      viewport: getGeminiViewport()
    };
  }

  async function branchGeminiConversationAt(conversationId, messageIndex) {
    var page = await ensureGeminiConversationPage(conversationId);
    if (!page.ok) return page;

    var responses = getAssistantMessages();
    if (!responses.length) {
      return {
        ok: false,
        error: 'No assistant messages in conversation',
        hint: 'Open a conversation that has at least one Gemini reply.'
      };
    }

    var idx = messageIndex == null || messageIndex === ''
      ? responses.length - 1
      : Number(messageIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= responses.length) {
      return {
        ok: false,
        error: 'Invalid messageIndex',
        hint: 'Use a 0-based assistant message index; conversation has ' + responses.length + ' reply(ies).'
      };
    }

    var sourceId = parseConversationIdFromLocation();
    var responseEl = responses[idx];
    try {
      responseEl.scrollIntoView({ block: 'center' });
    } catch (e) {
      responseEl.scrollIntoView();
    }
    await sleep(300);

    var menuResult = await openAssistantMoreMenu(idx);
    if (!menuResult.ok) return menuResult;

    tapElement(menuResult.branchItem);

    var deadline = Date.now() + 12000;
    var newId = null;
    while (Date.now() < deadline) {
      await sleep(400);
      newId = parseConversationIdFromLocation();
      if (newId && newId !== sourceId) break;
    }

    if (!newId || newId === sourceId) {
      return {
        ok: false,
        error: 'Branch did not navigate to a new conversation',
        sourceConversationId: sourceId,
        hint: 'Branch may still be loading, or the UI blocked navigation.'
      };
    }

    await waitForGeminiSelector(['model-response'], 8000);
    await sleep(500);

    var snapshot = scrapeGeminiConversationSnapshot();
    var title = document.title.replace(/\s*-\s*Google Gemini\s*$/i, '').trim();

    return {
      ok: true,
      sourceConversationId: sourceId,
      conversationId: newId,
      url: 'https://gemini.google.com/app/' + newId,
      title: title,
      messageIndex: idx,
      messagesCopied: snapshot.turnCount,
      snapshot: snapshot
    };
  }

  globalThis.__geminiChatHelpers = {
    version: HELPERS_VERSION,
    GEMINI_CHAT_WAIT_MS: GEMINI_CHAT_WAIT_MS,
    GEMINI_CHAT_POLL_MS: GEMINI_CHAT_POLL_MS,
    MODE_WAIT_MS: MODE_WAIT_MS,
    MODE_LABELS: MODE_LABELS,
    sleep: sleep,
    tapElement: tapElement,
    getAssistantMessages: getAssistantMessages,
    getAssistantText: getAssistantText,
    cleanAssistantText: cleanAssistantText,
    isProgressText: isProgressText,
    looksLikeFinalAnswer: looksLikeFinalAnswer,
    isGeminiGenerating: isGeminiGenerating,
    isGeminiReplyPending: isGeminiReplyPending,
    wasLastWaitPending: wasLastWaitPending,
    getLastWaitAbnormal: getLastWaitAbnormal,
    detectGeminiPageAbnormal: detectGeminiPageAbnormal,
    detectGeminiWorkspaceRequired: detectGeminiWorkspaceRequired,
    detectGeminiResponseBlock: detectGeminiResponseBlock,
    getLatestAssistantResponseText: getLatestAssistantResponseText,
    checkGeminiAnswerBlocked: checkGeminiAnswerBlocked,
    getLoginState: getLoginState,
    getChatEditor: getChatEditor,
    getSubmitButton: getSubmitButton,
    resolveGeminiMode: resolveGeminiMode,
    resolveGeminiModeWaitMs: resolveGeminiModeWaitMs,
    buildWaitOpts: buildWaitOpts,
    modeLabelMatches: modeLabelMatches,
    readGeminiModeLabel: readGeminiModeLabel,
    setGeminiMode: setGeminiMode,
    listGeminiModesFromUi: listGeminiModesFromUi,
    setChatInput: setChatInput,
    clickSubmit: clickSubmit,
    startNewChat: startNewChat,
    waitForAssistantAnswer: waitForAssistantAnswer,
    extractJsonBlock: extractJsonBlock,
    parseAnswerJson: parseAnswerJson,
    hasParsedJsonAnswer: hasParsedJsonAnswer,
    GEMINI_MOBILE_BREAKPOINT: GEMINI_MOBILE_BREAKPOINT,
    getGeminiViewport: getGeminiViewport,
    isGeminiMobileLayout: isGeminiMobileLayout,
    isGeminiSidebarOpen: isGeminiSidebarOpen,
    ensureGeminiSidebarOpen: ensureGeminiSidebarOpen,
    dismissGeminiSidebarIfBlocking: dismissGeminiSidebarIfBlocking,
    waitForGeminiSelector: waitForGeminiSelector,
    navigateToGeminiPath: navigateToGeminiPath,
    parseConversationIdFromPath: parseConversationIdFromPath,
    parseConversationIdFromLocation: parseConversationIdFromLocation,
    parseConversationIdArg: parseConversationIdArg,
    scrapeGeminiConversationSnapshot: scrapeGeminiConversationSnapshot,
    findAssistantMessageActions: findAssistantMessageActions,
    findBranchMenuItem: findBranchMenuItem,
    openAssistantMoreMenu: openAssistantMoreMenu,
    ensureGeminiConversationPage: ensureGeminiConversationPage,
    branchGeminiConversationAt: branchGeminiConversationAt,
    getGeminiSearchInput: getGeminiSearchInput,
    ensureGeminiSearchPage: ensureGeminiSearchPage,
    scrapeGeminiRecentChats: scrapeGeminiRecentChats,
    scrapeGeminiSearchResults: scrapeGeminiSearchResults,
    runGeminiChatSearch: runGeminiChatSearch,
    resolveGeminiConversationId: resolveGeminiConversationId,
    resolveGeminiConversationIds: resolveGeminiConversationIds,
    scrapeGeminiLibrary: scrapeGeminiLibrary,
    scrapeGeminiLibraryDocumentsPage: scrapeGeminiLibraryDocumentsPage,
    ensureGeminiLibraryPage: ensureGeminiLibraryPage,
    GEMINI_PUSH_ID: GEMINI_PUSH_ID,
    conversationHexToCid: conversationHexToCid,
    conversationCidToHex: conversationCidToHex,
    guessGeminiMimeType: guessGeminiMimeType,
    decodeGeminiBase64: decodeGeminiBase64,
    prepareGeminiAttachmentPlan: prepareGeminiAttachmentPlan,
    getGeminiSessionParams: getGeminiSessionParams,
    uploadGeminiFileBytes: uploadGeminiFileBytes,
    readGeminiConversationMetadata: readGeminiConversationMetadata,
    parseGeminiStreamGenerateText: parseGeminiStreamGenerateText,
    submitGeminiWithAttachments: submitGeminiWithAttachments
  };

  return globalThis.__geminiChatHelpers;
})();

  var section = String(args.section || 'all').toLowerCase();
  if (['all', 'media', 'documents'].indexOf(section) === -1) {
    return {
      error: 'Invalid section',
      hint: 'section must be all, media, or documents',
      action: 'bun-browser site googlegemini/library'
    };
  }

  var limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50);
  var loginState = h.getLoginState();

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  if (section === 'documents') {
    var docsNav = await h.navigateToGeminiPath('/mystuff/documents', {
      selectors: ['library-sections-overview-page', 'library-documents-page', 'mat-sidenav-content'],
      timeoutMs: 12000
    });
    await h.dismissGeminiSidebarIfBlocking();
    if (!docsNav.ok && !h.scrapeGeminiLibraryDocumentsPage(1).length) {
      var fallback = await h.ensureGeminiLibraryPage();
      if (!fallback.ok) {
        return {
          error: 'Library page not available',
          hint: 'Open gemini.google.com/library in the browser and sign in, then retry.',
          action: 'bun-browser open https://gemini.google.com/library',
          viewport: h.getGeminiViewport(),
          loggedIn: loginState.loggedIn,
          anonymous: loginState.anonymous
        };
      }
      var overview = h.scrapeGeminiLibrary();
      return {
        section: section,
        empty: overview.empty,
        count: overview.documents.length,
        documents: overview.documents.slice(0, limit),
        media: [],
        viewport: h.getGeminiViewport(),
        loggedIn: loginState.loggedIn,
        anonymous: loginState.anonymous,
        url: location.href
      };
    }
    var documents = h.scrapeGeminiLibraryDocumentsPage(limit);
    return {
      section: section,
      empty: !documents.length,
      count: documents.length,
      documents: documents,
      media: [],
      viewport: h.getGeminiViewport(),
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous,
      url: location.href
    };
  }

  var page = await h.ensureGeminiLibraryPage();
  if (!page.ok) {
    return {
      error: 'Library page not available',
      hint: 'Open gemini.google.com/library in the browser and sign in, then retry.',
      action: 'bun-browser open https://gemini.google.com/library',
      viewport: h.getGeminiViewport(),
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
  }

  if (section === 'media') {
    var mediaNav = await h.navigateToGeminiPath('/mystuff/media', {
      selectors: ['library-sections-overview-page', 'mat-sidenav-content'],
      timeoutMs: 10000,
      waitMs: 1500
    });
    await h.dismissGeminiSidebarIfBlocking();
  }

  var library = h.scrapeGeminiLibrary();
  if (!library.ok) {
    return {
      error: library.error || 'Library scrape failed',
      hint: 'Gemini Library DOM may have changed.',
      action: 'bun-browser open https://gemini.google.com/library',
      viewport: h.getGeminiViewport()
    };
  }

  var media = (library.media || []).slice(0, limit);
  var documents = (library.documents || []).slice(0, limit);
  var out = {
    section: section,
    empty: library.empty,
    viewport: h.getGeminiViewport(),
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous,
    url: location.href
  };
  if (library.message) out.message = library.message;

  if (section === 'all') {
    out.count = media.length + documents.length;
    out.media = media;
    out.documents = documents;
  } else if (section === 'media') {
    out.count = media.length;
    out.media = media;
    out.documents = [];
  } else {
    out.count = documents.length;
    out.media = [];
    out.documents = documents;
  }

  return out;
}
