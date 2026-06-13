/* @meta
{
  "name": "notion/chat",
  "description": "Ask Notion AI in sidebar chat (AI chat: answer, model, conversationId)",
  "domain": "app.notion.com",
  "args": {
    "query": {"required": false, "description": "Prompt to send to Notion AI (optional when selectOnly is true)"},
    "model": {"required": false, "description": "Model name from notion/models (default Auto). Examples: auto, sonnet, opus, gemini, gpt-5.4"},
    "newChat": {"required": false, "description": "Start a new chat thread (default true)"},
    "selectOnly": {"required": false, "description": "Only open chat and select model; do not submit a prompt (default false)"},
    "waitOnly": {"required": false, "description": "Skip new chat / submit; only poll for the in-flight assistant reply (default false)"},
    "allowBusyTab": {"required": false, "description": "Allow newChat on a tab that is still generating (default false; use a new tab instead)"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms (default 15m)"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"},
    "context": {"required": false, "description": "Optional text prepended to the prompt"},
    "fileName": {"required": false, "description": "Attachment file name when using fileContent or fileBase64"},
    "fileContent": {"required": false, "description": "UTF-8 text file content to attach via Give context"},
    "fileBase64": {"required": false, "description": "Base64-encoded file bytes to attach via Give context"},
    "files": {"required": false, "description": "JSON array of {fileName, fileContent|fileBase64} for multiple files"},
    "pages": {"required": false, "description": "Comma-separated Notion page titles or URLs to mention"},
    "page": {"required": false, "description": "Single Notion page title or URL to mention"},
    "modelFallback": {"required": false, "description": "Retry with fallback model when --json/expectJson incomplete JSON, Opus JSON stalls, or premium models return a single-char failure (default true)"},
    "modelFallbackTo": {"required": false, "description": "Fallback model alias when Opus JSON is stuck (default auto)"},
    "modelFallbackStuckMs": {"required": false, "description": "Ms of unchanged incomplete JSON before Opus fallback (default 5000)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/chat \"Summarize this week in one paragraph\""
}
*/

