/**
 * Shared Notion AI chat DOM helpers (installed on globalThis.__notionAiChatHelpers).
 * Inlined by notion/chat.js and notion/chatfollow.js — keep in sync.
 */
function installNotionAiChatHelpers() {
  var HELPERS_VERSION = 6;
  var NOTION_CHAT_WAIT_MS = 15 * 60 * 1000;
  var NOTION_CHAT_POLL_MS = 500;

  if (globalThis.__notionAiChatHelpers && globalThis.__notionAiChatHelpers.version === HELPERS_VERSION) {
    return globalThis.__notionAiChatHelpers;
  }

  var MODE_ALIASES = {
    auto: 'Auto',
    sonnet: 'Sonnet 4.6',
    'sonnet-4.6': 'Sonnet 4.6',
    opus: 'Opus 4.7',
    'opus-4.7': 'Opus 4.7',
    'opus-4.8': 'Opus 4.8',
    fable: 'Fable 5',
    'fable-5': 'Fable 5',
    gemini: 'Gemini 3.1 Pro',
    'gemini-3.1-pro': 'Gemini 3.1 Pro',
    'gpt-5.2': 'GPT-5.2',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.5': 'GPT-5.5',
    grok: 'Grok 4.3',
    'grok-4.3': 'Grok 4.3',
    'grok-build': 'Grok Build 0.1',
    kimi: 'Kimi K2.6',
    'kimi-k2.6': 'Kimi K2.6',
    deepseek: 'DeepSeek V4 Pro',
    'deepseek-v4-pro': 'DeepSeek V4 Pro'
  };

  var lastWaitPending = false;
  var lastWaitAbnormal = null;

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  function isLoggedIn() {
    return hasCookie('notion_user_id') && hasCookie('notion_users');
  }

  function ensureLoggedIn() {
    if (isLoggedIn()) return null;
    return {
      error: 'Not logged in',
      hint: 'Log into Notion at app.notion.com before using Notion AI commands',
      action: 'bun-browser open https://www.notion.so/'
    };
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

  function findByAriaLabel(label, root) {
    root = root || document;
    var target = String(label || '').trim().toLowerCase();
    var els = Array.prototype.slice.call(root.querySelectorAll('[aria-label], [role=tab], [role=button], button'));
    for (var i = 0; i < els.length; i++) {
      var aria = (els[i].getAttribute('aria-label') || '').trim().toLowerCase();
      if (aria === target && isElementVisible(els[i])) return els[i];
    }
    return null;
  }

  function findButtonByText(text, root) {
    root = root || document;
    var target = String(text || '').trim().toLowerCase();
    var els = Array.prototype.slice.call(root.querySelectorAll('[role=button], button'));
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || els[i].textContent || '').trim().toLowerCase();
      if (t === target || t.indexOf(target) === 0) {
        if (isElementVisible(els[i])) return els[i];
      }
    }
    return null;
  }

  function getVisiblePageText(maxLen) {
    maxLen = maxLen || 12000;
    var text = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function parseStoredJsonValue(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && parsed.value != null ? parsed.value : parsed;
    } catch (e) {
      return raw;
    }
  }

  function getSpaceId() {
    var raw = localStorage.getItem('LRU:KeyValueStore2:lastVisitedRouteSpaceId');
    var value = parseStoredJsonValue(raw);
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) return value;
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j] || '';
      if (key.indexOf('currentSpace:') >= 0) {
        var match = key.match(/currentSpace:([0-9a-f-]{36})/i);
        if (match) return match[1];
      }
    }
    return null;
  }

  function normalizeThreadId(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    var fromQuery = text.match(/[?&]t=([0-9a-f-]{32,36})/i);
    if (fromQuery) {
      var compact = fromQuery[1].replace(/-/g, '').toLowerCase();
      if (compact.length === 32) {
        return compact.slice(0, 8) + '-' + compact.slice(8, 12) + '-' + compact.slice(12, 16) + '-' +
          compact.slice(16, 20) + '-' + compact.slice(20);
      }
      return fromQuery[1].toLowerCase();
    }
    var fromPath = text.match(/\/chat\/([0-9a-f-]{32,36})/i);
    if (fromPath) return normalizeThreadId(fromPath[1]);
    if (/^[0-9a-f]{32}$/i.test(text)) {
      var c = text.toLowerCase();
      return c.slice(0, 8) + '-' + c.slice(8, 12) + '-' + c.slice(12, 16) + '-' +
        c.slice(16, 20) + '-' + c.slice(20);
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      return text.toLowerCase();
    }
    return null;
  }

  function parseConversationId(raw) {
    return normalizeThreadId(raw);
  }

  function getConversationId() {
    var params = new URLSearchParams(location.search);
    var fromQuery = params.get('t');
    if (fromQuery) return normalizeThreadId(fromQuery);
    var match = location.pathname.match(/\/chat\/([0-9a-f-]{32,36})/i);
    if (match) return normalizeThreadId(match[1]);
    return null;
  }

  function buildConversationUrl(conversationId) {
    var id = normalizeThreadId(conversationId);
    if (!id) return null;
    var compact = id.replace(/-/g, '');
    return 'https://app.notion.com/chat?t=' + compact + '&wfv=chat';
  }

  function dismissCookieBanner() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button, [role=button]'));
    var labels = ['allow all', 'reject all', 'accept all', 'confirm my choices', 'close preference center'];
    for (var i = 0; i < labels.length; i++) {
      var match = buttons.find(function(b) {
        var text = ((b.innerText || b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
        return text.indexOf(labels[i]) !== -1;
      });
      if (match) {
        clickElement(match);
        return true;
      }
    }
    return false;
  }

  function detectNotionPageAbnormal(opts) {
    opts = opts || {};
    var text = getVisiblePageText(8000);
    if (/ai (credits|quota).*(exhausted|used up|reached)/i.test(text)) {
      return {
        error: 'AI credits exhausted',
        kind: 'credits_exhausted',
        hint: 'This Notion workspace has no remaining AI credits.',
        action: 'wait and retry or upgrade plan'
      };
    }
    if (/rate limit|too many requests|try again later/i.test(text)) {
      return {
        error: 'Rate limit reached',
        kind: 'rate_limit',
        hint: 'Notion AI rate limit detected. Wait before retrying.',
        action: 'wait and retry'
      };
    }
    if (!opts.skipSubmitCheck) {
      var submit = getSubmitButton();
      var editor = getChatInput();
      var hasText = editor && String(editor.innerText || editor.textContent || '').trim();
      if (submit && isSubmitDisabled(submit) && hasText) {
        return {
          error: 'Chat submission blocked',
          kind: 'submit_disabled',
          hint: 'Send button is disabled — often due to credits or rate limits.',
          action: 'bun-browser open https://app.notion.com/'
        };
      }
    }
    return null;
  }

  async function openAiChatSidebar() {
    dismissCookieBanner();
    if (location.pathname.indexOf('/ai') === 0 || location.pathname.indexOf('/chat') === 0 || document.querySelector('.layout-chat')) {
      return { ok: true, via: 'chat-view' };
    }
    var chatTab = findByAriaLabel('Chat');
    if (!chatTab) {
      var legacy = document.querySelector('.notion-ai-button, [class*="notion-ai-button"]');
      if (legacy && isElementVisible(legacy)) {
        clickElement(legacy);
        await sleep(800);
        return { ok: true, via: 'floating-button' };
      }
      return {
        ok: false,
        error: 'AI chat sidebar not found',
        hint: 'Open a Notion workspace with AI enabled and ensure the sidebar Chat tab is visible.',
        action: 'bun-browser open https://app.notion.com/'
      };
    }
    clickElement(chatTab);
    await sleep(700);
    return { ok: true, via: 'chat-tab' };
  }

  async function clickNewChat() {
    var btn = findByAriaLabel('New chat');
    if (!btn) btn = findButtonByText('New chat');
    if (!btn) return { ok: false, error: 'New chat button not found' };
    clickElement(btn);
    await sleep(1200);
    return { ok: true };
  }

  async function ensureNewChatView() {
    var sidebar = await openAiChatSidebar();
    if (!sidebar.ok) return sidebar;

    if (location.pathname.indexOf('/ai') === 0 && getChatInput()) {
      return { ok: true, via: 'ai-landing' };
    }

    var created = await clickNewChat();
    if (!created.ok) {
      if (location.pathname.indexOf('/ai') === 0 && getChatInput()) {
        return { ok: true, via: 'ai-landing' };
      }
      if (location.pathname.indexOf('/chat') === 0) {
        try { sessionStorage.setItem('__notionAiPendingNewChat', '1'); } catch (e) {}
        location.href = 'https://app.notion.com/ai';
        return {
          ok: false,
          needsRetry: true,
          error: 'Navigation required',
          hint: 'Re-run the same command after Notion opens a new chat.',
          action: 'retry same command'
        };
      }
      return {
        ok: false,
        error: 'New chat button not found',
        hint: 'Open the sidebar Chat tab first, then retry.',
        action: 'bun-browser site notion/health'
      };
    }
    if (!getChatInput() && location.pathname.indexOf('/ai') < 0) {
      try { sessionStorage.setItem('__notionAiPendingNewChat', '1'); } catch (e) {}
      location.href = 'https://app.notion.com/ai';
      return {
        ok: false,
        needsRetry: true,
        error: 'Navigation required',
        hint: 'Re-run the same command after Notion opens a new chat.',
        action: 'retry same command'
      };
    }
    return { ok: true };
  }

  function getChatInput() {
    var editors = Array.prototype.slice.call(document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"].content-editable-leaf-rtl'));
    for (var i = 0; i < editors.length; i++) {
      if (editors[i].getAttribute('contenteditable') === 'true' && isElementVisible(editors[i])) {
        return editors[i];
      }
    }
    return null;
  }

  function setChatInput(value) {
    var editor = getChatInput();
    if (!editor) return false;
    editor.focus();
    try { editor.click(); } catch (e) {}

    document.execCommand('selectAll', false, null);
    var execOk = document.execCommand('insertText', false, value);
    if (execOk && String(editor.innerText || editor.textContent || '').trim()) {
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      return true;
    }

    // /ai landing page uses a different editor — beforeinput + textContent works there.
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
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return String(editor.innerText || editor.textContent || '').trim().length > 0;
  }

  function getSubmitButton() {
    return findByAriaLabel('Submit AI message');
  }

  function isSubmitDisabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    return false;
  }

  function clickSubmit() {
    var submit = getSubmitButton();
    if (submit && !isSubmitDisabled(submit)) {
      clickElement(submit);
      return true;
    }
    var editor = getChatInput();
    if (editor) {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      }));
      if (submit && !isSubmitDisabled(submit)) {
        clickElement(submit);
        return true;
      }
    }
    return false;
  }

  function isAssistantLeaf(el) {
    if (!el) return false;
    var block = el.closest('.notion-text-block, .notion-selectable');
    return !!block;
  }

  function getAssistantMessages() {
    var leaves = Array.prototype.slice.call(document.querySelectorAll('.content-editable-leaf-rtl'));
    var out = [];
    for (var i = 0; i < leaves.length; i++) {
      var text = (leaves[i].innerText || leaves[i].textContent || '').trim();
      if (!text) continue;
      if (leaves[i].getAttribute('contenteditable') === 'true') continue;
      if (isAssistantLeaf(leaves[i])) out.push(leaves[i]);
    }
    return out;
  }

  function isProgressLine(line) {
    var t = String(line || '').trim();
    if (!t) return false;
    if (/^Notion AI finished\.?$/i.test(t)) return true;
    if (/^(Searching|Reading|Browsing|Fetching|Thinking|Running)\b/i.test(t)) return true;
    if (/^\d+s$/i.test(t)) return true;
    return false;
  }

  function cleanAssistantText(text) {
    if (!text) return '';
    var cleaned = String(text).replace(/^Notion AI finished\.?\s*/i, '').trim();
    var lines = cleaned.split('\n');
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      if (!isProgressLine(lines[i])) kept.push(lines[i]);
    }
    return kept.join('\n').trim();
  }

  function getAssistantText(el) {
    if (!el) return '';
    return cleanAssistantText(el.innerText || el.textContent || '');
  }

  function isGenerating() {
    var text = getVisiblePageText(4000);
    if (/Notion AI finished/i.test(text)) return false;
    if (/thinking|searching|reading files|running tool|generating/i.test(text)) return true;
    return false;
  }

  function looksLikeFinalAnswer(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t || isProgressLine(t)) return false;
    if (t.length < 2) return false;
    if (/^Auto$/i.test(t)) return false;
    if (/[.!?]/.test(t) && /[A-Za-z]{2,}/.test(t)) return true;
    if (t.length >= 8) return true;
    return false;
  }

  function wasLastWaitPending() {
    return lastWaitPending;
  }

  function getLastWaitAbnormal() {
    return lastWaitAbnormal;
  }

  function buildWaitOpts(args) {
    args = args || {};
    var maxWaitMs = Number(args.maxWaitMs) || NOTION_CHAT_WAIT_MS;
    if (args.graceWaitMs != null && args.graceWaitMs !== '') {
      maxWaitMs += Math.max(0, Number(args.graceWaitMs));
    }
    return {
      pollMs: NOTION_CHAT_POLL_MS,
      maxWaitMs: maxWaitMs,
      graceWaitMs: args.graceWaitMs,
      stableNeeded: 2
    };
  }

  async function waitForAssistantAnswer(beforeCount, beforeText, opts) {
    opts = opts || {};
    var pollMs = opts.pollMs || NOTION_CHAT_POLL_MS;
    var totalWaitMs = Math.max(1000, Number(opts.maxWaitMs) || NOTION_CHAT_WAIT_MS);
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
      var abnormal = detectNotionPageAbnormal({ skipSubmitCheck: true });
      if (abnormal) {
        lastWaitAbnormal = abnormal;
        lastWaitPending = false;
        return '';
      }

      var messages = getAssistantMessages();
      var latest = messages[messages.length - 1];
      var generating = isGenerating();
      var pending = generating || messages.length <= beforeCount;
      if (pending) sawInFlight = true;

      var rawText = latest ? getAssistantText(latest) : '';
      answer = rawText ? cleanAssistantText(rawText) : '';

      if (latest && messages.length > beforeCount && !generating) {
        if (looksLikeFinalAnswer(answer)) {
          if (answer === lastText) stableRounds++;
          else stableRounds = 0;
          lastText = answer;
          if (stableRounds >= stableNeeded - 1) {
            lastWaitPending = false;
            return answer;
          }
        }
      }

      if (/Notion AI finished/i.test(getVisiblePageText(3000)) && looksLikeFinalAnswer(answer)) {
        lastWaitPending = false;
        return answer;
      }
    }

    lastWaitPending = sawInFlight;
    return answer && looksLikeFinalAnswer(answer) ? answer : '';
  }

  function modelTitleToId(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function getKnownModelTitles() {
    var titles = {};
    for (var key in MODE_ALIASES) {
      if (MODE_ALIASES.hasOwnProperty(key)) titles[MODE_ALIASES[key]] = true;
    }
    return Object.keys(titles);
  }

  function isModelTitleMapped(title) {
    var t = String(title || '').trim();
    for (var key in MODE_ALIASES) {
      if (!MODE_ALIASES.hasOwnProperty(key)) continue;
      if (MODE_ALIASES[key] === t) return true;
      if (key === modelTitleToId(t)) return true;
    }
    return false;
  }

  function isLikelyModelMenuTitle(title) {
    var t = String(title || '').trim();
    if (!t || t.length > 80) return false;
    if (/^(new chat|submit|send|chat|agents|meetings|inbox|home|allow all|reject all)$/i.test(t)) return false;
    return true;
  }

  function findModelPickerButton() {
    var editor = getChatInput();
    if (editor) {
      var node = editor.parentElement;
      for (var depth = 0; depth < 10 && node; depth++) {
        var candidates = Array.prototype.slice.call(node.querySelectorAll('[role=button], button'));
        for (var i = 0; i < candidates.length; i++) {
          var b = candidates[i];
          if (!isElementVisible(b)) continue;
          if (b.getAttribute('aria-haspopup') === 'menu' || b.getAttribute('aria-expanded') != null) {
            var text = (b.innerText || b.textContent || '').trim();
            if (text && isLikelyModelMenuTitle(text)) return b;
          }
        }
        node = node.parentElement;
      }
    }

    var submit = getSubmitButton();
    if (submit) {
      var node2 = submit.parentElement;
      for (var d = 0; d < 8 && node2; d++) {
        var btns = Array.prototype.slice.call(node2.querySelectorAll('[role=button], button'));
        for (var j = 0; j < btns.length; j++) {
          if (btns[j] === submit) continue;
          var txt = (btns[j].innerText || btns[j].textContent || '').trim();
          if (txt && isLikelyModelMenuTitle(txt) && isElementVisible(btns[j])) return btns[j];
        }
        node2 = node2.parentElement;
      }
    }

    var knownTitles = getKnownModelTitles();
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[role=button], button'));
    for (var k = 0; k < buttons.length; k++) {
      var label = (buttons[k].innerText || buttons[k].textContent || '').trim();
      if (knownTitles.indexOf(label) >= 0 && isElementVisible(buttons[k])) return buttons[k];
    }
    return null;
  }

  function readNotionModeLabel() {
    var picker = findModelPickerButton();
    if (picker) {
      var text = (picker.innerText || picker.textContent || '').trim();
      if (text) return text;
    }
    return 'Auto';
  }

  function resolveNotionMode(raw) {
    var text = String(raw || 'auto').trim().toLowerCase();
    if (MODE_ALIASES[text]) return MODE_ALIASES[text];
    for (var key in MODE_ALIASES) {
      if (!MODE_ALIASES.hasOwnProperty(key)) continue;
      if (modelTitleToId(MODE_ALIASES[key]) === text) return MODE_ALIASES[key];
    }
    return String(raw || 'Auto').trim();
  }

  function getModePickerButton(current) {
    var picker = findModelPickerButton();
    current = current || readNotionModeLabel();
    if (picker) {
      var pickerText = (picker.innerText || picker.textContent || '').trim();
      if (!current || pickerText === current) return picker;
    }
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[role=button], button'));
    return buttons.find(function(b) {
      return (b.innerText || b.textContent || '').trim() === current && isElementVisible(b);
    }) || picker || null;
  }

  async function listNotionModelsFromUi() {
    var current = readNotionModeLabel();
    var picker = getModePickerButton(current);
    if (!picker) {
      return {
        current: current,
        models: [{ id: 'auto', title: 'Auto', available: true, mapped: true }]
      };
    }
    clickElement(picker);
    await sleep(800);
    var menuRoot = document.querySelector('[role=menu], [data-radix-menu-content]') || document;
    var items = Array.prototype.slice.call(menuRoot.querySelectorAll('[role=menuitem], [role=option]'));
    var seen = {};
    var models = [];
    items.forEach(function(el) {
      var title = (el.innerText || el.textContent || '').trim();
      if (!title || !isLikelyModelMenuTitle(title)) return;
      if (seen[title]) return;
      seen[title] = true;
      models.push({
        id: modelTitleToId(title),
        title: title,
        available: true,
        mapped: isModelTitleMapped(title)
      });
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    if (!models.length) models = [{ id: 'auto', title: 'Auto', available: true, mapped: true }];
    return { current: current, models: models };
  }

  async function setNotionMode(modeRaw) {
    var target = resolveNotionMode(modeRaw);
    var current = readNotionModeLabel();
    if (current === target) return { ok: true, modeTitle: target, label: target };
    var picker = getModePickerButton(current);
    if (!picker) {
      return { ok: false, error: 'Model picker not found', hint: 'Open a Notion AI chat view first.' };
    }
    clickElement(picker);
    await sleep(800);
    var menuRoot = document.querySelector('[role=menu], [data-radix-menu-content]') || document;
    var items = Array.prototype.slice.call(menuRoot.querySelectorAll('[role=menuitem], [role=option]'));
    var match = items.find(function(el) {
      return (el.innerText || el.textContent || '').trim() === target;
    });
    if (!match) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, error: 'Mode selection failed', hint: 'Could not select model "' + target + '"' };
    }
    clickElement(match);
    await sleep(400);
    return { ok: true, modeTitle: target, label: target };
  }

  async function readResponseError(resp) {
    var errText = '';
    try { errText = await resp.text(); } catch (e) {}
    if (resp.status === 401 || resp.status === 403) {
      return {
        error: 'Not logged in',
        hint: 'Notion rejected the API request. Log in at app.notion.com and retry.',
        action: 'bun-browser open https://www.notion.so/'
      };
    }
    if (resp.status === 429) {
      return {
        error: 'Rate limit reached',
        kind: 'rate_limit',
        hint: 'Notion API rate limit (HTTP 429). Wait before retrying.',
        action: 'wait and retry'
      };
    }
    return {
      error: 'HTTP ' + resp.status,
      hint: errText ? errText.slice(0, 200) : 'Notion API request failed',
      action: 'bun-browser open https://app.notion.com/'
    };
  }

  async function fetchInferenceTranscripts(limit) {
    var spaceId = getSpaceId();
    if (!spaceId) {
      return { ok: false, error: 'Space id not found', hint: 'Open a Notion workspace page first.' };
    }
    var resp = await fetch('/api/v3/getInferenceTranscriptsForUser', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadParentPointer: { table: 'space', id: spaceId, spaceId: spaceId },
        limit: limit || 50,
        includeWriterChats: false
      })
    });
    if (!resp.ok) {
      var err = await readResponseError(resp);
      return { ok: false, error: err.error, hint: err.hint, action: err.action, kind: err.kind };
    }
    var data;
    try { data = await resp.json(); } catch (e) {
      return { ok: false, error: 'Invalid JSON response', hint: 'getInferenceTranscriptsForUser returned invalid JSON' };
    }
    return { ok: true, data: data, spaceId: spaceId };
  }

  function scrapeSidebarChats(keyword) {
    var items = [];
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[role=button], [role=link], a, button'));
    var q = String(keyword || '').trim().toLowerCase();
    nodes.forEach(function(el) {
      var text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length > 120) return;
      if (q && text.toLowerCase().indexOf(q) < 0) return;
      if (/^(new chat|agents|meetings|inbox|home)$/i.test(text)) return;
      items.push({
        title: text,
        conversationId: null,
        url: null,
        highlight: text
      });
    });
    return items;
  }

  async function navigateToConversation(conversationId) {
    var id = normalizeThreadId(conversationId);
    var url = buildConversationUrl(id);
    if (!url) {
      return { ok: false, error: 'Invalid conversation id', hint: 'Provide a thread id or Notion chat URL.' };
    }
    var current = getConversationId();
    if (current === id && getChatInput()) {
      return { ok: true, url: location.href };
    }
    if (location.href !== url) {
      try { sessionStorage.setItem('__notionAiPendingNav', id); } catch (e) {}
      location.href = url;
      return {
        ok: false,
        needsRetry: true,
        error: 'Navigation required',
        hint: 'Re-run the same command after Notion opens the conversation.',
        action: 'retry same command',
        conversationId: id,
        url: url
      };
    }
    var start = Date.now();
    while (Date.now() - start < 10000) {
      if (getChatInput()) return { ok: true, url: location.href };
      await sleep(400);
    }
    return {
      ok: false,
      error: 'Chat input not found',
      hint: 'Conversation page did not finish loading.',
      action: 'bun-browser open ' + url
    };
  }

  function extractJsonBlock(text) {
    if (!text) return '';
    var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return text.slice(start, end + 1);
    return '';
  }

  function parseAnswerJson(answer) {
    var block = extractJsonBlock(answer);
    if (!block) return null;
    try { return JSON.parse(block); } catch (e) { return null; }
  }

  var api = {
    version: HELPERS_VERSION,
    sleep: sleep,
    hasCookie: hasCookie,
    isLoggedIn: isLoggedIn,
    ensureLoggedIn: ensureLoggedIn,
    getSpaceId: getSpaceId,
    parseConversationId: parseConversationId,
    getConversationId: getConversationId,
    buildConversationUrl: buildConversationUrl,
    dismissCookieBanner: dismissCookieBanner,
    detectNotionPageAbnormal: detectNotionPageAbnormal,
    openAiChatSidebar: openAiChatSidebar,
    clickNewChat: clickNewChat,
    ensureNewChatView: ensureNewChatView,
    getChatInput: getChatInput,
    setChatInput: setChatInput,
    getSubmitButton: getSubmitButton,
    clickSubmit: clickSubmit,
    getAssistantMessages: getAssistantMessages,
    getAssistantText: getAssistantText,
    isGenerating: isGenerating,
    looksLikeFinalAnswer: looksLikeFinalAnswer,
    wasLastWaitPending: wasLastWaitPending,
    getLastWaitAbnormal: getLastWaitAbnormal,
    buildWaitOpts: buildWaitOpts,
    waitForAssistantAnswer: waitForAssistantAnswer,
    modelTitleToId: modelTitleToId,
    isModelTitleMapped: isModelTitleMapped,
    readNotionModeLabel: readNotionModeLabel,
    resolveNotionMode: resolveNotionMode,
    listNotionModelsFromUi: listNotionModelsFromUi,
    setNotionMode: setNotionMode,
    MODE_ALIASES: MODE_ALIASES,
    fetchInferenceTranscripts: fetchInferenceTranscripts,
    scrapeSidebarChats: scrapeSidebarChats,
    navigateToConversation: navigateToConversation,
    parseAnswerJson: parseAnswerJson,
    readResponseError: readResponseError
  };

  globalThis.__notionAiChatHelpers = api;
  return api;
}
