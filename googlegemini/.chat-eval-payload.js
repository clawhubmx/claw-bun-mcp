(async () => {
  const chat = async function(args) {
  if (!args.query) {
    return { error: 'Missing argument: query', hint: 'Provide a prompt for Gemini' };
  }

  var h = (function installGeminiChatHelpers() {
  var HELPERS_VERSION = 1;

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

  function getAssistantMessages() {
    return Array.prototype.slice.call(document.querySelectorAll('model-response'));
  }

  function getStopButton() {
    return Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b) {
      var label = (b.getAttribute('aria-label') || '').toLowerCase();
      return label.indexOf('stop') !== -1;
    }) || null;
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
    return document.querySelector('.ql-editor[contenteditable="true"], [aria-label="Enter a prompt for Gemini"][contenteditable="true"]') ||
      document.querySelector('.ql-editor, rich-textarea [contenteditable="true"]');
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
    return document.querySelector('button[aria-label="Send message"]') ||
      Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b) {
        return (b.getAttribute('aria-label') || '').toLowerCase() === 'send message';
      }) || null;
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
    submit.click();
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
    return document.querySelector('button[aria-label^="Open mode picker"]') ||
      Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b) {
        return /^open mode picker/i.test(b.getAttribute('aria-label') || '');
      }) || null;
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

  function modeLabelMatches(requestedMode, currentLabel) {
    if (!currentLabel) return false;
    var expected = MODE_LABELS[resolveGeminiMode(requestedMode)] || requestedMode;
    var current = String(currentLabel).trim().toLowerCase();
    var wanted = String(expected).trim().toLowerCase();
    if (current === wanted) return true;
    if (current.indexOf(wanted) !== -1 || wanted.indexOf(current) !== -1) return true;
    return false;
  }

  async function openModelMenu() {
    var btn = getModelPickerButton();
    if (!btn) return false;
    btn.click();
    await sleep(800);
    return !!document.querySelector('[role="menuitem"], [role="menu"]');
  }

  function findModeOptionElement(modeId) {
    var resolved = resolveGeminiMode(modeId);
    var title = MODE_LABELS[resolved] || resolved;
    var wanted = String(title).trim().toLowerCase();
    var options = Array.prototype.slice.call(document.querySelectorAll('[role="menuitem"], button'));
    for (var i = 0; i < options.length; i++) {
      var el = options[i];
      var text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;
      var firstLine = text.split('\n')[0].trim().toLowerCase();
      if (firstLine === wanted) return el;
      if (firstLine.indexOf(wanted) === 0) return el;
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

    if (await openModelMenu()) {
      var option = findModeOptionElement(requested);
      if (option) {
        option.click();
        await sleep(600);
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

    return {
      ok: false,
      changed: false,
      mode: requested,
      modeTitle: MODE_LABELS[requested] || requested,
      error: 'Mode selection failed',
      hint: 'Could not switch to ' + (MODE_LABELS[requested] || requested) + '. Run googlegemini/modes to see available models.'
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

  function startNewChat() {
    var btn = document.querySelector('button[aria-label="New chat"]');
    if (btn) {
      btn.click();
      return true;
    }
    if (location.pathname !== '/app') {
      location.href = 'https://gemini.google.com/app';
      return true;
    }
    return false;
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
      lastWaitPending = sawInFlight || isGeminiReplyPending(beforeCount, beforeText) || isGeminiGenerating();
      return '';
    }
    lastWaitPending = false;
    var json = extractJsonBlock(answer);
    return json || answer;
  }

  globalThis.__geminiChatHelpers = {
    version: HELPERS_VERSION,
    GEMINI_CHAT_WAIT_MS: GEMINI_CHAT_WAIT_MS,
    GEMINI_CHAT_POLL_MS: GEMINI_CHAT_POLL_MS,
    MODE_WAIT_MS: MODE_WAIT_MS,
    MODE_LABELS: MODE_LABELS,
    sleep: sleep,
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
    getLoginState: getLoginState,
    getSubmitButton: getSubmitButton,
    resolveGeminiMode: resolveGeminiMode,
    resolveGeminiModeWaitMs: resolveGeminiModeWaitMs,
    buildWaitOpts: buildWaitOpts,
    readGeminiModeLabel: readGeminiModeLabel,
    setGeminiMode: setGeminiMode,
    listGeminiModesFromUi: listGeminiModesFromUi,
    setChatInput: setChatInput,
    clickSubmit: clickSubmit,
    startNewChat: startNewChat,
    waitForAssistantAnswer: waitForAssistantAnswer,
    extractJsonBlock: extractJsonBlock,
    parseAnswerJson: parseAnswerJson,
    hasParsedJsonAnswer: hasParsedJsonAnswer
  };

  return globalThis.__geminiChatHelpers;
})();

  function getConversationId() {
    var match = location.pathname.match(/\/app\/([0-9a-f]+)/i);
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

  var modeId = h.resolveGeminiMode(args.model || 'flash');
  var waitOpts = h.buildWaitOpts(args, modeId);
  var waitOnly = parseBool(args.waitOnly, false);
  var loginState = h.getLoginState();

  var accessBlock = h.detectGeminiPageAbnormal();
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
      if (waitAbnormal) return waitAbnormal;
      if (h.wasLastWaitPending()) {
        return {
          error: 'Still generating',
          hint: 'Gemini is still generating. Retry with waitOnly: true',
          action: 'retry with waitOnly: true'
        };
      }
      return {
        error: 'Empty response',
        hint: 'Gemini returned no content. The page DOM may have changed.',
        action: 'bun-browser open https://gemini.google.com/'
      };
    }
    var waitOut = {
      query: args.query,
      model: modeId,
      modeLabel: h.readGeminiModeLabel(),
      answer: waitedAnswer,
      conversationId: getConversationId(),
      waitOnly: true,
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
    var waitAnswerJson = h.parseAnswerJson(waitedAnswer);
    if (waitAnswerJson) {
      waitOut.answerJson = waitAnswerJson;
      waitOut.answerFormat = 'json';
    }
    return waitOut;
  }

  var startNewChat = args.newChat !== false;
  if (startNewChat) {
    h.startNewChat();
    await h.sleep(1500);
    if (location.pathname !== '/app' && !location.pathname.match(/\/app\/?$/)) {
      location.href = 'https://gemini.google.com/app';
      await h.sleep(1500);
    }
  }

  if (!document.querySelector('.ql-editor, [aria-label="Enter a prompt for Gemini"]')) {
    return {
      error: 'Chat input not found',
      hint: 'Gemini page did not finish loading. Open gemini.google.com and retry.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }

  var modeResult = await h.setGeminiMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.hint || modeResult.error || ('Could not select Gemini model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site googlegemini/modes'
    };
  }

  var beforeCount = h.getAssistantMessages().length;
  var beforeText = h.getAssistantMessages().map(h.getAssistantText).join('\n');

  if (!h.setChatInput(args.query)) {
    return {
      error: 'Chat input not found',
      hint: 'Could not set Gemini chat input.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }
  await h.sleep(400);

  accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  if (!h.clickSubmit()) {
    accessBlock = h.detectGeminiPageAbnormal();
    if (accessBlock) return accessBlock;
    return {
      error: 'Submit button not found',
      hint: 'Could not click Send on Gemini. Refresh the page and retry.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }

  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);

  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    if (h.wasLastWaitPending()) {
      return {
        error: 'Still generating',
        hint: 'Gemini is still generating (streaming/thinking). Retry with waitOnly: true',
        action: 'retry with waitOnly: true'
      };
    }
    return {
      error: 'Empty response',
      hint: 'Gemini returned no content. The page DOM may have changed.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }

  var out = {
    query: args.query,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readGeminiModeLabel(),
    answer: answer,
    conversationId: getConversationId(),
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous
  };
  var answerJson = h.parseAnswerJson(answer);
  if (answerJson) {
    out.answerJson = answerJson;
    out.answerFormat = 'json';
  }
  return out;
};
  return await chat({"query":"Reply with exactly: PING","newChat":true,"maxWaitMs":120000});
})()