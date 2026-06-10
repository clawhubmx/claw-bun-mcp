/* @meta
{
  "name": "notion/health",
  "description": "Check Notion AI access: login, sidebar chat, submit state, API reachability",
  "domain": "app.notion.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/health"
}
*/

async function(args) {
  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  if (!hasCookie('notion_user_id') || !hasCookie('notion_users')) {
    return {
      ok: false,
      error: 'Not logged in',
      hint: 'Log into Notion at app.notion.com before using Notion AI commands',
      action: 'bun-browser open https://www.notion.so/'
    };
  }

  var h = globalThis.__notionAiChatHelpers;
  if (!h || !h.openAiChatSidebar) {
    h = (function installNotionAiChatHelpers() {
      // minimal bootstrap when chat helpers were not installed yet
      function parseStoredJsonValue(raw) {
        if (!raw) return null;
        try {
          var parsed = JSON.parse(raw);
          return parsed && parsed.value != null ? parsed.value : parsed;
        } catch (e) { return raw; }
      }
      function getSpaceId() {
        var raw = localStorage.getItem('LRU:KeyValueStore2:lastVisitedRouteSpaceId');
        var value = parseStoredJsonValue(raw);
        if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) return value;
        return null;
      }
      function findByAriaLabel(label) {
        var target = String(label || '').trim().toLowerCase();
        var els = Array.prototype.slice.call(document.querySelectorAll('[aria-label], [role=tab], [role=button], button'));
        for (var i = 0; i < els.length; i++) {
          if ((els[i].getAttribute('aria-label') || '').trim().toLowerCase() === target) return els[i];
        }
        return null;
      }
      return {
        getSpaceId: getSpaceId,
        findByAriaLabel: findByAriaLabel,
        openAiChatSidebar: async function() {
          var chatTab = findByAriaLabel('Chat');
          if (!chatTab) return { ok: false, error: 'AI chat sidebar not found' };
          chatTab.click();
          await new Promise(function(r) { setTimeout(r, 700); });
          return { ok: true };
        },
        getChatInput: function() {
          return document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"].content-editable-leaf-rtl');
        },
        getSubmitButton: function() {
          return findByAriaLabel('Submit AI message');
        },
        fetchInferenceTranscripts: async function(limit) {
          var spaceId = getSpaceId();
          if (!spaceId) return { ok: false, error: 'Space id not found' };
          var resp = await fetch('/api/v3/getInferenceTranscriptsForUser', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              threadParentPointer: { table: 'space', id: spaceId, spaceId: spaceId },
              limit: limit || 5,
              includeWriterChats: false
            })
          });
          if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
          return { ok: true, data: await resp.json() };
        }
      };
    })();
  } else if (h.version !== 1) {
    h = globalThis.__notionAiChatHelpers;
  }

  var chatTab = document.querySelector('[role=tab][aria-label="Chat"], .notion-ai-button');
  if (!chatTab && !document.querySelector('.notion-ai-button')) {
    return {
      ok: false,
      error: 'AI chat sidebar not found',
      kind: 'sidebar_missing',
      hint: 'This workspace may have AI disabled or uses a layout without the Chat sidebar tab.',
      action: 'bun-browser open https://app.notion.com/',
      login: true
    };
  }

  var sidebar = await h.openAiChatSidebar();
  if (!sidebar.ok) {
    sidebar.ok = false;
    sidebar.login = true;
    return sidebar;
  }

  var chatInput = !!h.getChatInput();
  var submitBtn = h.getSubmitButton ? h.getSubmitButton() : null;
  var submitEnabled = !!(submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true');
  var inputHasText = false;
  if (h.getChatInput) {
    var editor = h.getChatInput();
    inputHasText = !!(editor && String(editor.innerText || editor.textContent || '').trim());
  }

  if (submitBtn && !submitEnabled && inputHasText) {
    return {
      ok: false,
      error: 'Chat submission blocked',
      kind: 'submit_disabled',
      hint: 'Send button is disabled — often due to rate limits or missing AI credits.',
      action: 'bun-browser open https://app.notion.com/',
      login: true,
      chatInput: chatInput,
      submitEnabled: false
    };
  }

  var api = await h.fetchInferenceTranscripts(5);
  var apiReachable = !!api.ok;

  return {
    ok: true,
    login: true,
    chatTab: true,
    chatInput: chatInput,
    submitEnabled: submitEnabled,
    apiReachable: apiReachable,
    spaceId: h.getSpaceId ? h.getSpaceId() : null,
    transcriptCount: api.ok && api.data && api.data.transcripts ? api.data.transcripts.length : 0,
    action: chatInput ? null : 'bun-browser site notion/chat "hello"'
  };
}
