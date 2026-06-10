/* @meta
{
  "name": "notion/search",
  "description": "Search Notion AI chat history (history search: query, title, conversationId, url)",
  "domain": "app.notion.com",
  "args": {
    "query": {"required": false, "description": "Keyword to filter chat titles. Omit to list recent threads."},
    "limit": {"required": false, "description": "Max results (default 20, max 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/search \"hello\""
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
      error: 'Not logged in',
      hint: 'Log into Notion at app.notion.com before using Notion AI commands',
      action: 'bun-browser open https://www.notion.so/'
    };
  }

  var h = globalThis.__notionAiChatHelpers;
  if (!h || h.version !== 1) {
    var helpersSource = null;
    h = (function installNotionAiChatHelpers() {
      function hasCookieInner(name) {
        return document.cookie.split(';').some(function(c) {
          return c.trim().startsWith(name + '=');
        });
      }
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
      function normalizeThreadId(raw) {
        if (!raw) return null;
        var text = String(raw).trim();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return text.toLowerCase();
        return text.toLowerCase();
      }
      function buildConversationUrl(conversationId) {
        var id = normalizeThreadId(conversationId);
        if (!id) return null;
        return 'https://app.notion.com/chat?t=' + id.replace(/-/g, '') + '&wfv=chat';
      }
      async function fetchInferenceTranscripts(limit) {
        var spaceId = getSpaceId();
        if (!spaceId) return { ok: false, error: 'Space id not found', hint: 'Open a Notion workspace page first.' };
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
          return { ok: false, error: 'HTTP ' + resp.status, hint: 'Could not load inference transcripts.' };
        }
        return { ok: true, data: await resp.json(), spaceId: spaceId };
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
          items.push({ title: text, conversationId: null, url: null, highlight: text });
        });
        return items;
      }
      return {
        version: 1,
        getSpaceId: getSpaceId,
        buildConversationUrl: buildConversationUrl,
        fetchInferenceTranscripts: fetchInferenceTranscripts,
        scrapeSidebarChats: scrapeSidebarChats,
        openAiChatSidebar: async function() {
          var els = Array.prototype.slice.call(document.querySelectorAll('[role=tab][aria-label="Chat"], .notion-ai-button'));
          if (!els.length) return { ok: false };
          els[0].click();
          await new Promise(function(r) { setTimeout(r, 700); });
          return { ok: true };
        }
      };
    })();
  }

  var searchQuery = args.query != null ? String(args.query).trim() : '';
  var limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50);

  var fetched = await h.fetchInferenceTranscripts(Math.max(limit, 20));
  if (fetched.ok) {
    var transcripts = fetched.data.transcripts || [];
    var results = transcripts.filter(function(item) {
      if (!searchQuery) return true;
      return String(item.title || '').toLowerCase().indexOf(searchQuery.toLowerCase()) >= 0;
    }).slice(0, limit).map(function(item) {
      return {
        title: item.title || '',
        conversationId: item.id,
        url: h.buildConversationUrl(item.id),
        highlight: item.title || '',
        updatedAt: item.updated_at || item.created_at || null,
        type: item.type || null
      };
    });
    return {
      query: searchQuery,
      source: 'api',
      results: results,
      hasMore: !!fetched.data.hasMore,
      spaceId: fetched.spaceId
    };
  }

  await h.openAiChatSidebar();
  var fallback = h.scrapeSidebarChats(searchQuery).slice(0, limit);
  return {
    query: searchQuery,
    source: 'dom',
    results: fallback,
    hasMore: false,
    warning: fetched.error || 'API search unavailable; returned sidebar scrape only'
  };
}