async function(args) {
  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  function pickPositional(args, index) {
    if (!args._positional || args._positional.length <= index) return undefined;
    return args._positional[index];
  }

  function pickArg(args, name, index, defaultVal) {
    if (args[name] !== undefined && args[name] !== null && args[name] !== '') return args[name];
    if (index >= 0) {
      var pos = pickPositional(args, index);
      if (pos !== undefined && pos !== null && pos !== '') return pos;
    }
    return defaultVal;
  }

  function pickBoolArg(args, name, index, defaultVal) {
    return parseBool(pickArg(args, name, index, undefined), defaultVal);
  }

  var selectOnly = pickBoolArg(args, 'selectOnly', 3, false);
  var queryTextArg = pickArg(args, 'query', 0, '');
  if (!queryTextArg && !selectOnly) {
    return { error: 'Missing argument: query', hint: 'Provide a prompt for Notion AI' };
  }

  var loginBlock = (function() {
    function hasCookie(name) {
      return document.cookie.split(';').some(function(c) {
        return c.trim().startsWith(name + '=');
      });
    }
    if (!hasCookie('notion_user_id') || !hasCookie('notion_users')) {
      return {
        error: 'Not logged in',
        hint: 'Log into Notion at app.notion.com before using Notion AI commands',
        action: 'bun-browser open https://www.notion.so/'
      };
    }
    return null;
  })();
  if (loginBlock) return loginBlock;


  var h = (function installNotionAiChatHelpers() {
  var HELPERS_VERSION = 55;
  var NOTION_CHAT_WAIT_MS = 15 * 60 * 1000;
  var NOTION_CHAT_POLL_MS = 200;
  var NOTION_REVEAL_THROTTLE_MS = 2000;
  var NOTION_SUBMIT_ACK_MS = 8000;
  var NOTION_SUBMIT_MAX_ATTEMPTS = 3;
  var INCOMPLETE_JSON_STUCK_MS = 5000;

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

  var BEHAVIOR_MODE_ALIASES = {
    default: 'Default',
    ask: 'Ask',
    plan: 'Plan',
    research: 'Research'
  };

  var lastWaitPending = false;
  var lastWaitAbnormal = null;
  var lastWaitIncompleteJsonStuck = false;
  var lastWaitIncompleteJsonFailed = false;
  var lastWaitSingleCharFailed = false;
  var lastCaptureWarning = null;
  var lastUrlTrustAccepts = [];

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

  function dispatchElementClick(el) {
    if (!el) return;
    try { el.click(); } catch (e) {}
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

  function clickElement(el) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    dispatchElementClick(el);
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

  function isUrlTrustPromptContext(text) {
    return /do you trust\b|untrusted urls?\b|access untrusted urls?\b/i.test(String(text || ''));
  }

  function getUrlTrustButtonLabel(btn) {
    return String((btn && (btn.innerText || btn.textContent || btn.getAttribute('aria-label'))) || '')
      .trim()
      .toLowerCase();
  }

  function urlTrustButtonPriority(label) {
    if (label === 'allow always') return 3;
    if (label === 'allow once') return 2;
    if (label === 'allow') return 1;
    return 0;
  }

  function isUrlTrustAllowLabel(label) {
    return urlTrustButtonPriority(label) > 0;
  }

  function findUrlTrustHost(btn) {
    var container = btn && btn.parentElement;
    for (var depth = 0; depth < 12 && container; depth++) {
      var ctxt = container.innerText || container.textContent || '';
      if (isUrlTrustPromptContext(ctxt)) return container;
      container = container.parentElement;
    }
    return null;
  }

  function getUrlTrustPromptInfo(btn) {
    btn = btn || findUrlTrustAllowButton();
    if (!btn) return null;
    var host = findUrlTrustHost(btn);
    var text = host ? (host.innerText || host.textContent || '') : '';
    var urlMatch = text.match(/https?:\/\/[^\s]+/i);
    var domainMatch = text.match(/do you trust[`'"\s]*([^`'"?\n]+)/i);
    return {
      label: getUrlTrustButtonLabel(btn),
      url: urlMatch ? urlMatch[0] : null,
      domain: domainMatch ? String(domainMatch[1]).trim().replace(/[`'"]/g, '') : null
    };
  }

  function findUrlTrustAllowButton() {
    var els = Array.prototype.slice.call(document.querySelectorAll('[role=button], button'));
    var best = null;
    var bestPriority = 0;
    for (var i = 0; i < els.length; i++) {
      var label = getUrlTrustButtonLabel(els[i]);
      if (!isUrlTrustAllowLabel(label)) continue;
      if (!findUrlTrustHost(els[i])) continue;
      var priority = urlTrustButtonPriority(label);
      if (priority > bestPriority) {
        best = els[i];
        bestPriority = priority;
      }
    }
    return best;
  }

  function isUrlTrustPromptVisible() {
    return !!findUrlTrustAllowButton();
  }

  function acceptUrlTrustPrompt() {
    if (!isUrlTrustPromptVisible()) return false;
    var btn = findUrlTrustAllowButton();
    if (!btn) return false;
    var info = getUrlTrustPromptInfo(btn);
    clickElement(btn);
    if (info) lastUrlTrustAccepts.push(info);
    return true;
  }

  async function drainUrlTrustPrompts(opts) {
    opts = opts || {};
    var maxRounds = opts.maxRounds == null ? 16 : Math.max(1, Number(opts.maxRounds));
    var pauseMs = opts.pauseMs == null ? 350 : Math.max(0, Number(opts.pauseMs));
    var accepted = [];
    var lastKey = '';
    for (var round = 0; round < maxRounds; round++) {
      if (!isUrlTrustPromptVisible()) break;
      var info = getUrlTrustPromptInfo();
      var key = info ? String(info.url || info.domain || info.label || '') : '';
      if (key && key === lastKey) break;
      if (!acceptUrlTrustPrompt()) break;
      if (info) accepted.push(info);
      lastKey = key;
      await sleep(pauseMs);
    }
    return { accepted: accepted.length, prompts: accepted };
  }

  function getLastUrlTrustAccepts() {
    return lastUrlTrustAccepts.slice();
  }

  function resetUrlTrustState() {
    lastUrlTrustAccepts = [];
  }

  function getVisiblePageText(maxLen) {
    maxLen = maxLen || 12000;
    var text = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function getTextExcludingNodes(root, excludeSelectors, maxLen) {
    if (!root) return '';
    var clone = root.cloneNode(true);
    var excludes = excludeSelectors || [];
    for (var s = 0; s < excludes.length; s++) {
      var nodes = clone.querySelectorAll(excludes[s]);
      for (var i = 0; i < nodes.length; i++) nodes[i].remove();
    }
    var text = (clone.innerText || clone.textContent || '').trim();
    maxLen = maxLen || 4000;
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  var ABNORMAL_EXCLUDE_SELECTORS = [
    '.content-editable-leaf-rtl:not([contenteditable="true"])',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"].content-editable-leaf-rtl'
  ];

  function getAbnormalDetectionText(maxLen) {
    maxLen = maxLen || 4000;
    var chunks = [];
    var alerts = document.querySelectorAll('[role="alert"], [role="status"], [role="dialog"]');
    for (var i = 0; i < alerts.length; i++) {
      var alertText = (alerts[i].innerText || alerts[i].textContent || '').trim();
      if (alertText) chunks.push(alertText);
    }
    var chatRoot = document.querySelector('.layout-chat');
    if (chatRoot) {
      chunks.push(getTextExcludingNodes(chatRoot, ABNORMAL_EXCLUDE_SELECTORS, maxLen));
    } else {
      var editor = getChatInput();
      if (editor) {
        var host = editor;
        for (var depth = 0; depth < 6 && host && host.parentElement && host.parentElement !== document.body; depth++) {
          host = host.parentElement;
        }
        if (host && host !== document.body) {
          chunks.push(getTextExcludingNodes(host, ABNORMAL_EXCLUDE_SELECTORS, 2000));
        }
      }
    }
    var combined = chunks.filter(Boolean).join('\n');
    return combined.length > maxLen ? combined.slice(0, maxLen) : combined;
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

  function matchCreditsExhausted(text) {
    var t = String(text || '');
    if (/run out of free ai responses/i.test(t)) {
      return {
        error: 'Run out of free AI responses',
        kind: 'credits_exhausted',
        hint: 'This Notion workspace has used all free AI responses.',
        action: 'wait and retry or upgrade plan'
      };
    }
    if (/ai (credits|quota).*(exhausted|used up|reached)/i.test(t)) {
      return {
        error: 'AI credits exhausted',
        kind: 'credits_exhausted',
        hint: 'This Notion workspace has no remaining AI credits.',
        action: 'wait and retry or upgrade plan'
      };
    }
    return null;
  }

  function matchRateLimit(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    if (/\btoo many requests\b/i.test(t)) {
      return {
        error: 'Rate limit reached',
        kind: 'rate_limit',
        hint: 'Notion AI rate limit detected. Wait before retrying.',
        action: 'wait and retry'
      };
    }
    if (/\brate limit\b/i.test(t)) {
      return {
        error: 'Rate limit reached',
        kind: 'rate_limit',
        hint: 'Notion AI rate limit detected. Wait before retrying.',
        action: 'wait and retry'
      };
    }
    return null;
  }

  function matchPromptRejected(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    if (/\ban error occurred,?\s*please try again\.?\b/i.test(t)) {
      return {
        error: 'An error occurred, please try again.',
        kind: 'prompt_rejected',
        hint: 'Notion AI rejected the prompt. Retry with a shorter or simpler prompt.',
        action: 'retry with a revised prompt'
      };
    }
    return null;
  }

  function detectNotionPageAbnormal(opts) {
    opts = opts || {};
    var text = getAbnormalDetectionText(4000);
    var creditsBlock = matchCreditsExhausted(text);
    if (creditsBlock) return creditsBlock;
    var rateBlock = matchRateLimit(text);
    if (rateBlock) return rateBlock;
    var rejectBlock = matchPromptRejected(text) || matchPromptRejected(getChatActivityText(6000));
    if (rejectBlock) return rejectBlock;
    if (!opts.skipSubmitCheck) {
      var submit = getSubmitButton();
      var editor = getChatInput();
      var hasText = editor && String(editor.innerText || editor.textContent || '').trim();
      if (submit && isSubmitDisabled(submit) && hasText) {
        return {
          error: 'Chat submission blocked',
          kind: 'submit_disabled',
          hint: 'Send button is disabled — often due to credits or rate limits.',
          action: 'bun-browser open https://app.notion.com/ai'
        };
      }
    }
    return null;
  }

  async function ensureAiLandingPage() {
    dismissCookieBanner();
    if (location.pathname.indexOf('/ai') === 0) {
      return { ok: true, via: 'ai-landing' };
    }
    if (location.pathname.indexOf('/chat') === 0) {
      return { ok: true, via: 'chat-view' };
    }
    try { sessionStorage.setItem('__notionAiPendingLanding', '1'); } catch (e) {}
    location.href = 'https://app.notion.com/ai';
    return {
      ok: false,
      needsRetry: true,
      error: 'Navigation required',
      hint: 'Re-run the same command after Notion opens the AI landing page.',
      action: 'retry same command'
    };
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
        action: 'bun-browser open https://app.notion.com/ai'
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

  function hasNotionChatShell() {
    return location.pathname.indexOf('/ai') === 0 ||
      location.pathname.indexOf('/chat') === 0 ||
      !!document.querySelector('.layout-chat');
  }

  async function waitForModelPickerButton(maxMs) {
    var deadline = Date.now() + (maxMs == null ? 1500 : maxMs);
    while (Date.now() < deadline) {
      var picker = findModelPickerButton();
      if (picker) return picker;
      await sleep(250);
    }
    return null;
  }

  async function ensureNotionModelListView() {
    dismissCookieBanner();

    var existingPicker = await waitForModelPickerButton(300);
    if (existingPicker) return { ok: true, via: 'model-picker' };

    if (hasNotionChatShell()) {
      existingPicker = await waitForModelPickerButton(1500);
      if (existingPicker) return { ok: true, via: 'chat-view' };
    }

    var sidebar = await openAiChatSidebar();
    if (sidebar.ok) {
      existingPicker = await waitForModelPickerButton(1500);
      if (existingPicker) {
        return { ok: true, via: sidebar.via || 'chat-sidebar' };
      }
    }

    return {
      ok: false,
      error: 'Model picker not found',
      hint: 'Open any Notion tab with AI chat visible (sidebar Chat tab or app.notion.com/ai), then retry.',
      action: 'bun-browser open https://app.notion.com/ai'
    };
  }

  function isStaleChatThread() {
    return getAssistantMessagesSinceLastUser().length > 0 || hasCompletedReplyActions();
  }

  async function ensureNewChatView() {
    var landing = await ensureAiLandingPage();
    if (!landing.ok) return landing;

    if (getChatInput() && !isStaleChatThread()) {
      return { ok: true, via: 'ai-landing' };
    }

    for (var attempt = 0; attempt < 5; attempt++) {
      if (getChatInput() && !isStaleChatThread()) {
        return { ok: true, via: attempt > 0 ? 'new-chat-cleared' : 'ai-landing' };
      }
      var created = await clickNewChat();
      if (!created.ok) {
        if (getChatInput() && !isStaleChatThread()) {
          return { ok: true, via: 'ai-landing' };
        }
        if (attempt >= 4) {
          if (getChatInput() && isStaleChatThread()) {
            try { sessionStorage.setItem('__notionAiPendingNewChat', '1'); } catch (e) {}
            location.href = 'https://app.notion.com/ai';
            return {
              ok: false,
              needsRetry: true,
              error: 'Navigation required',
              hint: 'Re-run the same command after Notion clears the prior chat.',
              action: 'retry same command'
            };
          }
          return {
            ok: false,
            error: 'New chat button not found',
            hint: 'Open the sidebar Chat tab first, then retry.',
            action: 'bun-browser open https://app.notion.com/ai'
          };
        }
        await sleep(400);
        continue;
      }
      var clearDeadline = Date.now() + 6000;
      while (Date.now() < clearDeadline && isStaleChatThread()) {
        await sleep(200);
      }
    }

    if (!getChatInput()) {
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

    if (isStaleChatThread()) {
      try { sessionStorage.setItem('__notionAiPendingNewChat', '1'); } catch (e) {}
      location.href = 'https://app.notion.com/ai';
      return {
        ok: false,
        needsRetry: true,
        error: 'Navigation required',
        hint: 'Re-run the same command after Notion clears the prior chat.',
        action: 'retry same command'
      };
    }

    return { ok: true, via: 'new-chat-cleared' };
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

  function focusChatInput() {
    var editor = getChatInput();
    if (!editor) return false;
    try { editor.focus(); } catch (e) {}
    try { editor.click(); } catch (e) {}
    return document.activeElement === editor || editor.contains(document.activeElement);
  }

  function setChatInput(value) {
    var editor = getChatInput();
    if (!editor) return false;
    if (!focusChatInput()) return false;

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

  function getComposerEditor() {
    var editor = getChatInput();
    if (editor) return editor;
    return document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"].content-editable-leaf-rtl');
  }

  function getComposerText() {
    var editor = getComposerEditor();
    if (!editor) return '';
    return String(editor.innerText || editor.textContent || '').trim();
  }

  function isComposerCleared(queryText) {
    var editor = getComposerEditor();
    if (!editor) return false;
    var composer = getComposerText();
    var q = String(queryText || '').trim();
    if (!composer) return true;
    if (!q) return composer.length < 5;
    if (composer.length <= 2) return true;
    if (composer.length >= Math.min(q.length, 24) * 0.65) return false;
    return composer.length < q.length * 0.35;
  }

  function hasSubmitFlightSignals(beforeCount, beforeText, queryText) {
    if (isGeneratingForTurn(beforeCount, beforeText)) return true;
    if (hasActiveAgentStatusLines()) return true;
    var messages = getAssistantMessagesSinceLastUser();
    if (messages.length > beforeCount) return true;
    if (hasNewTurnContent(messages, beforeCount, beforeText)) return true;
    if (queryText && isComposerCleared(queryText)) return true;
    return false;
  }

  async function waitForSubmitAck(beforeCount, beforeText, queryText, opts) {
    opts = opts || {};
    var ackWaitMs = Math.max(1500, Number(opts.ackWaitMs) || NOTION_SUBMIT_ACK_MS);
    var pollMs = Math.max(150, Number(opts.submitAckPollMs) || 400);
    var deadline = Date.now() + ackWaitMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      if (hasSubmitFlightSignals(beforeCount, beforeText, queryText)) {
        return { ok: true };
      }
      var abnormal = detectNotionPageAbnormal({ skipSubmitCheck: true });
      if (abnormal) return { ok: false, abnormal: abnormal };
    }
    return {
      ok: false,
      reason: 'silent_no_signals',
      composerText: getComposerText()
    };
  }

  async function submitChatPrompt(queryText, beforeCount, beforeText, opts) {
    opts = opts || {};
    beforeText = beforeText != null ? String(beforeText) : '';
    var maxAttempts = Math.max(1, Number(opts.submitAttempts) || NOTION_SUBMIT_MAX_ATTEMPTS);
    var lastAck = null;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!setChatInput(queryText)) {
        return {
          ok: false,
          error: 'Chat input not found',
          hint: 'Could not fill the Notion AI prompt box.'
        };
      }
      await sleep(400);
      var accessBlock = detectNotionPageAbnormal();
      if (accessBlock) return Object.assign({ ok: false }, accessBlock);
      if (!clickSubmit()) {
        accessBlock = detectNotionPageAbnormal();
        if (accessBlock) return Object.assign({ ok: false }, accessBlock);
        return {
          ok: false,
          error: 'Submit button not found',
          hint: 'Could not find the Notion AI send button.'
        };
      }
      lastAck = await waitForSubmitAck(beforeCount, beforeText, queryText, opts);
      if (lastAck.ok) {
        return { ok: true, attempts: attempt };
      }
      if (lastAck.abnormal) return Object.assign({ ok: false }, lastAck.abnormal);
      if (attempt < maxAttempts) {
        await sleep(600);
      }
    }
    return {
      ok: false,
      error: 'Silent submit',
      kind: 'silent_submit',
      hint: 'Notion accepted the prompt but showed no progress. Re-run the same command to retry submit.',
      action: 'retry same command',
      attempts: maxAttempts,
      lastAck: lastAck
    };
  }

  function isAssistantLeaf(el) {
    if (!el) return false;
    var block = el.closest('.notion-text-block, .notion-selectable');
    return !!block;
  }

  function isAssistantMetadataText(text) {
    var t = String(text || '').trim();
    if (!t) return true;
    if (/^(true|false)\.?$/i.test(t)) return true;
    return false;
  }

  function getLastUserLeafIndex(leaves) {
    var lastUserLeafIdx = -1;
    for (var i = 0; i < leaves.length; i++) {
      var text = (leaves[i].innerText || leaves[i].textContent || '').trim();
      if (!text || leaves[i].getAttribute('contenteditable') === 'true') continue;
      if (!isAssistantLeaf(leaves[i])) lastUserLeafIdx = i;
    }
    return lastUserLeafIdx;
  }

  function getAssistantMessages() {
    var root = document.querySelector('.layout-chat') || document;
    var leaves = Array.prototype.slice.call(root.querySelectorAll('.content-editable-leaf-rtl'));
    var out = [];
    for (var i = 0; i < leaves.length; i++) {
      var text = (leaves[i].innerText || leaves[i].textContent || '').trim();
      if (!text) continue;
      if (leaves[i].getAttribute('contenteditable') === 'true') continue;
      if (!isAssistantLeaf(leaves[i])) continue;
      if (isAssistantMetadataText(text)) continue;
      out.push(leaves[i]);
    }
    return out;
  }

  function getAssistantMessagesSinceLastUser() {
    var root = document.querySelector('.layout-chat') || document;
    var leaves = Array.prototype.slice.call(root.querySelectorAll('.content-editable-leaf-rtl'));
    var lastUserLeafIdx = getLastUserLeafIndex(leaves);
    var out = [];
    for (var j = lastUserLeafIdx + 1; j < leaves.length; j++) {
      var leaf = leaves[j];
      var leafText = (leaf.innerText || leaf.textContent || '').trim();
      if (!leafText || leaf.getAttribute('contenteditable') === 'true') continue;
      if (!isAssistantLeaf(leaf)) continue;
      if (isAssistantMetadataText(leafText)) continue;
      out.push(leaf);
    }
    return out;
  }

  function isProgressLine(line) {
    var t = String(line || '').trim();
    if (!t) return false;
    if (/^Notion AI finished\.?$/i.test(t)) return true;
    if (/^(Searching|Reading|Browsing|Fetching|Thinking|Running|Brewing|Focusing)\b/i.test(t)) return true;
    if (/^\d+s$/i.test(t)) return true;
    return false;
  }

  function isAgentStatusLine(line) {
    var t = String(line || '').trim();
    if (!t) return false;
    if (isProgressLine(t)) return true;
    if (/^(Exploring|Computing|Thinking|Brewing|Focusing|Searching the web|Reading files|Running tool|Generating|Writing file|Loading web page|Loaded web page|Called function|Searched the web|Browsing|Fetching top|Fetching recent)\b/i.test(t)) {
      return true;
    }
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

  function isScrollToBottomLabel(label) {
    return /scroll.*bottom|jump.*bottom|see.*latest|scroll.*down|latest.*message/i.test(String(label || ''));
  }

  function isPlusIconSvg(svg) {
    if (!svg) return false;
    var paths = svg.querySelectorAll('path, polygon, polyline');
    var hasVertical = false;
    var hasHorizontal = false;
    for (var i = 0; i < paths.length; i++) {
      var d = (paths[i].getAttribute('d') || paths[i].getAttribute('points') || '').toLowerCase();
      if (!d) continue;
      if (/\bv\d+/i.test(d)) hasVertical = true;
      if (/\bh\d+/i.test(d)) hasHorizontal = true;
    }
    return hasVertical && hasHorizontal;
  }

  function isDownArrowSvg(svg) {
    if (!svg || isPlusIconSvg(svg)) return false;
    var paths = svg.querySelectorAll('path, polygon, polyline');
    for (var i = 0; i < paths.length; i++) {
      var d = (paths[i].getAttribute('d') || paths[i].getAttribute('points') || '').toLowerCase();
      if (!d) continue;
      if (/down|chevron/i.test(d)) return true;
      if (/m[\d.]+\s+[\d.]+\s*l[\d.\s-]+/i.test(d) && !/\bv\d+/i.test(d) && !/\bh\d+/i.test(d)) return true;
    }
    return false;
  }

  function isComposerControlButton(el) {
    if (!el) return false;
    var label = normalizeReplyActionLabel(el.getAttribute('aria-label') || '');
    if (label === 'give context') return true;
    if (label === 'new chat' || label === 'start new chat') return true;
    if (label === 'submit ai message') return true;
    if (label === 'settings') return true;
    if (label === 'start voice recording') return true;
    if (label === 'add photos and files') return true;
    return false;
  }

  function isSaveReplyActionLabel(label) {
    var normalized = normalizeReplyActionLabel(label);
    return normalized === 'save' || normalized === 'save to private pages';
  }

  function isReplyToolbarButton(el) {
    if (!el) return false;
    var label = normalizeReplyActionLabel(el.getAttribute('aria-label') || '');
    if (isSaveReplyActionLabel(label)) return true;
    for (var i = 0; i < REPLY_ACTION_REQUIRED.length; i++) {
      if (label === normalizeReplyActionLabel(REPLY_ACTION_REQUIRED[i])) return true;
    }
    if (/^(share positive feedback|share negative feedback)$/.test(label)) return true;
    return false;
  }

  function findScrollToBottomButton() {
    var root = document.querySelector('.layout-chat') || document.body;
    if (!root) return null;
    var candidates = Array.prototype.slice.call(root.querySelectorAll('button, [role=button]'));
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isElementVisible(el)) continue;
      if (isReplyToolbarButton(el)) continue;
      if (isComposerControlButton(el)) continue;
      var label = el.getAttribute('aria-label') || '';
      var score = 0;
      if (isScrollToBottomLabel(label)) score += 100;
      var svg = el.querySelector('svg');
      if (svg && isDownArrowSvg(svg)) score += 50;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.position === 'fixed' || style.position === 'sticky' || style.position === 'absolute')) {
        score += 20;
      }
      var rect = el.getBoundingClientRect();
      if (rect.width >= 24 && rect.width <= 88 && rect.height >= 24 && rect.height <= 88) score += 15;
      if (rect.top > window.innerHeight * 0.45) score += 25;
      if (score < 40) continue;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function clickScrollToBottomButton() {
    var btn = findScrollToBottomButton();
    if (!btn) return { clicked: false, gone: true, found: false };
    clickElement(btn);
    return { clicked: true, gone: !findScrollToBottomButton(), found: true };
  }

  function findChatScrollContainer() {
    var root = document.querySelector('.layout-chat');
    if (!root) return null;
    var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    var best = null;
    var bestScroll = 0;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.scrollHeight <= el.clientHeight + 8) continue;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (!style) continue;
      var overflowY = style.overflowY || '';
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
      var scrollRoom = el.scrollHeight - el.clientHeight;
      if (scrollRoom > bestScroll) {
        bestScroll = scrollRoom;
        best = el;
      }
    }
    return best;
  }

  function scrollChatContainerToBottom() {
    var container = findChatScrollContainer();
    if (!container) return false;
    container.scrollTop = container.scrollHeight;
    return true;
  }

  function shouldRunRevealSideEffect(revealThrottle) {
    if (!revealThrottle) return true;
    var now = Date.now();
    if (revealThrottle.lastAt === 0 || now - revealThrottle.lastAt >= NOTION_REVEAL_THROTTLE_MS) {
      revealThrottle.lastAt = now;
      return true;
    }
    return false;
  }

  function revealLatestReplyInView() {
    var clicks = 0;
    var scrolled = false;
    for (var i = 0; i < 3; i++) {
      if (!findScrollToBottomButton()) break;
      var clickResult = clickScrollToBottomButton();
      if (clickResult.clicked) {
        clicks++;
        scrolled = true;
      }
      if (clickResult.gone) break;
    }
    if (scrollChatContainerToBottom()) scrolled = true;
    return { scrolled: scrolled, clicks: clicks };
  }

  async function scrollToLatestReply(opts) {
    opts = opts || {};
    var maxClicks = Math.max(1, Number(opts.maxClicks) || 3);
    var pauseMs = Number(opts.pauseMs) || 180;
    var clicks = 0;
    var scrolled = false;
    for (var i = 0; i < maxClicks; i++) {
      if (!findScrollToBottomButton()) break;
      var clickResult = clickScrollToBottomButton();
      if (clickResult.clicked) {
        clicks++;
        scrolled = true;
      }
      if (pauseMs > 0) await sleep(pauseMs);
      if (clickResult.gone) break;
    }
    if (scrollChatContainerToBottom()) scrolled = true;
    return { scrolled: scrolled, clicks: clicks };
  }

  function shouldRevealReplyScope(beforeCount, beforeText) {
    if (arguments.length >= 2) {
      return hasCompletedReplyActionsForTurn(beforeCount, beforeText);
    }
    return hasCompletedReplyActions() && !isGenerating();
  }

  function getAssistantTextFromReplyScope(beforeCount, beforeText, captureOpts) {
    captureOpts = captureOpts || {};
    if (shouldRevealReplyScope(beforeCount, beforeText) &&
        shouldRunRevealSideEffect(captureOpts.revealThrottle)) {
      revealLatestReplyInView();
    }
    var scope = getLatestAssistantReplyScope();
    if (!scope) {
      var chatRoot = document.querySelector('.layout-chat');
      if (chatRoot) {
        var anchorBtn = chatRoot.querySelector('[aria-label="Copy response"]') ||
          findUnifiedReplySaveButton(chatRoot) ||
          chatRoot.querySelector('[aria-label="Save to private pages"]');
        if (anchorBtn) {
          scope = anchorBtn.closest('.assistant-turn') || anchorBtn.parentElement;
        }
      }
    }
    if (!scope) return '';
    var nodes = scope.querySelectorAll('.content-editable-leaf-rtl, .notion-text-block');
    var parts = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute('contenteditable') === 'true') continue;
      var text = cleanAssistantText(node.innerText || node.textContent || '');
      if (!text || isAssistantMetadataText(text) || looksLikeThoughtBlock(text)) continue;
      parts.push(text);
    }
    return parts.join('\n').trim();
  }

  function getAssistantAnswerSince(messages, beforeCount, beforeText, captureOpts) {
    if (!messages || messages.length < beforeCount) return '';
    beforeCount = Math.max(0, Number(beforeCount) || 0);
    beforeText = beforeText != null ? String(beforeText) : '';
    captureOpts = captureOpts || {};
    var scopeReady = !captureOpts.skipScopeReady && (
      arguments.length >= 3
        ? hasCompletedReplyActionsForTurn(beforeCount, beforeText)
        : hasCompletedReplyActions() && !isGenerating()
    );
    var parts = [];
    if (messages.length > beforeCount) {
      for (var i = beforeCount; i < messages.length; i++) {
        var part = getAssistantText(messages[i]);
        if (!part || looksLikeThoughtBlock(part)) continue;
        parts.push(part);
      }
    } else if (messages.length === beforeCount && beforeCount > 0) {
      var inPlace = getAssistantText(messages[messages.length - 1]);
      if (inPlace && !looksLikeThoughtBlock(inPlace)) parts.push(inPlace);
    }
    var result = parts.join('\n').trim();
    if (scopeReady) {
      var scopeText = getAssistantTextFromReplyScope(beforeCount, beforeText, captureOpts);
      if (scopeText && scopeText.length > result.length) {
        var extraLen = scopeText.replace(result, '').trim().length;
        if (extraLen > 8 || (hasParsedJsonAnswer(scopeText) && !hasParsedJsonAnswer(result))) {
          result = scopeText;
        }
      }
    }
    if (!result && scopeReady) {
      var scopeFallback = getAssistantTextFromReplyScope(beforeCount, beforeText, captureOpts);
      if (scopeFallback) return scopeFallback;
    }
    return result;
  }

  function getCurrentReplyAssistantStartCount() {
    return getAssistantMessages().length - getAssistantMessagesSinceLastUser().length;
  }

  function normalizeAnswerText(text) {
    return String(text || '')
      .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
      .replace(/\u00A0/g, ' ');
  }

  function getChatActivityText(maxLen) {
    maxLen = maxLen || 12000;
    var chatRoot = document.querySelector('.layout-chat');
    var text = chatRoot
      ? (chatRoot.innerText || chatRoot.textContent || '')
      : getVisiblePageText(maxLen);
    if (text.length <= maxLen) return text;
    return text.slice(-maxLen);
  }

  function getRecentChatLines(maxLines) {
    maxLines = maxLines || 30;
    var lines = getChatActivityText(5000).split('\n');
    if (lines.length <= maxLines) return lines;
    return lines.slice(lines.length - maxLines);
  }

  function hasActiveAgentStatusLines() {
    var lines = getRecentChatLines(30);
    for (var i = 0; i < lines.length; i++) {
      if (isAgentStatusLine(lines[i])) return true;
    }
    return false;
  }

  var REPLY_ACTION_LABELS = [
    'copy response',
    'save to private pages',
    'share positive feedback',
    'share negative feedback'
  ];
  var REPLY_ACTION_REQUIRED = [
    'copy response',
    'save to private pages'
  ];
  var REPLY_ACTION_FEEDBACK = [
    'share positive feedback',
    'share negative feedback'
  ];

  var REPLY_SAVE_SELECTOR = '[role="button"][tabindex="0"][aria-label="Save"]';

  var REPLY_ACTION_ATTR = {
    'copy response': 'Copy response',
    'save to private pages': ['Save', 'Save to private pages'],
    'share positive feedback': 'Share positive feedback',
    'share negative feedback': 'Share negative feedback'
  };

  function normalizeReplyActionLabel(label) {
    return String(label || '').trim().toLowerCase();
  }

  function isReplyActionElement(el) {
    if (!el || !el.querySelector('svg')) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'button') return true;
    var role = (el.getAttribute('role') || '').toLowerCase();
    return role === 'button';
  }

  function findUnifiedReplySaveButton(root) {
    root = root || document;
    var nodes = Array.prototype.slice.call(root.querySelectorAll(REPLY_SAVE_SELECTOR));
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!isElementVisible(node)) continue;
      if (!node.querySelector('svg')) continue;
      if (!isReplyActionElement(node)) continue;
      best = node;
    }
    return best;
  }

  function findReplyActionButtonByAria(scope, attr) {
    var nodes = scope.querySelectorAll('[aria-label="' + attr + '"]');
    var fallback = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.querySelector('svg')) continue;
      if (isReplyActionElement(node)) return node;
      if (!fallback) fallback = node;
    }
    return fallback;
  }

  function findReplyActionButton(scope, label) {
    if (!scope) return null;
    var normalized = normalizeReplyActionLabel(label);
    if (normalized === 'save to private pages') {
      var unified = findUnifiedReplySaveButton(scope);
      if (unified) return unified;
      return findReplyActionButtonByAria(scope, 'Save to private pages');
    }
    var attr = REPLY_ACTION_ATTR[normalized];
    if (!attr) return null;
    if (Array.isArray(attr)) {
      for (var a = 0; a < attr.length; a++) {
        var found = findReplyActionButtonByAria(scope, attr[a]);
        if (found) return found;
      }
      return null;
    }
    return findReplyActionButtonByAria(scope, attr);
  }

  function getLatestAssistantReplyScope() {
    var msgs = getAssistantMessagesSinceLastUser();
    if (!msgs.length) return null;
    var latest = msgs[msgs.length - 1];
    var el = latest;
    while (el && el !== document.body) {
      if (findReplyActionButton(el, 'save to private pages')) return el;
      el = el.parentElement;
    }
    el = latest;
    while (el && el !== document.body) {
      if (findReplyActionButton(el, 'copy response')) return el;
      el = el.parentElement;
    }
    var block = latest.closest('.notion-text-block, .notion-selectable');
    if (block) {
      var parent = block.parentElement;
      if (parent && parent !== document.body) return parent;
      return block;
    }
    var parentEl = latest.parentElement;
    if (parentEl && parentEl !== document.body) return parentEl;
    return latest;
  }

  function isReplyFinishBlocked() {
    return false;
  }

  function hasCompletedReplyActions() {
    var scope = getLatestAssistantReplyScope();
    if (!scope) return false;
    for (var i = 0; i < REPLY_ACTION_REQUIRED.length; i++) {
      if (!findReplyActionButton(scope, REPLY_ACTION_REQUIRED[i])) return false;
    }
    var hasPositive = !!findReplyActionButton(scope, REPLY_ACTION_FEEDBACK[0]);
    var hasNegative = !!findReplyActionButton(scope, REPLY_ACTION_FEEDBACK[1]);
    if (hasPositive || hasNegative) return hasPositive && hasNegative;
    return true;
  }

  function hasAssistantReplyActions() {
    return hasCompletedReplyActions();
  }

  function hasNewTurnContent(messages, beforeCount, beforeText) {
    if (!messages) messages = getAssistantMessagesSinceLastUser();
    if (messages.length > beforeCount) return true;
    var prior = String(beforeText || '').trim();
    if (messages.length === beforeCount && beforeCount > 0) {
      var inPlace = getAssistantText(messages[messages.length - 1]);
      if (inPlace && !looksLikeThoughtBlock(inPlace) && inPlace !== prior) return true;
    }
    return false;
  }

  function hasCompletedReplyActionsForTurn(beforeCount, beforeText) {
    if (!hasCompletedReplyActions()) return false;
    var messages = getAssistantMessagesSinceLastUser();
    if (!hasNewTurnContent(messages, beforeCount, beforeText)) return false;
    var answer = getAssistantAnswerSince(messages, beforeCount, beforeText, { skipScopeReady: true });
    if (!looksLikeFinalAnswer(answer)) return false;
    if (looksLikeJsonAnswerAttempt(answer) && !hasParsedJsonAnswer(answer)) return false;
    return true;
  }

  function isGeneratingForTurn(beforeCount, beforeText) {
    if (isUrlTrustPromptVisible()) return true;
    var messages = getAssistantMessagesSinceLastUser();
    if (hasNewTurnContent(messages, beforeCount, beforeText)) {
      var answer = getAssistantAnswerSince(messages, beforeCount, beforeText, { skipScopeReady: true });
      if (!looksLikeFinalAnswer(answer)) return true;
      if (looksLikeJsonAnswerAttempt(answer) && !hasParsedJsonAnswer(answer)) return true;
    }
    if (hasCompletedReplyActionsForTurn(beforeCount, beforeText)) return false;
    if (hasCompletedReplyActions()) return true;
    if (hasActiveAgentStatusLines()) return true;
    return false;
  }

  function isGenerating() {
    if (isUrlTrustPromptVisible()) return true;
    if (hasCompletedReplyActions()) return false;
    if (hasActiveAgentStatusLines()) return true;
    return false;
  }

  function isChatInProgress() {
    if (hasCompletedReplyActions()) {
      var completedMsgs = getAssistantMessages();
      if (completedMsgs.length) {
        var completedLatest = getAssistantText(completedMsgs[completedMsgs.length - 1]);
        if (completedLatest) {
          if (!looksLikeFinalAnswer(completedLatest)) return true;
          if (looksLikeJsonAnswerAttempt(completedLatest) && !hasParsedJsonAnswer(completedLatest)) return true;
        }
      }
      return false;
    }
    if (isGenerating()) return true;
    var msgs = getAssistantMessages();
    if (!msgs.length) return false;
    var latest = getAssistantText(msgs[msgs.length - 1]);
    if (looksLikeInProgressAnswer(latest)) return true;
    if (latest && !looksLikeFinalAnswer(latest) && hasActiveAgentStatusLines()) return true;
    return false;
  }

  function looksLikeThoughtBlock(text) {
    var t = normalizeAnswerText(text).trim();
    if (!t) return false;
    if (/^The user wants me to\b/i.test(t)) return true;
    if (/^I already have some data:/i.test(t)) return true;
    if (/^From web\.loadPage on\b/i.test(t)) return true;
    if (/^Fetch (?:recent|top)\b/i.test(t)) return true;
    if (/^Wait, in the first turn\b/i.test(t)) return true;
    if (/^Let me scroll back\b/i.test(t)) return true;
    if (/^Actually in the first turn\b/i.test(t)) return true;
    if (/^I need to:\s*$/i.test(t)) return true;
    return false;
  }

  function looksLikeInProgressAnswer(text) {
    var t = normalizeAnswerText(text).trim();
    if (!t) return false;
    if (looksLikeThoughtBlock(t)) return true;
    if (t.length > 450) return false;
    if (/\|.+\|/.test(t) || /```/.test(t)) return false;
    if (/^I see you(?:'ve| have)\b/i.test(t)) return true;
    var intro = /^I'll\b|^I will\b|^Let me\b|^I'm going to\b|^Give me a (moment|minute|second)\b|^Starting\b|^Working on\b|^First,?\s+I'll\b/i;
    if (intro.test(t)) return true;
    if (/\bI'll prioritize\b/i.test(t)) return true;
    if (/\bbegin the\b.*\bworkflow\b/i.test(t)) return true;
    if (/\b(prioritize|workflow now|queued)\b/i.test(t) && t.length < 320) return true;
    return false;
  }

  function looksLikeJsonAnswerAttempt(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/^\{/.test(t)) return true;
    if (/```(?:json)?/i.test(t)) return true;
    if (/\{[\s\S]*"/.test(t)) return true;
    return false;
  }

  function hasParsedJsonAnswer(text) {
    return parseAnswerJson(text) != null;
  }

  function waitExpectsJson(opts) {
    opts = opts || {};
    if (opts.expectJson) return true;
    return queryExpectsJson(opts.query);
  }

  function looksLikeFinalAnswer(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t || isProgressLine(t)) return false;
    if (matchCreditsExhausted(t)) return false;
    if (matchPromptRejected(t)) return false;
    if (looksLikeInProgressAnswer(t)) return false;
    if (looksLikeJsonAnswerAttempt(t)) return hasParsedJsonAnswer(t);
    if (/^Auto$/i.test(t)) return false;
    if (/^\d+$/.test(t)) return true;
    if (/^[A-Za-z]{2,48}$/.test(t)) return true;
    if (t.length < 2) return false;
    if (/[.!?]/.test(t) && /[A-Za-z]{2,}/.test(t)) return true;
    if (t.length >= 8) return true;
    return false;
  }

  function wasLastWaitPending() {
    return lastWaitPending;
  }

  function wasLastWaitIncompleteJsonStuck() {
    return lastWaitIncompleteJsonStuck;
  }

  function wasLastWaitIncompleteJsonFailed() {
    return lastWaitIncompleteJsonFailed;
  }

  function wasLastWaitSingleCharFailed() {
    return lastWaitSingleCharFailed;
  }

  function parseBoolish(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  function isOpusMode(modeRaw) {
    var resolved = resolveNotionMode(modeRaw);
    if (/^opus/i.test(resolved)) return true;
    var raw = String(modeRaw || '').trim().toLowerCase();
    return /^opus(-|$)/.test(raw);
  }

  function isPremiumFallbackModel(modeRaw) {
    var resolved = resolveNotionMode(modeRaw);
    if (/^(opus|sonnet|fable)/i.test(resolved)) return true;
    var raw = String(modeRaw || '').trim().toLowerCase();
    return /^(opus|sonnet|fable)(-|$)/.test(raw);
  }

  function isSingleCharModelResponse(text) {
    return String(text || '').trim().length === 1;
  }

  function getModelFallbackTriggerReason() {
    if (lastWaitSingleCharFailed) return 'single_char_failed';
    if (lastWaitIncompleteJsonFailed) return 'incomplete_json_failed';
    if (lastWaitIncompleteJsonStuck) return 'incomplete_json_stuck';
    return null;
  }

  function shouldModelFallbackOnSingleCharFailed(modeRaw, opts) {
    opts = opts || {};
    if (!parseBoolish(opts.modelFallback, true)) return false;
    return isPremiumFallbackModel(modeRaw);
  }

  function shouldRetryModelFallback(modeRaw, query, opts) {
    opts = opts || {};
    if (!parseBoolish(opts.modelFallback, true)) return false;
    if (lastWaitSingleCharFailed) return shouldModelFallbackOnSingleCharFailed(modeRaw, opts);
    if (lastWaitIncompleteJsonFailed) return shouldModelFallbackOnIncompleteJson(modeRaw, opts);
    if (lastWaitIncompleteJsonStuck) return shouldModelFallbackOnJsonStuck(modeRaw, query, opts);
    return false;
  }

  function rejectSingleCharFailedAnswer(answer, opts) {
    if (!answer || !isSingleCharModelResponse(answer)) return answer;
    opts = opts || {};
    if (!shouldModelFallbackOnSingleCharFailed(opts.mode || opts.model, opts)) return answer;
    lastWaitSingleCharFailed = true;
    lastWaitPending = true;
    return '';
  }

  function resolveModelFallbackTarget(modeRaw, opts) {
    opts = opts || {};
    var target = opts.modelFallbackTo != null && String(opts.modelFallbackTo).trim()
      ? String(opts.modelFallbackTo).trim()
      : 'auto';
    return resolveNotionMode(target);
  }

  function shouldModelFallbackOnJsonStuck(modeRaw, query, opts) {
    opts = opts || {};
    if (!parseBoolish(opts.modelFallback, true)) return false;
    if (!waitExpectsJson(opts) && !queryExpectsJson(query)) return false;
    return isOpusMode(modeRaw);
  }

  function shouldModelFallbackOnIncompleteJson(modeRaw, opts) {
    opts = opts || {};
    if (!parseBoolish(opts.modelFallback, true)) return false;
    if (!waitExpectsJson(opts)) return false;
    var target = resolveModelFallbackTarget(modeRaw, opts);
    if (resolveNotionMode(modeRaw) === target) return false;
    return true;
  }

  function isIncompleteJsonFailedAnswer(answer, opts) {
    if (!answer) return false;
    if (!waitExpectsJson(opts)) return false;
    return !hasParsedJsonAnswer(answer);
  }

  function rejectIncompleteJsonFailedAnswer(answer, opts) {
    if (!isIncompleteJsonFailedAnswer(answer, opts)) return answer;
    opts = opts || {};
    if (!shouldModelFallbackOnIncompleteJson(opts.mode || opts.model, opts)) return answer;
    lastWaitIncompleteJsonFailed = true;
    lastWaitPending = true;
    return '';
  }

  function getLastWaitAbnormal() {
    return lastWaitAbnormal;
  }

  function getTabCaptureState() {
    return {
      hidden: document.hidden,
      visibility: document.visibilityState,
      captureReliable: !document.hidden && document.visibilityState === 'visible'
    };
  }

  function getLastCaptureWarning() {
    return lastCaptureWarning;
  }

  function validateExtractedAnswer(answer, opts, requireFinal) {
    if (!answer || looksLikeInProgressAnswer(answer)) return null;
    var answerCreditsBlock = matchCreditsExhausted(answer);
    if (answerCreditsBlock) {
      lastWaitAbnormal = answerCreditsBlock;
      return '';
    }
    var answerRejectBlock = matchPromptRejected(answer);
    if (answerRejectBlock) {
      lastWaitAbnormal = answerRejectBlock;
      return '';
    }
    var answerRateBlock = matchRateLimit(answer);
    if (answerRateBlock) {
      lastWaitAbnormal = answerRateBlock;
      return '';
    }
    var expectsJson = waitExpectsJson(opts);
    if (expectsJson && !hasParsedJsonAnswer(answer)) return null;
    if (requireFinal && !looksLikeFinalAnswer(answer)) return null;
    return answer;
  }

  function tryExtractCompletedAnswer(messages, beforeCount, beforeText, opts) {
    if (typeof beforeText === 'object' && beforeText !== null && !Array.isArray(beforeText)) {
      opts = beforeText;
      beforeText = '';
    }
    opts = opts || {};
    beforeText = beforeText != null ? String(beforeText) : '';
    if (!hasNewTurnContent(messages, beforeCount, beforeText)) return null;
    if (!hasCompletedReplyActionsForTurn(beforeCount, beforeText)) return null;
    var answer = getAssistantAnswerSince(messages, beforeCount, beforeText);
    return validateExtractedAnswer(answer, opts, false);
  }

  function recoverCompletedAnswer(beforeCount, beforeText, opts) {
    opts = opts || {};
    beforeText = beforeText != null ? String(beforeText) : '';
    var messages = getAssistantMessagesSinceLastUser();
    var direct = tryExtractCompletedAnswer(messages, beforeCount, beforeText, opts);
    if (direct) return direct;
    if (!hasCompletedReplyActions()) return '';
    if (!hasNewTurnContent(messages, beforeCount, beforeText)) return '';
    revealLatestReplyInView();
    var full = getAssistantAnswerSince(messages, 0, beforeText);
    if (!full) full = getAssistantTextFromReplyScope(beforeCount, beforeText);
    var validated = validateExtractedAnswer(full, opts, false);
    if (validated) return validated;
    revealLatestReplyInView();
    full = getAssistantAnswerSince(messages, beforeCount, beforeText);
    if (!full) full = getAssistantTextFromReplyScope(beforeCount, beforeText);
    return validateExtractedAnswer(full, opts, false) || '';
  }

  function pickPositionalArg(args, index) {
    if (!args || !args._positional || args._positional.length <= index) return undefined;
    var val = args._positional[index];
    if (val === undefined || val === null || val === '') return undefined;
    return val;
  }

  function buildWaitOpts(args) {
    args = args || {};
    var maxWaitRaw = args.maxWaitMs;
    if (maxWaitRaw == null || maxWaitRaw === '') maxWaitRaw = pickPositionalArg(args, 6);
    var maxWaitMs = Number(maxWaitRaw) || NOTION_CHAT_WAIT_MS;
    if (args.graceWaitMs != null && args.graceWaitMs !== '') {
      maxWaitMs += Math.max(0, Number(args.graceWaitMs));
    }
    var opts = {
      pollMs: NOTION_CHAT_POLL_MS,
      maxWaitMs: maxWaitMs,
      graceWaitMs: args.graceWaitMs,
      stableNeeded: 1
    };
    if (args.query != null && String(args.query).trim()) {
      opts.query = String(args.query);
      if (queryExpectsJson(opts.query)) {
        opts.expectJson = true;
        if (args.stableNeeded == null || args.stableNeeded === '') {
          opts.stableNeeded = 2;
        }
      }
    }
    if (args.expectJson) opts.expectJson = true;
    if (parseBoolish(args.json, false)) opts.expectJson = true;
    opts.modelFallback = parseBoolish(args.modelFallback, true);
    if (args.modelFallbackTo != null && String(args.modelFallbackTo).trim()) {
      opts.modelFallbackTo = String(args.modelFallbackTo).trim();
    }
    if (args.modelFallbackStuckMs != null && args.modelFallbackStuckMs !== '') {
      opts.modelFallbackStuckMs = Math.max(500, Number(args.modelFallbackStuckMs));
    }
    if (args.model != null && String(args.model).trim()) {
      opts.mode = String(args.model).trim();
    }
    return opts;
  }

  async function waitForAssistantAnswer(beforeCount, beforeText, opts) {
    opts = opts || {};
    var pollMs = opts.pollMs || NOTION_CHAT_POLL_MS;
    var totalWaitMs = Math.max(1000, Number(opts.maxWaitMs) || NOTION_CHAT_WAIT_MS);
    var stableNeeded = opts.stableNeeded || 1;
    var deadline = Date.now() + totalWaitMs;

    var answer = '';
    var stableRounds = 0;
    var lastText = '';
    var lastMessageCount = beforeCount;
    var sawInFlight = false;
    var pollCount = 0;
    var lastIncompleteJsonText = '';
    var incompleteJsonStableSince = 0;
    var stuckMs = Math.max(500, Number(opts.modelFallbackStuckMs) || INCOMPLETE_JSON_STUCK_MS);
    var revealThrottle = { lastAt: 0 };
    var captureOpts = Object.assign({}, opts, { revealThrottle: revealThrottle });
    lastWaitPending = false;
    lastWaitAbnormal = null;
    lastWaitIncompleteJsonStuck = false;
    lastWaitIncompleteJsonFailed = false;
    lastWaitSingleCharFailed = false;
    lastCaptureWarning = null;
    var tabState = getTabCaptureState();
    if (!tabState.captureReliable) {
      lastCaptureWarning = 'Tab is hidden; focus this Chrome tab for reliable capture.';
    }

    while (Date.now() < deadline) {
      pollCount++;
      if (pollCount > 1) await sleep(pollMs);
      if (isUrlTrustPromptVisible() || pollCount === 1 || pollCount % 5 === 0) {
        await drainUrlTrustPrompts({ maxRounds: 2, pauseMs: 120 });
      }
      var chatRejectBlock = matchPromptRejected(getChatActivityText(6000));
      if (chatRejectBlock) {
        lastWaitAbnormal = chatRejectBlock;
        lastWaitPending = false;
        return '';
      }
      var abnormal = detectNotionPageAbnormal({ skipSubmitCheck: true });
      if (abnormal) {
        lastWaitAbnormal = abnormal;
        lastWaitPending = false;
        return '';
      }

      var messages = getAssistantMessagesSinceLastUser();
      if (messages.length > beforeCount) sawInFlight = true;

      var toolbarAnswer = tryExtractCompletedAnswer(messages, beforeCount, beforeText, captureOpts);
      if (toolbarAnswer === '') return '';
      if (toolbarAnswer) {
        var rejectedToolbar = rejectSingleCharFailedAnswer(toolbarAnswer, opts);
        if (!rejectedToolbar) return '';
        rejectedToolbar = rejectIncompleteJsonFailedAnswer(rejectedToolbar, opts);
        if (!rejectedToolbar) return '';
        lastWaitPending = false;
        return rejectedToolbar;
      }

      var generating = isGeneratingForTurn(beforeCount, beforeText);
      var pending = generating || !hasNewTurnContent(messages, beforeCount, beforeText);
      if (pending) sawInFlight = true;

      answer = getAssistantAnswerSince(messages, beforeCount, beforeText, captureOpts);
      if (hasCompletedReplyActions() && isSingleCharModelResponse(answer)) {
        var rejectedSingleChar = rejectSingleCharFailedAnswer(answer, opts);
        if (!rejectedSingleChar) return '';
      }
      if (messages.length > lastMessageCount) {
        lastMessageCount = messages.length;
        stableRounds = 0;
        lastText = '';
        lastIncompleteJsonText = '';
        incompleteJsonStableSince = 0;
        sawInFlight = true;
      }

      if (waitExpectsJson(opts) && looksLikeJsonAnswerAttempt(answer) && !hasParsedJsonAnswer(answer)) {
        if (answer && answer === lastIncompleteJsonText) {
          if (incompleteJsonStableSince && Date.now() - incompleteJsonStableSince >= stuckMs) {
            lastWaitIncompleteJsonStuck = true;
            lastWaitPending = true;
            return '';
          }
        } else {
          lastIncompleteJsonText = answer || '';
          incompleteJsonStableSince = Date.now();
        }
        sawInFlight = true;
      }

      var turnUpdated = messages.length > beforeCount ||
        (messages.length === beforeCount && beforeCount > 0 && hasNewTurnContent(messages, beforeCount, beforeText));
      if (turnUpdated && !generating && !looksLikeInProgressAnswer(answer)) {
        var expectsJson = waitExpectsJson(opts);
        if (expectsJson && answer && !hasParsedJsonAnswer(answer)) {
          if (hasCompletedReplyActionsForTurn(beforeCount, beforeText)) {
            if (shouldRunRevealSideEffect(revealThrottle)) {
              await scrollToLatestReply({ maxClicks: 2, pauseMs: 120 });
            }
            answer = getAssistantAnswerSince(messages, beforeCount, beforeText, captureOpts);
            if (hasParsedJsonAnswer(answer)) {
              var rejectedJson = rejectSingleCharFailedAnswer(answer, opts);
              if (!rejectedJson) return '';
              lastWaitPending = false;
              return rejectedJson;
            }
          }
          sawInFlight = true;
        } else if (!!answer && looksLikeFinalAnswer(answer)) {
          if (answer === lastText) stableRounds++;
          else stableRounds = 0;
          lastText = answer;
          if (stableRounds >= stableNeeded - 1) {
            var rejectedStable = rejectSingleCharFailedAnswer(answer, opts);
            if (!rejectedStable) return '';
            rejectedStable = rejectIncompleteJsonFailedAnswer(rejectedStable, opts);
            if (!rejectedStable) return '';
            lastWaitPending = false;
            return rejectedStable;
          }
        }
      }
    }

    var incompleteJson = waitExpectsJson(opts) && looksLikeJsonAnswerAttempt(answer) && !hasParsedJsonAnswer(answer);
    var recovered = recoverCompletedAnswer(beforeCount, beforeText, opts);
    if (recovered) {
      var rejectedRecovered = rejectSingleCharFailedAnswer(recovered, opts);
      if (!rejectedRecovered) return '';
      rejectedRecovered = rejectIncompleteJsonFailedAnswer(rejectedRecovered, opts);
      if (!rejectedRecovered) return '';
      lastWaitPending = false;
      return rejectedRecovered;
    }
    lastWaitPending = sawInFlight || incompleteJson;
    if (incompleteJson) {
      if (hasCompletedReplyActionsForTurn(beforeCount, beforeText) || hasCompletedReplyActions()) {
        if (shouldModelFallbackOnIncompleteJson(opts.mode, opts)) {
          lastWaitIncompleteJsonFailed = true;
          lastWaitPending = true;
        }
      }
      return '';
    }
    if (answer && looksLikeFinalAnswer(answer)) {
      if (waitExpectsJson(opts) && !hasParsedJsonAnswer(answer)) {
        var rejectedFinal = rejectIncompleteJsonFailedAnswer(answer, opts);
        if (!rejectedFinal) return '';
        return rejectedFinal;
      }
      return answer;
    }
    return '';
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

  function isInViewport(el, margin) {
    margin = margin == null ? 8 : margin;
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return rect.bottom > margin &&
      rect.right > margin &&
      rect.top < window.innerHeight - margin &&
      rect.left < window.innerWidth - margin;
  }

  function getElementCenter(el) {
    var rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function normalizeMenuItemTitle(title) {
    return String(title || '').trim().replace(/\s+/g, ' ');
  }

  function readModelMenuItemTitle(el) {
    if (!el || !el.closest('[role=dialog]')) return '';
    var presentations = el.querySelectorAll('[role=presentation]');
    for (var pi = 0; pi < presentations.length; pi++) {
      var title = normalizeMenuItemTitle(presentations[pi].innerText || presentations[pi].textContent || '');
      if (title) return title;
    }
    return '';
  }

  function collectModelMenuItems(root) {
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll('[role=menuitem]'));
  }

  function countKnownModelHits(root, knownTitles) {
    var items = collectModelMenuItems(root);
    var hits = 0;
    for (var i = 0; i < items.length; i++) {
      if (knownTitles.indexOf(readModelMenuItemTitle(items[i])) >= 0) hits++;
    }
    return { hits: hits, items: items };
  }

  function scoreModelPickerSurface(el, picker, knownTitles) {
    if (!el || !isElementVisible(el)) return -1;
    if ((el.getAttribute('role') || '') !== 'dialog') return -1;
    var stats = countKnownModelHits(el, knownTitles);
    if (stats.hits < 2) return -1;

    var score = stats.hits * 1000;
    if (isInViewport(el)) score += 800;
    else {
      var rect = el.getBoundingClientRect();
      if (rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0 || rect.top > window.innerHeight) {
        score -= 2000;
      } else {
        score -= 400;
      }
    }

    if (picker) {
      var pickerCenter = getElementCenter(picker);
      var surfaceCenter = getElementCenter(el);
      var dx = surfaceCenter.x - pickerCenter.x;
      var dy = surfaceCenter.y - pickerCenter.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      score -= Math.min(Math.round(distance), 1200);
      if (surfaceCenter.y >= pickerCenter.y - 40) score += 80;
    }

    var role = el.getAttribute('role') || '';
    if (role === 'dialog') score += 40;
    if (el.hasAttribute('data-radix-menu-content')) score += 30;

    return score;
  }

  function gatherModelPickerSurfaceCandidates(picker) {
    var seen = [];
    var out = [];
    function add(el) {
      if (!el || seen.indexOf(el) >= 0) return;
      seen.push(el);
      out.push(el);
    }

    if (picker) {
      var controlId = picker.getAttribute('aria-controls') || picker.getAttribute('aria-owns');
      if (controlId) add(document.getElementById(controlId));
    }

    var selectors = [
      '[role=dialog]',
      '[role=menu]',
      '[role=listbox]',
      '[data-radix-menu-content]',
      '[data-radix-popper-content-wrapper]'
    ];
    for (var si = 0; si < selectors.length; si++) {
      var nodes = document.querySelectorAll(selectors[si]);
      for (var ni = 0; ni < nodes.length; ni++) add(nodes[ni]);
    }
    return out;
  }

  function gatherModelPickerDialogCandidates(picker) {
    var seen = [];
    var out = [];
    function add(el) {
      if (!el || seen.indexOf(el) >= 0) return;
      seen.push(el);
      out.push(el);
    }

    if (picker) {
      var controlId = picker.getAttribute('aria-controls') || picker.getAttribute('aria-owns');
      if (controlId) {
        var controlled = document.getElementById(controlId);
        if (controlled && (controlled.getAttribute('role') || '') === 'dialog') add(controlled);
      }
    }

    var nodes = document.querySelectorAll('[role=dialog]');
    for (var di = 0; di < nodes.length; di++) add(nodes[di]);
    return out;
  }

  function findModelPickerSurface(picker) {
    var knownTitles = getKnownModelTitles();
    var candidates = gatherModelPickerDialogCandidates(picker);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var score = scoreModelPickerSurface(candidates[i], picker, knownTitles);
      if (score > bestScore) {
        bestScore = score;
        best = candidates[i];
      }
    }
    return bestScore >= 0 ? best : null;
  }

  async function ensureModelPickerSurface(picker) {
    if (!picker) return null;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);

    var expanded = picker.getAttribute('aria-expanded') === 'true';
    if (!expanded) {
      clickElement(picker);
      await sleep(350);
    }

    for (var attempt = 0; attempt < 10; attempt++) {
      var surface = findModelPickerSurface(picker);
      if (surface) return surface;

      if (attempt === 0 && expanded) {
        clickElement(picker);
        await sleep(200);
        clickElement(picker);
        await sleep(350);
        expanded = false;
        continue;
      }

      if (attempt === 3) {
        clickElement(picker);
        await sleep(350);
      }

      await sleep(250);
    }
    return null;
  }

  function findModelMenuItem(surface, targetTitle) {
    if (!surface) return null;
    var items = collectModelMenuItems(surface);
    var normalizedTarget = normalizeMenuItemTitle(targetTitle);
    for (var i = 0; i < items.length; i++) {
      if (readModelMenuItemTitle(items[i]) === normalizedTarget) return items[i];
    }
    return null;
  }

  function isModelPickerMenuOpen(picker) {
    picker = picker || findModelPickerButton();
    if (picker && picker.getAttribute('aria-expanded') === 'true') return true;
    var knownTitles = getKnownModelTitles();
    var dialogs = Array.prototype.slice.call(document.querySelectorAll('[role=dialog]'));
    for (var i = 0; i < dialogs.length; i++) {
      if (!isElementVisible(dialogs[i])) continue;
      if (countKnownModelHits(dialogs[i], knownTitles).hits >= 2) return true;
    }
    return false;
  }

  function blurModelPicker(picker) {
    picker = picker || findModelPickerButton();
    if (!picker) return;
    try {
      if (document.activeElement === picker || picker.contains(document.activeElement)) {
        picker.blur();
      }
    } catch (e) {}
  }

  async function closeModelPickerSurface(picker) {
    picker = picker || findModelPickerButton();

    for (var round = 0; round < 4; round++) {
      if (!isModelPickerMenuOpen(picker)) break;
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true
      }));
      await sleep(300);
    }

    var editor = getChatInput();
    if (editor && isModelPickerMenuOpen(picker)) {
      dispatchElementClick(editor);
      await sleep(250);
    }

    if (picker && picker.getAttribute('aria-expanded') === 'true') {
      dispatchElementClick(picker);
      await sleep(300);
    }

    blurModelPicker(picker);
    focusChatInput();
  }

  function isLikelyModelMenuTitle(title) {
    var t = String(title || '').trim();
    if (!t || t.length > 80) return false;
    if (/^(new chat|submit|send|chat|agents|meetings|inbox|home|allow all|reject all|personalize)$/i.test(t)) return false;
    if (/\n\d+[hmd]\b/i.test(t)) return false;
    return true;
  }

  var MODEL_PICKER_SELECTOR = '[data-testid="unified-chat-model-button"][role="button"]';

  function findModelPickerButton() {
    var pickers = Array.prototype.slice.call(document.querySelectorAll(MODEL_PICKER_SELECTOR));
    for (var i = 0; i < pickers.length; i++) {
      if (isElementVisible(pickers[i])) return pickers[i];
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
    return findModelPickerButton();
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
    var menuRoot = null;
    try {
      menuRoot = await ensureModelPickerSurface(picker);
      if (!menuRoot) {
        return {
          current: current,
          models: [{ id: 'auto', title: 'Auto', available: true, mapped: true }],
          warning: 'Model picker menu not found'
        };
      }
      var items = collectModelMenuItems(menuRoot);
      var seen = {};
      var models = [];
      items.forEach(function(el) {
        var title = readModelMenuItemTitle(el);
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
      if (!models.length) models = [{ id: 'auto', title: 'Auto', available: true, mapped: true }];
      return { current: current, models: models };
    } finally {
      await closeModelPickerSurface(picker);
    }
  }

  async function setNotionMode(modeRaw) {
    var target = resolveNotionMode(modeRaw);
    var current = readNotionModeLabel();
    if (current === target) return { ok: true, modeTitle: target, label: target };
    var picker = getModePickerButton(current);
    if (!picker) {
      return { ok: false, error: 'Model picker not found', hint: 'Open a Notion AI chat view first.' };
    }
    var menuRoot = await ensureModelPickerSurface(picker);
    if (!menuRoot) {
      await closeModelPickerSurface(picker);
      return { ok: false, error: 'Model picker menu not found', hint: 'Open a Notion AI chat view and retry.' };
    }
    var match = findModelMenuItem(menuRoot, target);
    if (!match) {
      await closeModelPickerSurface(picker);
      return { ok: false, error: 'Mode selection failed', hint: 'Could not select model "' + target + '"' };
    }
    clickElement(match);
    await sleep(400);
    await closeModelPickerSurface(picker);
    return { ok: true, modeTitle: target, label: target };
  }

  function getKnownBehaviorModeTitles() {
    var titles = [];
    for (var key in BEHAVIOR_MODE_ALIASES) {
      if (BEHAVIOR_MODE_ALIASES.hasOwnProperty(key)) titles.push(BEHAVIOR_MODE_ALIASES[key]);
    }
    return titles;
  }

  function behaviorModeTitleToId(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function resolveNotionBehaviorMode(raw) {
    var text = String(raw || 'default').trim().toLowerCase();
    if (BEHAVIOR_MODE_ALIASES[text]) return BEHAVIOR_MODE_ALIASES[text];
    for (var key in BEHAVIOR_MODE_ALIASES) {
      if (!BEHAVIOR_MODE_ALIASES.hasOwnProperty(key)) continue;
      if (behaviorModeTitleToId(BEHAVIOR_MODE_ALIASES[key]) === text) return BEHAVIOR_MODE_ALIASES[key];
    }
    return String(raw || 'Default').trim();
  }

  function closeSettingsSurfaces() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function findSettingsButton() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[role=button], button'));
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (!isElementVisible(b) || !isInViewport(b)) continue;
      if ((b.getAttribute('aria-label') || '').trim() === 'Settings') return b;
    }
    return null;
  }

  function collectBehaviorModeItems(root) {
    if (!root) return [];
    return Array.prototype.slice.call(
      root.querySelectorAll('[role=menuitemradio], [role=menuitem], [role=option]')
    );
  }

  function readBehaviorModeItemTitle(el) {
    return normalizeMenuItemTitle(String(el.innerText || el.textContent || '').split('\n')[0]);
  }

  function countKnownBehaviorModeHits(root, knownTitles) {
    var items = collectBehaviorModeItems(root);
    var hits = 0;
    for (var i = 0; i < items.length; i++) {
      if (knownTitles.indexOf(readBehaviorModeItemTitle(items[i])) >= 0) hits++;
    }
    return { hits: hits, items: items };
  }

  function scoreBehaviorModeSurface(el, anchor, knownTitles) {
    if (!el || !isElementVisible(el)) return -1;
    var stats = countKnownBehaviorModeHits(el, knownTitles);
    if (stats.hits < 2) return -1;

    var score = stats.hits * 1000;
    if (isInViewport(el)) score += 800;
    else score -= 1500;

    if (anchor) {
      var anchorCenter = getElementCenter(anchor);
      var surfaceCenter = getElementCenter(el);
      var dx = surfaceCenter.x - anchorCenter.x;
      var dy = surfaceCenter.y - anchorCenter.y;
      score -= Math.min(Math.round(Math.sqrt(dx * dx + dy * dy)), 1000);
      if (surfaceCenter.x >= anchorCenter.x - 40) score += 120;
    }

    var role = el.getAttribute('role') || '';
    if (role === 'menu' || role === 'dialog' || role === 'listbox') score += 40;
    return score;
  }

  function findBehaviorModeSurface(anchor) {
    var knownTitles = getKnownBehaviorModeTitles();
    var candidates = gatherModelPickerSurfaceCandidates(anchor);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var score = scoreBehaviorModeSurface(candidates[i], anchor, knownTitles);
      if (score > bestScore) {
        bestScore = score;
        best = candidates[i];
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function findSettingsModeEntry() {
    var items = Array.prototype.slice.call(document.querySelectorAll('[role=menuitem], [role=button], button'));
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (!isElementVisible(el) || !isInViewport(el)) continue;
      var text = normalizeMenuItemTitle(String(el.innerText || el.textContent || '').replace(/\s+/g, ' '));
      if (/^Mode\b/i.test(text)) return el;
    }
    return null;
  }

  function readSettingsModeEntryLabel(entry) {
    if (!entry) return 'Default';
    var text = normalizeMenuItemTitle(String(entry.innerText || entry.textContent || '').replace(/\s+/g, ' '));
    return text.replace(/^Mode\s*/i, '') || 'Default';
  }

  function scrapeBehaviorModesFromSurface(surface) {
    var seen = {};
    var modes = [];
    collectBehaviorModeItems(surface).forEach(function(el) {
      var lines = String(el.innerText || el.textContent || '').trim().split('\n');
      var title = normalizeMenuItemTitle(lines[0] || '');
      if (!title || seen[title]) return;
      seen[title] = true;
      modes.push({
        id: behaviorModeTitleToId(title),
        title: title,
        description: normalizeMenuItemTitle(lines.slice(1).join(' ')),
        available: true,
        mapped: true
      });
    });
    return modes;
  }

  function defaultBehaviorModesList() {
    return getKnownBehaviorModeTitles().map(function(title) {
      return {
        id: behaviorModeTitleToId(title),
        title: title,
        available: true,
        mapped: true
      };
    });
  }

  async function ensureSettingsDialog() {
    closeSettingsSurfaces();
    await sleep(150);

    var settingsBtn = findSettingsButton();
    if (!settingsBtn) {
      return { ok: false, error: 'Settings button not found', hint: 'Open Notion AI chat view first.' };
    }

    if (settingsBtn.getAttribute('aria-expanded') !== 'true') {
      clickElement(settingsBtn);
      await sleep(400);
    }

    for (var attempt = 0; attempt < 8; attempt++) {
      var modeEntry = findSettingsModeEntry();
      if (modeEntry) {
        return {
          ok: true,
          settingsBtn: settingsBtn,
          modeEntry: modeEntry,
          current: readSettingsModeEntryLabel(modeEntry)
        };
      }
      if (attempt === 2) clickElement(settingsBtn);
      await sleep(200);
    }

    return { ok: false, error: 'Settings panel not found', hint: 'Open Notion AI chat and retry.' };
  }

  async function ensureBehaviorModeSurface(settingsBtn) {
    var modeEntry = findSettingsModeEntry();
    if (!modeEntry) {
      return { ok: false, error: 'Settings mode entry not found' };
    }

    var surface = findBehaviorModeSurface(modeEntry);
    if (surface) return { ok: true, modeEntry: modeEntry, surface: surface };

    clickElement(modeEntry);
    await sleep(350);

    for (var attempt = 0; attempt < 8; attempt++) {
      surface = findBehaviorModeSurface(modeEntry);
      if (surface) return { ok: true, modeEntry: modeEntry, surface: surface };
      if (attempt === 2) {
        clickElement(modeEntry);
        await sleep(250);
      }
      await sleep(200);
    }

    return { ok: false, error: 'Behavior mode menu not found', modeEntry: modeEntry };
  }

  function findBehaviorMenuItem(surface, targetTitle) {
    var normalizedTarget = normalizeMenuItemTitle(targetTitle);
    var items = collectBehaviorModeItems(surface);
    for (var i = 0; i < items.length; i++) {
      if (readBehaviorModeItemTitle(items[i]) === normalizedTarget) return items[i];
    }
    return null;
  }

  async function listNotionBehaviorModesFromUi() {
    var opened = await ensureSettingsDialog();
    if (!opened.ok) {
      return {
        current: 'Default',
        modes: defaultBehaviorModesList(),
        warning: opened.error || opened.hint
      };
    }

    var current = opened.current || readSettingsModeEntryLabel(opened.modeEntry);
    var ensured = await ensureBehaviorModeSurface(opened.settingsBtn);
    var modes = ensured.ok ? scrapeBehaviorModesFromSurface(ensured.surface) : [];
    if (!modes.length) modes = defaultBehaviorModesList();

    closeSettingsSurfaces();
    await sleep(150);
    return { current: current, modes: modes };
  }

  async function setNotionBehaviorMode(modeRaw) {
    var target = resolveNotionBehaviorMode(modeRaw);
    var opened = await ensureSettingsDialog();
    if (!opened.ok) return opened;

    var current = opened.current || readSettingsModeEntryLabel(opened.modeEntry);
    if (current === target) {
      closeSettingsSurfaces();
      return { ok: true, modeTitle: target, label: target };
    }

    var ensured = await ensureBehaviorModeSurface(opened.settingsBtn);
    if (!ensured.ok) {
      closeSettingsSurfaces();
      return {
        ok: false,
        error: 'Behavior mode selection failed',
        hint: ensured.error || ('Could not open mode menu for "' + target + '"')
      };
    }

    var match = findBehaviorMenuItem(ensured.surface, target);
    if (!match) {
      closeSettingsSurfaces();
      return { ok: false, error: 'Behavior mode selection failed', hint: 'Could not select mode "' + target + '"' };
    }

    clickElement(match);
    await sleep(350);
    closeSettingsSurfaces();
    return { ok: true, modeTitle: target, label: target };
  }

  var GIVE_CONTEXT_MARKERS = [
    'Add photos and files',
    'Mention pages or people',
    'Create image'
  ];

  var SETTINGS_MENU_MARKERS = [
    'Web access',
    'My sources',
    'Add sources'
  ];

  function readMenuItemFirstLine(el) {
    return normalizeMenuItemTitle(String(el.innerText || el.textContent || '').split('\n')[0]);
  }

  function scoreGiveContextButton(btn, editor, submit) {
    if (!btn || !isElementVisible(btn)) return -1;
    if ((btn.getAttribute('aria-label') || '').trim() !== 'Give context') return -1;
    if (!isInViewport(btn)) return -1;

    var score = 1000;
    var btnCenter = getElementCenter(btn);
    if (editor) {
      var editorCenter = getElementCenter(editor);
      var dy = Math.abs(btnCenter.y - editorCenter.y);
      score -= Math.min(dy, 500);
      if (dy < 80) score += 200;
    }
    if (submit) {
      var submitCenter = getElementCenter(submit);
      var dySubmit = Math.abs(btnCenter.y - submitCenter.y);
      if (dySubmit < 40) score += 300;
      score -= Math.min(Math.abs(btnCenter.x - submitCenter.x), 800);
    }
    return score;
  }

  function findGiveContextButton() {
    var editor = getChatInput();
    var submit = getSubmitButton();
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[role=button], button'));
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < buttons.length; i++) {
      var score = scoreGiveContextButton(buttons[i], editor, submit);
      if (score > bestScore) {
        bestScore = score;
        best = buttons[i];
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function countGiveContextMarkerHits(root) {
    if (!root) return 0;
    var hits = 0;
    var items = Array.prototype.slice.call(root.querySelectorAll('[role=menuitem]'));
    for (var i = 0; i < items.length; i++) {
      var line = readMenuItemFirstLine(items[i]);
      for (var j = 0; j < GIVE_CONTEXT_MARKERS.length; j++) {
        if (line.indexOf(GIVE_CONTEXT_MARKERS[j]) === 0) hits++;
      }
    }
    return hits;
  }

  function countSettingsMarkerHits(root) {
    if (!root) return 0;
    var hits = 0;
    var items = Array.prototype.slice.call(root.querySelectorAll('[role=menuitem]'));
    for (var i = 0; i < items.length; i++) {
      var line = readMenuItemFirstLine(items[i]);
      for (var j = 0; j < SETTINGS_MENU_MARKERS.length; j++) {
        if (line.indexOf(SETTINGS_MENU_MARKERS[j]) === 0) hits++;
      }
    }
    return hits;
  }

  function scoreGiveContextSurface(el, anchor) {
    if (!el || !isElementVisible(el)) return -1;
    var giveHits = countGiveContextMarkerHits(el);
    if (giveHits < 2) return -1;

    var score = giveHits * 1000;
    score -= countSettingsMarkerHits(el) * 500;
    if (isInViewport(el)) score += 800;
    else score -= 1500;

    if (anchor) {
      var anchorCenter = getElementCenter(anchor);
      var surfaceCenter = getElementCenter(el);
      var dx = surfaceCenter.x - anchorCenter.x;
      var dy = surfaceCenter.y - anchorCenter.y;
      score -= Math.min(Math.round(Math.sqrt(dx * dx + dy * dy)), 1000);
      if (Math.abs(dx) < 80) score += 150;
      if (surfaceCenter.y >= anchorCenter.y - 60) score += 80;
    }

    var role = el.getAttribute('role') || '';
    if (role === 'dialog' || role === 'menu' || role === 'listbox') score += 40;
    return score;
  }

  function findGiveContextSurface(anchor) {
    var candidates = gatherModelPickerSurfaceCandidates(anchor);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var score = scoreGiveContextSurface(candidates[i], anchor);
      if (score > bestScore) {
        bestScore = score;
        best = candidates[i];
      }
    }
    return bestScore >= 0 ? best : null;
  }

  async function ensureGiveContextSurface(anchor) {
    anchor = anchor || findGiveContextButton();
    if (!anchor) {
      return { ok: false, error: 'Give context button not found', hint: 'Open Notion AI chat view first.' };
    }

    closeSettingsSurfaces();
    await sleep(150);

    var expanded = anchor.getAttribute('aria-expanded') === 'true';
    if (!expanded) {
      clickElement(anchor);
      await sleep(400);
    }

    for (var attempt = 0; attempt < 8; attempt++) {
      var surface = findGiveContextSurface(anchor);
      if (surface) return { ok: true, anchor: anchor, surface: surface };
      if (attempt === 2) {
        clickElement(anchor);
        await sleep(250);
      }
      await sleep(200);
    }

    return { ok: false, error: 'Give context menu not found', hint: 'Could not open the Give context menu.', anchor: anchor };
  }

  function findGiveContextMenuItem(surface, labelPattern) {
    if (!surface) return null;
    var re = labelPattern instanceof RegExp ? labelPattern : new RegExp('^' + labelPattern, 'i');
    var items = Array.prototype.slice.call(surface.querySelectorAll('[role=menuitem]'));
    for (var i = 0; i < items.length; i++) {
      if (re.test(readMenuItemFirstLine(items[i]))) return items[i];
    }
    return null;
  }

  function guessNotionMimeType(fileName) {
    var lower = String(fileName || '').toLowerCase();
    if (/\.txt$/.test(lower)) return 'text/plain';
    if (/\.md$/.test(lower)) return 'text/markdown';
    if (/\.json$/.test(lower)) return 'application/json';
    if (/\.csv$/.test(lower)) return 'text/csv';
    if (/\.pdf$/.test(lower)) return 'application/pdf';
    if (/\.png$/.test(lower)) return 'image/png';
    if (/\.jpe?g$/.test(lower)) return 'image/jpeg';
    if (/\.gif$/.test(lower)) return 'image/gif';
    if (/\.webp$/.test(lower)) return 'image/webp';
    return 'application/octet-stream';
  }

  function decodeNotionBase64(fileBase64) {
    var cleaned = String(fileBase64 || '').replace(/\s+/g, '');
    var binary = atob(cleaned);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function buildFileFromPlan(entry) {
    var fileName = String(entry.fileName || 'attachment.txt').trim() || 'attachment.txt';
    var hasBase64 = entry.fileBase64 != null && String(entry.fileBase64).trim().length > 0;
    var mimeType = guessNotionMimeType(fileName);
    if (hasBase64) {
      var bytes = decodeNotionBase64(entry.fileBase64);
      return new File([bytes], fileName, { type: mimeType });
    }
    var content = String(entry.fileContent != null ? entry.fileContent : '');
    return new File([content], fileName, { type: mimeType });
  }

  function setInputFiles(input, files) {
    if (!input || !files || !files.length) return false;
    var dt = new DataTransfer();
    for (var i = 0; i < files.length; i++) dt.items.add(files[i]);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function normalizePageReference(ref) {
    var text = String(ref || '').trim();
    if (!text) return { search: '', title: '', raw: text };
    if (/^https?:\/\//i.test(text) || text.indexOf('notion.so') >= 0 || text.indexOf('notion.com') >= 0) {
      try {
        var urlText = /^https?:\/\//i.test(text) ? text : 'https://' + text.replace(/^\/\//, '');
        var parsed = new URL(urlText);
        var path = decodeURIComponent(parsed.pathname || '');
        var slugMatch = path.match(/\/([^/?#]+?)(?:-[0-9a-f]{32})?$/i);
        var titleFromSlug = slugMatch
          ? slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, function(ch) { return ch.toUpperCase(); })
          : '';
        var uuidMatch = text.replace(/-/g, '').match(/[0-9a-f]{32}/i);
        var search = titleFromSlug || (uuidMatch ? uuidMatch[0] : text);
        return { search: search, title: titleFromSlug || text, raw: text };
      } catch (e) {}
    }
    return { search: text, title: text, raw: text };
  }

  function parsePageReferences(pagesRaw, pageRaw) {
    var refs = [];
    if (pageRaw != null && String(pageRaw).trim()) refs.push(String(pageRaw).trim());
    if (pagesRaw != null && String(pagesRaw).trim()) {
      String(pagesRaw).split(',').forEach(function(part) {
        var trimmed = part.trim();
        if (trimmed) refs.push(trimmed);
      });
    }
    return refs.map(normalizePageReference).filter(function(ref) { return ref.search; });
  }

  function scorePagePickerSurface(el, anchor) {
    if (!el || !isElementVisible(el)) return -1;
    var options = Array.prototype.slice.call(el.querySelectorAll('[role=option]'));
    if (!options.length) return -1;
    if (countSettingsMarkerHits(el) > 0) return -1;

    var score = options.length * 100;
    var hasSearch = !!el.querySelector('input[placeholder="Search…"], input[role=combobox][placeholder*="Search"]');
    if (hasSearch) score += 400;
    if (isInViewport(el)) score += 800;
    else score -= 1500;

    if (anchor) {
      var anchorRect = anchor.getBoundingClientRect();
      var surfaceRect = el.getBoundingClientRect();
      score -= Math.min(Math.abs(surfaceRect.x - anchorRect.x), 400);
      if (Math.abs(surfaceRect.x - anchorRect.x) < 80) score += 300;
    }

    var role = el.getAttribute('role') || '';
    if (role === 'dialog' || role === 'listbox') score += 40;
    return score;
  }

  function findPagePickerSurface(anchor) {
    var candidates = gatherModelPickerSurfaceCandidates(anchor);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var score = scorePagePickerSurface(candidates[i], anchor);
      if (score > bestScore) {
        bestScore = score;
        best = candidates[i];
      }
    }
    if (bestScore >= 0) return best;

    var globalOptions = Array.prototype.slice.call(document.querySelectorAll('[role=option]'));
    if (anchor && globalOptions.length) {
      var anchorRect = anchor.getBoundingClientRect();
      var near = globalOptions.filter(function(el) {
        if (!isElementVisible(el)) return false;
        var r = el.getBoundingClientRect();
        return Math.abs(r.x - anchorRect.x) < 80;
      });
      if (near.length) {
        var parent = near[0].closest('[role=dialog],[role=listbox],[role=menu]');
        if (parent) return parent;
      }
    }
    return null;
  }

  function getComposerRoot() {
    var editor = getChatInput();
    if (!editor) return null;
    var node = editor.parentElement;
    for (var d = 0; d < 12 && node; d++) {
      if (
        node.querySelector &&
        node.querySelector('[aria-label="Submit AI message"]') &&
        node.querySelector('[aria-label="Give context"]') &&
        node.contains(editor)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return editor.parentElement;
  }

  function composerHasAttachmentNeedle(needle) {
    if (!needle) return false;
    var root = getComposerRoot();
    if (!root) return false;
    var haystack = String(root.innerText || root.textContent || '').toLowerCase();
    return haystack.indexOf(String(needle).trim().toLowerCase()) >= 0;
  }

  function getComposerAttachmentLabels() {
    var root = getComposerRoot();
    if (!root) return [];
    var text = String(root.innerText || root.textContent || '');
    var lines = text.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
    var labels = [];
    var seen = {};
    var skipRe = /^(Give context|Settings|Submit AI message|Plan mode|Auto|Personalize|Opus|Sonnet|GPT|Grok|Gemini|Kimi|DeepSeek|Fable)/i;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (skipRe.test(line)) continue;
      if (line.length > 120) continue;
      if (i + 1 < lines.length && /^\.\w+$/.test(lines[i + 1])) {
        var combined = line + lines[i + 1];
        if (!seen[combined]) {
          seen[combined] = true;
          labels.push(combined);
        }
        i++;
        continue;
      }
      if (!seen[line]) {
        seen[line] = true;
        labels.push(line);
      }
    }
    return labels;
  }

  async function waitForComposerAttachments(expected, opts) {
    expected = expected || [];
    if (!expected.length) return { ok: true, labels: [] };
    opts = opts || {};
    var timeout = Number(opts.timeoutMs) || 8000;
    var start = Date.now();
    while (Date.now() - start < timeout) {
      var labels = getComposerAttachmentLabels();
      var allFound = expected.every(function(exp) {
        var needle = String(exp || '').trim();
        if (!needle) return true;
        if (composerHasAttachmentNeedle(needle)) return true;
        return labels.some(function(label) {
          return label.toLowerCase().indexOf(needle.toLowerCase()) >= 0;
        });
      });
      if (allFound) return { ok: true, labels: labels };
      await sleep(250);
    }
    return {
      ok: false,
      error: 'Attachment not ready',
      hint: 'Composer did not show expected attachment chips.',
      expected: expected,
      labels: getComposerAttachmentLabels()
    };
  }

  function parseFilesJsonArg(filesRaw) {
    if (filesRaw == null || filesRaw === '') return { ok: true, files: [] };
    try {
      var parsed = typeof filesRaw === 'string' ? JSON.parse(filesRaw) : filesRaw;
      if (!Array.isArray(parsed)) {
        return { ok: false, error: 'Invalid files argument', hint: 'files must be a JSON array of {fileName, fileContent|fileBase64} objects.' };
      }
      return { ok: true, files: parsed };
    } catch (e) {
      return { ok: false, error: 'Invalid files JSON', hint: 'Could not parse files argument as JSON.' };
    }
  }

  function prepareNotionAttachmentPlan(args) {
    args = args || {};
    var context = args.context != null ? String(args.context).trim() : '';
    var query = String(args.query || '').trim();
    if (context) {
      query = '--- External context ---\n' + context + '\n--- End context ---\n\n' + query;
    }

    var files = [];
    var parsedFiles = parseFilesJsonArg(args.files);
    if (!parsedFiles.ok) return parsedFiles;

    parsedFiles.files.forEach(function(entry) {
      if (!entry || typeof entry !== 'object') return;
      var hasContent = entry.fileContent != null && String(entry.fileContent).length > 0;
      var hasBase64 = entry.fileBase64 != null && String(entry.fileBase64).trim().length > 0;
      if (hasContent || hasBase64) files.push(entry);
    });

    var hasFileContent = args.fileContent != null && String(args.fileContent).length > 0;
    var hasFileBase64 = args.fileBase64 != null && String(args.fileBase64).trim().length > 0;
    if (hasFileContent || hasFileBase64) {
      files.push({
        fileName: String(args.fileName || 'attachment.txt').trim() || 'attachment.txt',
        fileContent: args.fileContent,
        fileBase64: args.fileBase64
      });
    }

    var pages = parsePageReferences(args.pages, args.page);
    var hasAttachments = files.length > 0 || pages.length > 0;

    return {
      query: query,
      files: files,
      pages: pages,
      hasFiles: files.length > 0,
      hasPages: pages.length > 0,
      hasAttachments: hasAttachments,
      hasContext: !!context
    };
  }

  function collectPageOptionsNearAnchor(anchor) {
    if (!anchor) return [];
    var anchorRect = anchor.getBoundingClientRect();
    return Array.prototype.slice.call(document.querySelectorAll('[role=option]')).filter(function(el) {
      if (!isElementVisible(el)) return false;
      var r = el.getBoundingClientRect();
      return Math.abs(r.x - anchorRect.x) < 80;
    });
  }

  function matchPageOption(options, pageRef) {
    var target = normalizeMenuItemTitle(pageRef.title || pageRef.search);
    var exact = [];
    var prefix = [];
    for (var i = 0; i < options.length; i++) {
      var title = readMenuItemFirstLine(options[i]);
      if (title === target) exact.push({ el: options[i], title: title });
      else if (target && title.toLowerCase().indexOf(String(pageRef.search || '').trim().toLowerCase()) >= 0) {
        prefix.push({ el: options[i], title: title });
      } else if (target && title.toLowerCase().indexOf(target.toLowerCase()) === 0) {
        prefix.push({ el: options[i], title: title });
      }
    }
    if (exact.length === 1) return { ok: true, option: exact[0].el, title: exact[0].title };
    if (exact.length > 1) {
      return { ok: false, error: 'Ambiguous page title', hint: 'Multiple pages matched "' + target + '". Use a more specific title.' };
    }
    if (prefix.length === 1) return { ok: true, option: prefix[0].el, title: prefix[0].title };
    if (prefix.length > 1) {
      return { ok: false, error: 'Ambiguous page title', hint: 'Multiple pages matched "' + (pageRef.search || target) + '". Use a more specific title.' };
    }
    return { ok: false, error: 'Page not found', hint: 'Could not find page "' + (pageRef.title || pageRef.search) + '" in the mention picker.' };
  }

  function fillSearchInput(input, value) {
    if (!input) return false;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function uploadFilesViaGiveContext(anchor, fileEntries) {
    if (!fileEntries || !fileEntries.length) return { ok: true, attachments: [] };

    var opened = await ensureGiveContextSurface(anchor);
    if (!opened.ok) return opened;

    var addItem = findGiveContextMenuItem(opened.surface, /^Add photos and files/);
    if (!addItem) {
      closeSettingsSurfaces();
      return { ok: false, error: 'Add photos and files menu item not found' };
    }
    clickElement(addItem);
    await sleep(500);

    var input = document.querySelector('input[type=file]');
    if (!input) {
      closeSettingsSurfaces();
      return { ok: false, error: 'File input not found', hint: 'Notion did not expose a file upload input.' };
    }

    var builtFiles = [];
    var attachmentMeta = [];
    for (var i = 0; i < fileEntries.length; i++) {
      var file = buildFileFromPlan(fileEntries[i]);
      builtFiles.push(file);
      attachmentMeta.push({ type: 'file', fileName: file.name });
    }

    if (!setInputFiles(input, builtFiles)) {
      closeSettingsSurfaces();
      return { ok: false, error: 'File upload failed', hint: 'Could not inject files into the upload input.' };
    }

    await sleep(800);

    var expected = builtFiles.map(function(f) {
      var base = f.name.replace(/\.[^.]+$/, '');
      return base || f.name;
    });
    var ready = await waitForComposerAttachments(expected);
    closeSettingsSurfaces();
    await sleep(150);
    if (!ready.ok) return ready;
    return { ok: true, attachments: attachmentMeta };
  }

  async function mentionPageViaGiveContext(anchor, pageRef) {
    var opened = await ensureGiveContextSurface(anchor);
    if (!opened.ok) return opened;

    var mentionItem = findGiveContextMenuItem(opened.surface, /^Mention pages or people/);
    if (!mentionItem) {
      closeSettingsSurfaces();
      return { ok: false, error: 'Mention pages menu item not found' };
    }
    clickElement(mentionItem);
    await sleep(600);

    var pickerSurface = findPagePickerSurface(opened.anchor);
    var search = document.querySelector('input[placeholder="Search…"], input[role=combobox][placeholder*="Search"]');
    if (search && pageRef.search) {
      fillSearchInput(search, pageRef.search);
      await sleep(700);
    }

    var options = collectPageOptionsNearAnchor(opened.anchor);
    if (!options.length && pickerSurface) {
      options = Array.prototype.slice.call(pickerSurface.querySelectorAll('[role=option]')).filter(isElementVisible);
    }
    var matched = matchPageOption(options, pageRef);
    if (!matched.ok) {
      closeSettingsSurfaces();
      return matched;
    }

    clickElement(matched.option);
    await sleep(600);
    var ready = await waitForComposerAttachments([matched.title]);
    closeSettingsSurfaces();
    await sleep(150);
    if (!ready.ok) return ready;
    return { ok: true, attachments: [{ type: 'page', title: matched.title }] };
  }

  async function attachNotionChatContext(plan) {
    plan = plan || {};
    if (!plan.hasAttachments) return { ok: true, attachments: [] };

    var anchor = findGiveContextButton();
    if (!anchor) {
      return {
        ok: false,
        error: 'Give context button not found',
        hint: 'Open Notion AI chat view and ensure the composer is visible.'
      };
    }

    var attachments = [];

    if (plan.hasFiles) {
      var fileResult = await uploadFilesViaGiveContext(anchor, plan.files);
      if (!fileResult.ok) return fileResult;
      attachments = attachments.concat(fileResult.attachments || []);
    }

    if (plan.hasPages) {
      for (var i = 0; i < plan.pages.length; i++) {
        var pageResult = await mentionPageViaGiveContext(anchor, plan.pages[i]);
        if (!pageResult.ok) return pageResult;
        attachments = attachments.concat(pageResult.attachments || []);
      }
    }

    return { ok: true, attachments: attachments };
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
      action: 'bun-browser open https://app.notion.com/ai'
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

  function extractBalancedObject(text, startChar, endChar) {
    if (!text) return '';
    var t = String(text);
    var searchFrom = 0;
    while (searchFrom < t.length) {
      var start = t.indexOf(startChar, searchFrom);
      if (start < 0) return '';
      var slice = t.slice(start);
      try {
        JSON.parse(slice);
        return slice;
      } catch (e) {}
      var depth = 0;
      var inString = false;
      var escape = false;
      var found = '';
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
              found = candidate;
              break;
            } catch (e2) {}
          }
        }
      }
      if (found) return found;
      searchFrom = start + 1;
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

  function parseAnswerJson(answer) {
    var block = extractJsonBlock(answer);
    if (!block) return null;
    try {
      var parsed = JSON.parse(block);
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return null;
    } catch (e) {
      return null;
    }
  }

  function queryExpectsJson(query) {
    var q = String(query || '').toLowerCase();
    if (!q) return false;
    if (/return\s+only\s+(?:valid\s+)?json\b/.test(q)) return true;
    if (/return\s+json\s+only\b/.test(q)) return true;
    if (/respond\s+with\s+only\s+(?:valid\s+)?json\b/.test(q)) return true;
    if (/output\s+only\s+(?:valid\s+)?json\b/.test(q)) return true;
    if (/\breply\s+with\s+only\s+(?:valid\s+)?json\b/.test(q)) return true;
    if (/\bjson\s+format\s+only\b/.test(q)) return true;
    if (/\bin\s+json\s+format\s+only\b/.test(q)) return true;
    if (/\bonly\s+(?:valid\s+)?json\b/.test(q) && /\b(?:return|respond|output|reply)\b/.test(q)) return true;
    if (/\bjson\s+object\b/.test(q) && /\b(?:return|respond|output|reply|valid\s+json)\b/.test(q)) return true;
    return false;
  }

  function jsonOutputExpected(query, opts) {
    opts = opts || {};
    if (opts.expectJson) return true;
    return queryExpectsJson(query);
  }

  function buildJsonAnswerFields(answer, query, opts) {
    if (!jsonOutputExpected(query, opts)) return null;
    var parsed = parseAnswerJson(answer);
    if (!parsed) return null;
    var compact = JSON.stringify(parsed);
    var raw = String(answer || '').trim();
    var out = {
      answer: compact,
      answerJson: parsed,
      answerFormat: 'json'
    };
    if (raw !== compact) out.jsonRecovered = true;
    return out;
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
    isUrlTrustPromptVisible: isUrlTrustPromptVisible,
    isUrlTrustPromptContext: isUrlTrustPromptContext,
    getUrlTrustPromptInfo: getUrlTrustPromptInfo,
    acceptUrlTrustPrompt: acceptUrlTrustPrompt,
    drainUrlTrustPrompts: drainUrlTrustPrompts,
    getLastUrlTrustAccepts: getLastUrlTrustAccepts,
    resetUrlTrustState: resetUrlTrustState,
    matchCreditsExhausted: matchCreditsExhausted,
    matchRateLimit: matchRateLimit,
    matchPromptRejected: matchPromptRejected,
    getAbnormalDetectionText: getAbnormalDetectionText,
    detectNotionPageAbnormal: detectNotionPageAbnormal,
    openAiChatSidebar: openAiChatSidebar,
    ensureAiLandingPage: ensureAiLandingPage,
    clickNewChat: clickNewChat,
    ensureNewChatView: ensureNewChatView,
    ensureNotionModelListView: ensureNotionModelListView,
    hasNotionChatShell: hasNotionChatShell,
    isStaleChatThread: isStaleChatThread,
    getChatInput: getChatInput,
    focusChatInput: focusChatInput,
    setChatInput: setChatInput,
    getSubmitButton: getSubmitButton,
    clickSubmit: clickSubmit,
    getComposerText: getComposerText,
    hasSubmitFlightSignals: hasSubmitFlightSignals,
    waitForSubmitAck: waitForSubmitAck,
    submitChatPrompt: submitChatPrompt,
    getAssistantMessages: getAssistantMessages,
    getAssistantMessagesSinceLastUser: getAssistantMessagesSinceLastUser,
    getAssistantText: getAssistantText,
    findScrollToBottomButton: findScrollToBottomButton,
    clickScrollToBottomButton: clickScrollToBottomButton,
    findChatScrollContainer: findChatScrollContainer,
    scrollChatContainerToBottom: scrollChatContainerToBottom,
    revealLatestReplyInView: revealLatestReplyInView,
    scrollToLatestReply: scrollToLatestReply,
    shouldRunRevealSideEffect: shouldRunRevealSideEffect,
    NOTION_REVEAL_THROTTLE_MS: NOTION_REVEAL_THROTTLE_MS,
    getAssistantTextFromReplyScope: getAssistantTextFromReplyScope,
    getAssistantAnswerSince: getAssistantAnswerSince,
    getCurrentReplyAssistantStartCount: getCurrentReplyAssistantStartCount,
    getChatActivityText: getChatActivityText,
    looksLikeInProgressAnswer: looksLikeInProgressAnswer,
    looksLikeThoughtBlock: looksLikeThoughtBlock,
    REPLY_ACTION_LABELS: REPLY_ACTION_LABELS,
    REPLY_ACTION_REQUIRED: REPLY_ACTION_REQUIRED,
    REPLY_SAVE_SELECTOR: REPLY_SAVE_SELECTOR,
    findUnifiedReplySaveButton: findUnifiedReplySaveButton,
    findReplyActionButton: findReplyActionButton,
    getLatestAssistantReplyScope: getLatestAssistantReplyScope,
    isReplyFinishBlocked: isReplyFinishBlocked,
    hasCompletedReplyActions: hasCompletedReplyActions,
    hasCompletedReplyActionsForTurn: hasCompletedReplyActionsForTurn,
    hasNewTurnContent: hasNewTurnContent,
    hasAssistantReplyActions: hasAssistantReplyActions,
    isGenerating: isGenerating,
    isGeneratingForTurn: isGeneratingForTurn,
    isChatInProgress: isChatInProgress,
    looksLikeFinalAnswer: looksLikeFinalAnswer,
    wasLastWaitPending: wasLastWaitPending,
    wasLastWaitIncompleteJsonStuck: wasLastWaitIncompleteJsonStuck,
    wasLastWaitIncompleteJsonFailed: wasLastWaitIncompleteJsonFailed,
    wasLastWaitSingleCharFailed: wasLastWaitSingleCharFailed,
    INCOMPLETE_JSON_STUCK_MS: INCOMPLETE_JSON_STUCK_MS,
    isOpusMode: isOpusMode,
    isPremiumFallbackModel: isPremiumFallbackModel,
    isSingleCharModelResponse: isSingleCharModelResponse,
    getModelFallbackTriggerReason: getModelFallbackTriggerReason,
    resolveModelFallbackTarget: resolveModelFallbackTarget,
    shouldModelFallbackOnJsonStuck: shouldModelFallbackOnJsonStuck,
    shouldModelFallbackOnIncompleteJson: shouldModelFallbackOnIncompleteJson,
    shouldModelFallbackOnSingleCharFailed: shouldModelFallbackOnSingleCharFailed,
    shouldRetryModelFallback: shouldRetryModelFallback,
    rejectSingleCharFailedAnswer: rejectSingleCharFailedAnswer,
    rejectIncompleteJsonFailedAnswer: rejectIncompleteJsonFailedAnswer,
    isIncompleteJsonFailedAnswer: isIncompleteJsonFailedAnswer,
    jsonOutputExpected: jsonOutputExpected,
    getLastWaitAbnormal: getLastWaitAbnormal,
    getTabCaptureState: getTabCaptureState,
    getLastCaptureWarning: getLastCaptureWarning,
    buildWaitOpts: buildWaitOpts,
    tryExtractCompletedAnswer: tryExtractCompletedAnswer,
    recoverCompletedAnswer: recoverCompletedAnswer,
    waitForAssistantAnswer: waitForAssistantAnswer,
    modelTitleToId: modelTitleToId,
    isModelTitleMapped: isModelTitleMapped,
    isLikelyModelMenuTitle: isLikelyModelMenuTitle,
    findModelPickerButton: findModelPickerButton,
    blurModelPicker: blurModelPicker,
    isModelPickerMenuOpen: isModelPickerMenuOpen,
    closeModelPickerSurface: closeModelPickerSurface,
    findModelPickerSurface: findModelPickerSurface,
    scoreModelPickerSurface: scoreModelPickerSurface,
    normalizeMenuItemTitle: normalizeMenuItemTitle,
    readModelMenuItemTitle: readModelMenuItemTitle,
    findModelMenuItem: findModelMenuItem,
    readNotionModeLabel: readNotionModeLabel,
    resolveNotionMode: resolveNotionMode,
    listNotionModelsFromUi: listNotionModelsFromUi,
    setNotionMode: setNotionMode,
    MODE_ALIASES: MODE_ALIASES,
    BEHAVIOR_MODE_ALIASES: BEHAVIOR_MODE_ALIASES,
    resolveNotionBehaviorMode: resolveNotionBehaviorMode,
    findSettingsButton: findSettingsButton,
    findBehaviorModeSurface: findBehaviorModeSurface,
    scoreBehaviorModeSurface: scoreBehaviorModeSurface,
    listNotionBehaviorModesFromUi: listNotionBehaviorModesFromUi,
    setNotionBehaviorMode: setNotionBehaviorMode,
    GIVE_CONTEXT_MARKERS: GIVE_CONTEXT_MARKERS,
    SETTINGS_MENU_MARKERS: SETTINGS_MENU_MARKERS,
    findGiveContextButton: findGiveContextButton,
    scoreGiveContextButton: scoreGiveContextButton,
    scoreGiveContextSurface: scoreGiveContextSurface,
    findGiveContextSurface: findGiveContextSurface,
    scorePagePickerSurface: scorePagePickerSurface,
    findPagePickerSurface: findPagePickerSurface,
    parsePageReferences: parsePageReferences,
    normalizePageReference: normalizePageReference,
    prepareNotionAttachmentPlan: prepareNotionAttachmentPlan,
    attachNotionChatContext: attachNotionChatContext,
    getComposerAttachmentLabels: getComposerAttachmentLabels,
    composerHasAttachmentNeedle: composerHasAttachmentNeedle,
    waitForComposerAttachments: waitForComposerAttachments,
    decodeNotionBase64: decodeNotionBase64,
    guessNotionMimeType: guessNotionMimeType,
    fetchInferenceTranscripts: fetchInferenceTranscripts,
    scrapeSidebarChats: scrapeSidebarChats,
    navigateToConversation: navigateToConversation,
    extractJsonBlock: extractJsonBlock,
    parseAnswerJson: parseAnswerJson,
    looksLikeJsonAnswerAttempt: looksLikeJsonAnswerAttempt,
    hasParsedJsonAnswer: hasParsedJsonAnswer,
    queryExpectsJson: queryExpectsJson,
    buildJsonAnswerFields: buildJsonAnswerFields,
    readResponseError: readResponseError
  };

  globalThis.__notionAiChatHelpers = api;
  return api;
  })();

  function attachCaptureWarning(obj, isFailure) {
    var capWarn = h.getLastCaptureWarning();
    if (!capWarn || !obj) return obj;
    if (isFailure) {
      obj.hint = obj.hint ? (obj.hint + ' ' + capWarn) : capWarn;
    } else {
      obj.captureWarning = capWarn;
    }
    return obj;
  }

  h.resetUrlTrustState();
  var waitOpts = h.buildWaitOpts(args);
  var waitOnly = pickBoolArg(args, 'waitOnly', 4, false);
  var newChat = pickBoolArg(args, 'newChat', 2, true);
  var modeId = h.resolveNotionMode(pickArg(args, 'model', 1, 'auto') || 'auto');

  var accessBlock = h.detectNotionPageAbnormal({ skipSubmitCheck: waitOnly || selectOnly });
  if (accessBlock) return accessBlock;
  await h.drainUrlTrustPrompts();
  var allowBusyTab = pickBoolArg(args, 'allowBusyTab', -1, false);
  if (newChat && !waitOnly && !allowBusyTab && h.isChatInProgress()) {
    return {
      error: 'Tab busy',
      kind: 'chat_in_progress',
      hint: 'This Notion tab is still generating a reply. Open a fresh tab for a new prompt instead of restarting this one.',
      action: 'bun-browser open https://app.notion.com/ai --tab new',
      conversationId: h.getConversationId(),
      generating: true
    };
  }

  if (selectOnly) {
    if (newChat) {
      var selectNav = await h.ensureNewChatView();
      if (!selectNav.ok) {
        if (selectNav.needsRetry) {
          return {
            error: selectNav.error || 'Navigation required',
            hint: selectNav.hint || 'Re-run the same command after Notion finishes loading.',
            action: selectNav.action || 'retry same command'
          };
        }
        return selectNav;
      }
    }
    if (!h.getChatInput()) {
      return {
        error: 'Chat input not found',
        hint: 'Notion AI chat view did not load. Open the sidebar Chat tab and retry.',
        action: 'bun-browser open https://app.notion.com/ai'
      };
    }
    var selectResult = await h.setNotionMode(modeId);
    if (!selectResult.ok) {
      return {
        error: 'Mode selection failed',
        hint: selectResult.hint || selectResult.error || ('Could not select model "' + modeId + '"'),
        requestedMode: modeId,
        action: 'bun-browser site notion/models'
      };
    }
    return {
      model: modeId,
      modeTitle: selectResult.modeTitle || null,
      modeLabel: selectResult.label || h.readNotionModeLabel(),
      selected: true,
      selectOnly: true,
      conversationId: h.getConversationId()
    };
  }

  if (waitOnly) {
    waitOpts.query = queryTextArg || args.query;
  await h.drainUrlTrustPrompts();
    var existing = h.getAssistantMessages();
    var pollBeforeCount = h.getCurrentReplyAssistantStartCount();
    var pollBeforeText = pollBeforeCount < existing.length ? h.getAssistantText(existing[pollBeforeCount]) : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      waitedAnswer = h.recoverCompletedAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    }
    if (waitedAnswer) {
      waitedAnswer = h.rejectIncompleteJsonFailedAnswer(waitedAnswer, waitOpts);
    }
    if (!waitedAnswer) {
      if (h.wasLastWaitPending()) {
        return attachCaptureWarning({ error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' }, true);
      }
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      return attachCaptureWarning({ error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' }, true);
    }
    var waitOut = {
      query: queryTextArg || args.query,
      model: modeId,
      modeLabel: h.readNotionModeLabel(),
      answer: waitedAnswer,
      conversationId: h.getConversationId(),
      waitOnly: true
    };
    var waitTrust = h.getLastUrlTrustAccepts();
    if (waitTrust.length) waitOut.urlTrustAccepted = waitTrust;
    var waitQuery = queryTextArg || args.query;
    var waitJsonFields = h.buildJsonAnswerFields(waitedAnswer, waitQuery, waitOpts);
    if (waitJsonFields) {
      if (waitJsonFields.answer != null) waitOut.answer = waitJsonFields.answer;
      waitOut.answerJson = waitJsonFields.answerJson;
      waitOut.answerFormat = waitJsonFields.answerFormat;
      if (waitJsonFields.jsonRecovered) waitOut.jsonRecovered = true;
    } else {
      var waitJson = h.parseAnswerJson(waitedAnswer);
      if (waitJson) { waitOut.answerJson = waitJson; waitOut.answerFormat = 'json'; }
    }
    return attachCaptureWarning(waitOut, false);
  }

  if (newChat) {
    var nav = await h.ensureNewChatView();
    if (!nav.ok) {
      if (nav.needsRetry) {
        return {
          error: nav.error || 'Navigation required',
          hint: nav.hint || 'Re-run the same command after Notion finishes loading.',
          action: nav.action || 'retry same command'
        };
      }
      return nav;
    }
  await h.drainUrlTrustPrompts();
  }

  if (newChat && h.isStaleChatThread()) {
    var reclear = await h.ensureNewChatView();
    if (!reclear.ok) {
      if (reclear.needsRetry) {
        return {
          error: reclear.error || 'Navigation required',
          hint: reclear.hint || 'Re-run the same command after Notion finishes loading.',
          action: reclear.action || 'retry same command'
        };
      }
      return reclear;
    }
  }

  if (newChat && h.isStaleChatThread()) {
    return {
      error: 'Stale chat thread still visible',
      kind: 'stale_thread',
      hint: 'Notion did not clear the prior reply before submit. Open a new tab and retry.',
      action: 'bun-browser open https://app.notion.com/ai --tab new'
    };
  }

  if (!h.getChatInput()) {
    return {
      error: 'Chat input not found',
      hint: 'Notion AI chat view did not load. Open the sidebar Chat tab and retry.',
      action: 'bun-browser open https://app.notion.com/ai'
    };
  }

  var modeResult = await h.setNotionMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.hint || modeResult.error || ('Could not select model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site notion/models'
    };
  }
  waitOpts.mode = modeId;
  await h.drainUrlTrustPrompts();

  var attachPlan = h.prepareNotionAttachmentPlan(args);
  if (attachPlan.error) {
    return { error: attachPlan.error, hint: attachPlan.hint || attachPlan.error };
  }
  var attachedItems = null;
  if (attachPlan.hasAttachments) {
    var attachResult = await h.attachNotionChatContext(attachPlan);
    if (!attachResult.ok) {
      return {
        error: 'Attachment failed',
        hint: attachResult.hint || attachResult.error,
        requestedAttachments: attachPlan
      };
    }
    attachedItems = attachResult.attachments || null;
  }
  var queryText = attachPlan.query || args.query;


  var beforeCount = h.getAssistantMessagesSinceLastUser().length;
  var beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\n');

  var submitResult = await h.submitChatPrompt(queryText, beforeCount, beforeText, waitOpts);
  if (!submitResult.ok) {
    if (submitResult.kind) return submitResult;
    return {
      error: submitResult.error || 'Submit failed',
      hint: submitResult.hint || 'Could not submit the Notion AI prompt.',
      action: submitResult.action || 'bun-browser open https://app.notion.com/ai'
    };
  }
  await h.drainUrlTrustPrompts();

  waitOpts.query = queryText;
  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
  if (!answer) {
    answer = h.recoverCompletedAnswer(beforeCount, beforeText, waitOpts);
  }
  if (answer) {
    answer = h.rejectIncompleteJsonFailedAnswer(answer, waitOpts);
  }
  var modelFallbackMeta = null;
  if (!answer && h.shouldRetryModelFallback(modeId, queryText, waitOpts)) {
    var fallbackReason = h.getModelFallbackTriggerReason();
    var fallbackFromMode = modeId;
    var fallbackFromTitle = modeResult.modeTitle || modeResult.label || modeId;
    var fallbackTo = h.resolveModelFallbackTarget(modeId, waitOpts);
    var fallbackNav = await h.ensureNewChatView();
    if (!fallbackNav.ok) {
      if (fallbackNav.needsRetry) {
        return {
          error: fallbackNav.error || 'Navigation required',
          hint: fallbackNav.hint || 'Re-run the same command after Notion finishes loading.',
          action: fallbackNav.action || 'retry same command'
        };
      }
      return fallbackNav;
    }
    var fallbackModeResult = await h.setNotionMode(fallbackTo);
    if (!fallbackModeResult.ok) {
      var fallbackFailMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason,
        failed: true
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        fallbackFailMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
      return {
        error: 'Mode selection failed',
        hint: fallbackModeResult.hint || fallbackModeResult.error || ('Could not select fallback model "' + fallbackTo + '"'),
        requestedMode: fallbackTo,
        modelFallback: fallbackFailMeta,
        action: 'bun-browser site notion/models'
      };
    }
    modeId = fallbackTo;
    modeResult = fallbackModeResult;
    waitOpts.mode = modeId;
    beforeCount = h.getAssistantMessagesSinceLastUser().length;
    beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\n');
    submitResult = await h.submitChatPrompt(queryText, beforeCount, beforeText, waitOpts);
    if (!submitResult.ok) {
      if (submitResult.kind) return submitResult;
      var fallbackSubmitMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason,
        submitFailed: true
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        fallbackSubmitMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
      return {
        error: submitResult.error || 'Submit failed',
        hint: submitResult.hint || 'Could not resubmit after model fallback.',
        action: submitResult.action || 'bun-browser open https://app.notion.com/ai',
        modelFallback: fallbackSubmitMeta
      };
    }
    answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
    if (!answer) {
      answer = h.recoverCompletedAnswer(beforeCount, beforeText, waitOpts);
    }
    if (answer) {
      modelFallbackMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        modelFallbackMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
    }
  }
  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    if (h.wasLastWaitPending()) {
      return attachCaptureWarning({ error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' }, true);
    }
    return attachCaptureWarning({ error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' }, true);
  }

  var out = {
    query: queryText,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readNotionModeLabel(),
    answer: answer,
    conversationId: h.getConversationId()
  };
  if (attachedItems) out.attachments = attachedItems;
  var trustAccepted = h.getLastUrlTrustAccepts();
  if (trustAccepted.length) out.urlTrustAccepted = trustAccepted;
  var jsonFields = h.buildJsonAnswerFields(answer, queryText, waitOpts);
  if (jsonFields) {
    if (jsonFields.answer != null) out.answer = jsonFields.answer;
    out.answerJson = jsonFields.answerJson;
    out.answerFormat = jsonFields.answerFormat;
    if (jsonFields.jsonRecovered) out.jsonRecovered = true;
  } else {
    var answerJson = h.parseAnswerJson(answer);
    if (answerJson) { out.answerJson = answerJson; out.answerFormat = 'json'; }
  }
  if (modelFallbackMeta) out.modelFallback = modelFallbackMeta;
  return attachCaptureWarning(out, false);
}
