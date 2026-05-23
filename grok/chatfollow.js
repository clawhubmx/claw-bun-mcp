/* @meta
{
  "name": "grok/chatfollow",
  "description": "在已有 Grok 对话中继续提问 (chat follow: conversationId, query, answer, turn)",
  "domain": "grok.com",
  "args": {
    "conversation": {"required": true, "description": "Conversation UUID or https://grok.com/c/{uuid} URL from agent-chat or search"},
    "query": {"required": true, "description": "Follow-up prompt to send in the existing thread"},
    "model": {"required": false, "description": "Model mode: fast, auto, or expert (default fast)"},
    "disableSearch": {"required": false, "description": "Disable Grok web search (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/chatfollow 5c375edc-a6aa-40f5-bc7c-4f2c866c6b36 \"refine the prompt\""
}
*/

async function(args) {
  function parseConversationId(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    var fromPath = text.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (fromPath) return fromPath[1].toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      return text.toLowerCase();
    }
    return null;
  }

  if (!args.conversation) {
    return {
      error: 'Missing argument: conversation',
      hint: 'Provide a conversation id or URL from grok/agent-chat or grok/search',
      action: 'bun-browser site grok/search "keyword"'
    };
  }

  if (!args.query) {
    return {
      error: 'Missing argument: query',
      hint: 'Provide a follow-up prompt for the existing conversation'
    };
  }

  var conversationId = parseConversationId(args.conversation);
  if (!conversationId) {
    return {
      error: 'Invalid conversation id',
      hint: 'conversation 必须是 UUID 或 https://grok.com/c/{id} 格式的 URL',
      action: 'bun-browser site grok/search "keyword"'
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

  function getConversationIdFromPath() {
    var match = location.pathname.match(/\/c\/([^/?]+)/);
    return match ? match[1] : null;
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

  var convPath = '/c/' + conversationId;
  var convUrl = 'https://grok.com' + convPath;

  if (location.pathname !== convPath) {
    location.href = convUrl;
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
      error: 'Conversation not found',
      hint: '对话不存在、无权访问或页面未加载完成，请用 grok/search 确认 conversationId',
      action: 'bun-browser open ' + convUrl
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

  var beforeCount = getAssistantMessages().length;
  var beforeText = getAssistantMessages().map(getAssistantText).join('\n');

  if (!setChatInput(args.query)) {
    return {
      error: 'Chat input not found',
      hint: 'Grok 页面未加载完成，请刷新后重试',
      action: 'bun-browser open ' + convUrl
    };
  }
  await sleep(400);

  if (!clickSubmit()) {
    return {
      error: 'Submit button not found',
      hint: '无法在 Grok 页面找到发送按钮，请刷新页面后重试',
      action: 'bun-browser open ' + convUrl
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
      hint: 'Grok 未返回内容，可能仍在生成或页面结构已变化',
      action: 'bun-browser open ' + convUrl
    };
  }

  var resolvedId = getConversationIdFromPath() || conversationId;
  var out = {
    conversationId: resolvedId,
    url: 'https://grok.com/c/' + resolvedId,
    query: args.query,
    model: modeId,
    answer: answer,
    turn: getAssistantMessages().length
  };
  if (args.disableSearch === true) out.disableSearch = true;
  return out;
}
