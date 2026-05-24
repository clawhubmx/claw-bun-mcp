/**
 * Shared Grok chat DOM helpers (installed on globalThis.__grokChatHelpers).
 * Inlined by grok/chat.js, grok/chatfollow.js, and grok/agent-chat.js — keep in sync.
 */
function installGrokChatHelpers() {
  var HELPERS_VERSION = 14;

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
    if (/^(Searching|Reading|Browsing|Fetching|Running tool)\b/i.test(t)) return true;
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

  function isProgressText(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t) return false;
    if (/^Preview:/i.test(t)) return true;
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

  function looksLikeFinalAnswer(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t || isProgressText(t)) return false;
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
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < buttons.length; i++) {
      var label = (buttons[i].getAttribute('aria-label') || '').toLowerCase();
      if (label === 'stop' || label.indexOf('stop generating') !== -1) {
        if (!buttons[i].disabled) return true;
      }
    }

    var messages = getAssistantMessages();
    var latest = messages[messages.length - 1];
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

  function setChatInput(value) {
    var editor = document.querySelector('[data-testid="chat-input"] [contenteditable="true"]');
    if (editor) {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
      return true;
    }
    var ta = document.querySelector('textarea');
    if (!ta) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(ta, value);
    else ta.value = value;
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    ta.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  }

  function clickSubmit() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var submit = buttons.find(function(b) {
      var label = (b.getAttribute('aria-label') || '').toLowerCase();
      return label === 'submit';
    });
    if (submit) {
      submit.click();
      return true;
    }
    return false;
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

    if (await openModelMenu()) {
      var option = findModeOptionElement(requested, catalog);
      if (option) {
        option.click();
        await sleep(500);
        writeStoredGrokMode(requested);
        var appliedLabel = readGrokModeLabel();
        if (modeLabelsMatch(requested, appliedLabel, catalog)) {
          return {
            ok: true,
            changed: true,
            mode: requested,
            label: appliedLabel,
            modeTitle: getModeTitle(requested, catalog),
            appliedVia: 'ui'
          };
        }
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);
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

  function wasLastWaitPending() {
    return lastWaitPending;
  }

  function isGrokReplyPending(beforeCount, beforeText) {
    if (isGrokGenerating()) return true;
    var messages = getAssistantMessages();
    if (messages.length <= beforeCount) return true;
    var latest = messages[messages.length - 1];
    if (!latest) return false;
    var latestRaw = (latest.innerText || latest.textContent || '').trim();
    if (!latestRaw) return true;
    if (isProgressText(latestRaw)) return true;
    if (/Agents thinking/i.test(latestRaw) && !extractJsonBlock(latestRaw)) return true;
    if (latest.querySelector(
      '[aria-busy="true"], [data-testid="loading"], .animate-pulse, .animate-spin, [class*="streaming"], [class*="typing"]'
    )) {
      return true;
    }
    if (/\{/.test(latestRaw) && !extractJsonBlock(latestRaw)) return true;
    if (/^```(?:json)?/im.test(latestRaw) && !extractJsonBlock(latestRaw)) return true;
    var text = getAssistantText(latest);
    if (text && text !== beforeText && looksLikeFinalAnswer(text)) return false;
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

    while (Date.now() < deadline) {
      await sleep(pollMs);
      var messages = getAssistantMessages();
      var latest = messages[messages.length - 1];
      var generating = isGrokGenerating();
      var pending = isGrokReplyPending(beforeCount, beforeText);
      if (generating || pending) sawInFlight = true;
      var rawText = latest ? getAssistantText(latest) : '';
      answer = rawText ? cleanAssistantText(rawText) : '';
      var ready = looksLikeFinalAnswer(answer);

      var hasNewMessage = messages.length > beforeCount && ready;
      var hasUpdatedMessage = messages.length === beforeCount && ready && answer !== beforeText;

      if (hasNewMessage || hasUpdatedMessage) {
        if (!generating && !pending) {
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

    if (!looksLikeFinalAnswer(answer) || isGrokGenerating() || isGrokReplyPending(beforeCount, beforeText)) {
      lastWaitPending = sawInFlight || isGrokReplyPending(beforeCount, beforeText) || isGrokGenerating();
      return '';
    }
    lastWaitPending = false;
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
    resolveGrokMode: resolveGrokMode,
    resolveGrokModeWaitMs: resolveGrokModeWaitMs,
    buildWaitOpts: buildWaitOpts,
    readStoredGrokMode: readStoredGrokMode,
    readGrokModeLabel: readGrokModeLabel,
    setGrokMode: setGrokMode,
    setChatInput: setChatInput,
    clickSubmit: clickSubmit,
    waitForAssistantAnswer: waitForAssistantAnswer,
    extractJsonBlock: extractJsonBlock,
    parseAnswerJson: parseAnswerJson
  };

  return globalThis.__grokChatHelpers;
}
