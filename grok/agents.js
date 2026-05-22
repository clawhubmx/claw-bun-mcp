/* @meta
{
  "name": "grok/agents",
  "description": "列出 Grok 项目 Agent (agents: id, name, model, icon, url, lastUseTime)",
  "domain": "grok.com",
  "args": {
    "pageSize": {"required": false, "description": "Max projects to fetch (default 100)"},
    "includeShared": {"required": false, "description": "Include shared projects (default false)"},
    "includeEmpty": {"required": false, "description": "Include unnamed empty projects (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/agents"
}
*/

async function(args) {
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

  const pageSize = Math.min(Math.max(parseInt(args.pageSize, 10) || 100, 1), 200);
  const includeShared = args.includeShared === true;
  const includeEmpty = args.includeEmpty === true;
  const query = 'pageSize=' + pageSize + '&orderBy=ORDER_BY_LAST_USE_TIME';

  async function fetchWorkspaces(path) {
    const resp = await fetch(path + '?' + query, {
      method: 'GET',
      credentials: 'include'
    });

    if (!resp.ok) {
      let errText = '';
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
        hint: '无法获取 Grok 项目 Agent 列表，请确认已登录 grok.com',
        action: 'bun-browser open https://grok.com/'
      };
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      return {
        error: 'Invalid JSON response',
        hint: 'Grok /rest/workspaces 返回格式异常，请刷新页面后重试',
        action: 'bun-browser open https://grok.com/'
      };
    }

    return data.workspaces || [];
  }

  const own = await fetchWorkspaces('/rest/workspaces');
  if (own && own.error) return own;

  let shared = [];
  if (includeShared) {
    const sharedResult = await fetchWorkspaces('/rest/workspaces/shared');
    if (sharedResult && sharedResult.error) return sharedResult;
    shared = sharedResult;
  }

  const byId = {};
  for (const ws of own) byId[ws.workspaceId] = ws;
  for (const ws of shared) byId[ws.workspaceId] = ws;

  const agents = Object.keys(byId).map(function(id) {
    const ws = byId[id];
    const name = (ws.name || '').trim();
    const personality = ws.customPersonality || '';
    return {
      id: ws.workspaceId,
      name: name || null,
      icon: ws.icon || null,
      preferredModel: ws.preferredModel || null,
      createTime: ws.createTime || null,
      lastUseTime: ws.lastUseTime || null,
      isPublic: !!ws.isPublic,
      accessLevel: ws.accessLevel || null,
      hasInstructions: personality.length > 0,
      instructionPreview: personality ? personality.slice(0, 120) + (personality.length > 120 ? '...' : '') : null,
      url: 'https://grok.com/project/' + ws.workspaceId
    };
  }).filter(function(agent) {
    if (includeEmpty) return true;
    return !!(agent.name || agent.hasInstructions);
  }).sort(function(a, b) {
    const aTime = a.lastUseTime || a.createTime || '';
    const bTime = b.lastUseTime || b.createTime || '';
    return bTime.localeCompare(aTime);
  });

  return {
    count: agents.length,
    agents: agents
  };
}
