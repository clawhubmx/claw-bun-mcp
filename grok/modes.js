/* @meta
{
  "name": "grok/modes",
  "description": "查看 Grok 可用模式 (modes: available, id, title, requiresUpgrade)",
  "domain": "grok.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/modes"
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

  const resp = await fetch('/rest/modes', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: '{}'
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
      hint: '无法获取 Grok 模式列表，请确认已登录 grok.com',
      action: 'bun-browser open https://grok.com/'
    };
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return {
      error: 'Invalid JSON response',
      hint: 'Grok /rest/modes 返回格式异常，请刷新页面后重试',
      action: 'bun-browser open https://grok.com/'
    };
  }

  const KNOWN_MODES = ['fast', 'auto', 'expert', 'heavy', 'beta'];
  const byId = {};
  for (const m of (data.modes || [])) {
    byId[m.id] = m;
  }

  const modes = KNOWN_MODES.map(function(id) {
    const m = byId[id];
    if (!m) {
      return {
        id: id,
        title: id.charAt(0).toUpperCase() + id.slice(1),
        description: null,
        available: false,
        requiresUpgrade: null,
        listed: false
      };
    }
    const upgrade = m.availability && m.availability.requiresUpgrade;
    const available = !!(m.availability && m.availability.available);
    return {
      id: m.id,
      title: m.title,
      description: m.description || null,
      available: available,
      requiresUpgrade: upgrade ? upgrade.minimumSubscriptionTier : null,
      listed: true
    };
  });

  for (const m of (data.modes || [])) {
    if (KNOWN_MODES.indexOf(m.id) >= 0) continue;
    const upgrade = m.availability && m.availability.requiresUpgrade;
    const available = !!(m.availability && m.availability.available);
    modes.push({
      id: m.id,
      title: m.title,
      description: m.description || null,
      available: available,
      requiresUpgrade: upgrade ? upgrade.minimumSubscriptionTier : null,
      listed: true
    });
  }

  const available = modes.filter(function(m) { return m.available; }).map(function(m) { return m.id; });

  return {
    defaultModeId: data.defaultModeId || null,
    available: available,
    modes: modes
  };
}
