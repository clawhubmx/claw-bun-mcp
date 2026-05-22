/* @meta
{
  "name": "grok/search",
  "description": "搜索 Grok 对话历史 (history search: query, highlight, title, conversationId, url)",
  "domain": "grok.com",
  "args": {
    "query": {"required": true, "description": "Search keyword in chat history / prompts"},
    "pageSize": {"required": false, "description": "Results per page (default 20, max 60)"},
    "pageToken": {"required": false, "description": "Pagination token from previous search nextPageToken"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/search \"doctor\""
}
*/

async function(args) {
  if (!args.query || !String(args.query).trim()) {
    return {
      error: 'Missing argument: query',
      hint: 'Provide a keyword to search Grok chat history'
    };
  }

  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  if (!hasCookie('sso') && !hasCookie('x-userid')) {
    return {
      error: 'Not logged in',
      hint: '需要先在浏览器中登录 grok.com（X/xAI 账号）',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var searchQuery = String(args.query).trim();
  var pageSize = Math.min(Math.max(parseInt(args.pageSize, 10) || 20, 1), 60);
  var params = 'pageSize=' + pageSize + '&searchQuery=' + encodeURIComponent(searchQuery);
  if (args.pageToken) {
    params += '&pageToken=' + encodeURIComponent(String(args.pageToken));
  }

  var resp = await fetch('/rest/app-chat/conversations?' + params, {
    method: 'GET',
    credentials: 'include'
  });

  if (!resp.ok) {
    var errText = '';
    try { errText = await resp.text(); } catch (e) {}
    if (resp.status === 403 || errText.includes('anti-bot')) {
      return {
        error: 'Anti-bot verification required',
        hint: 'Grok 拒绝了请求，请在浏览器中打开 grok.com 完成验证并登录',
        action: 'bun-browser open https://grok.com/'
      };
    }
    return {
      error: 'HTTP ' + resp.status,
      hint: '无法搜索 Grok 对话历史，请确认已登录 grok.com',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var data;
  try {
    data = await resp.json();
  } catch (e) {
    return {
      error: 'Invalid JSON response',
      hint: 'Grok 搜索接口返回格式异常，请刷新页面后重试',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var matches = data.textSearchMatches || [];
  var results = matches.map(function(match) {
    var conv = match.conversation || {};
    var conversationId = conv.conversationId || null;
    var responseId = match.matchedResponseId || null;
    var url = conversationId ? 'https://grok.com/c/' + conversationId : null;
    if (url && responseId) url += '?rid=' + responseId;

    var projects = (conv.workspaces || []).map(function(ws) {
      var id = ws.workspaceId || ws.id || ws;
      if (typeof id !== 'string') return null;
      return {
        id: id,
        url: 'https://grok.com/project/' + id
      };
    }).filter(Boolean);

    return {
      conversationId: conversationId,
      title: conv.title || null,
      highlight: match.highlight || null,
      matchType: match.matchType || null,
      matchedWords: match.matchedWords || [],
      matchedResponseId: responseId,
      createTime: conv.createTime || null,
      modifyTime: conv.modifyTime || null,
      starred: !!conv.starred,
      projects: projects.length ? projects : undefined,
      url: url
    };
  });

  return {
    query: searchQuery,
    count: results.length,
    nextPageToken: data.nextPageToken || null,
    results: results
  };
}
