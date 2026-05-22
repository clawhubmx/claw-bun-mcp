/* @meta
{
  "name": "grok/agent-chat",
  "description": "在 Grok Project Agent 中提问 (agent chat: agentId, query, answer, agentName, url)",
  "domain": "grok.com",
  "args": {
    "agent": {"required": true, "description": "Agent id or project URL from grok/agents (e.g. 2262a42d-... or https://grok.com/project/2262a42d-...)"},
    "query": {"required": true, "description": "Prompt to send to the agent"},
    "model": {"required": false, "description": "Model mode: fast, auto, or expert (default fast)"},
    "disableSearch": {"required": false, "description": "Disable Grok web search (default false)"},
    "newChat": {"required": false, "description": "Start a new chat in the project (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/agent-chat 2262a42d-da6b-478d-843f-69f811626817 \"my dream is becoming a doctor\""
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

  function parseAgentId(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    var fromPath = text.match(/\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (fromPath) return fromPath[1].toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      return text.toLowerCase();
    }
    return null;
  }

  if (!args.agent) {
    return {
      error: 'Missing argument: agent',
      hint: 'Provide an agent id or project URL from bun-browser site grok/agents',
      action: 'bun-browser site grok/agents'
    };
  }

  if (!args.query) {
    return {
      error: 'Missing argument: query',
      hint: 'Provide a prompt for the agent'
    };
  }

  var agentId = parseAgentId(args.agent);
  if (!agentId) {
    return {
      error: 'Invalid agent id',
      hint: 'agent 必须是 UUID 或 https://grok.com/project/{id} 格式的 URL',
      action: 'bun-browser site grok/agents'
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

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function getAssistantMessages() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-testid="assistant-message"]'));
  }

  function getAssistantText(el) {
    if (!el) return '';
    return el.innerText.replace(/^Thought for \d+s\n+/i, '').trim();
  }

  function getConversationId() {
    var match = location.pathname.match(/\/c\/([^/?]+)/);
    return match ? match[1] : null;
  }

  function getAgentNameFromTitle() {
    var title = (document.title || '').replace(/\s*-\s*Grok\s*$/i, '').trim();
    return title || null;
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

  var agentUrl = 'https://grok.com/project/' + agentId;
  var projectPath = '/project/' + agentId;

  var verifyResp = await fetch('/rest/workspaces/' + agentId, {
    method: 'GET',
    credentials: 'include'
  });

  if (verifyResp.status === 404) {
    return {
      error: 'Agent not found',
      hint: '该 agent id 不存在或无权访问，请用 grok/agents 查看可用列表',
      action: 'bun-browser site grok/agents'
    };
  }

  if (!verifyResp.ok) {
    var verifyErr = '';
    try { verifyErr = await verifyResp.text(); } catch (e) {}
    if (verifyResp.status === 403 || verifyErr.includes('anti-bot')) {
      return {
        error: 'Anti-bot verification required',
        hint: 'Grok 拒绝了请求，请在浏览器中打开 grok.com 完成验证并登录',
        action: 'bun-browser open https://grok.com/'
      };
    }
    return {
      error: 'HTTP ' + verifyResp.status,
      hint: '无法验证 agent，请确认已登录 grok.com',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var workspace;
  try {
    workspace = await verifyResp.json();
  } catch (e) {
    workspace = null;
  }

  if (location.pathname !== projectPath) {
    location.href = agentUrl;
    await sleep(3500);
  }

  var chatReady = false;
  for (var wait = 0; wait < 20; wait++) {
    if (document.querySelector('[data-testid="chat-input"]')) {
      chatReady = true;
      break;
    }
    await sleep(500);
  }

  if (!chatReady) {
    return {
      error: 'Chat input not found',
      hint: 'Agent 页面未加载完成，请稍后重试',
      action: 'bun-browser open ' + agentUrl
    };
  }

  var modeMap = {
    fast: 'fast',
    auto: 'auto',
    expert: 'expert',
    'grok-3': 'fast',
    'grok-4': 'expert'
  };
  var modeId = modeMap[(args.model || 'fast').toLowerCase()] || 'fast';
  var startNewChat = parseBool(args.newChat, false);

  if (startNewChat) {
    var newChat = document.querySelector('[data-testid="new-chat"]');
    if (newChat) {
      newChat.click();
      await sleep(1200);
    }
  }

  var beforeCount = getAssistantMessages().length;
  var beforeText = getAssistantMessages().map(getAssistantText).join('\n');

  if (!setChatInput(args.query)) {
    return {
      error: 'Chat input not found',
      hint: 'Agent 页面未加载完成，请刷新后重试',
      action: 'bun-browser open ' + agentUrl
    };
  }
  await sleep(400);

  if (!clickSubmit()) {
    return {
      error: 'Submit button not found',
      hint: '无法在 Agent 页面找到发送按钮，请刷新页面后重试',
      action: 'bun-browser open ' + agentUrl
    };
  }

  var answer = '';
  var stableRounds = 0;
  var lastText = '';

  for (var i = 0; i < 50; i++) {
    await sleep(500);
    var messages = getAssistantMessages();
    var latest = messages[messages.length - 1];
    answer = getAssistantText(latest);

    if (messages.length > beforeCount && answer.length > 0) {
      if (answer === lastText) stableRounds++;
      else stableRounds = 0;
      lastText = answer;

      if (stableRounds >= 2 && answer.length > 10) break;
      if (i > 40 && answer.length > 10) break;
    } else if (messages.length === beforeCount && answer && answer !== beforeText && answer.length > 10) {
      if (answer === lastText) stableRounds++;
      else stableRounds = 0;
      lastText = answer;
      if (stableRounds >= 2) break;
    }
  }

  if (!answer) {
    return {
      error: 'Empty response',
      hint: 'Agent 未返回内容，可能仍在生成或页面结构已变化',
      action: 'bun-browser open ' + agentUrl
    };
  }

  var agentName = (workspace && workspace.name && workspace.name.trim()) || getAgentNameFromTitle();

  var out = {
    agentId: agentId,
    agentName: agentName || null,
    url: agentUrl,
    query: args.query,
    model: modeId,
    answer: answer,
    conversationId: getConversationId()
  };
  if (parseBool(args.disableSearch, false)) out.disableSearch = true;
  return out;
}
