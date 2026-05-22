/* @meta
{
  "name": "grok/chat",
  "description": "向 Grok 提问 (AI chat: answer, model, conversationId)",
  "domain": "grok.com",
  "args": {
    "query": {"required": true, "description": "Prompt to send to Grok"},
    "model": {"required": false, "description": "Model mode: fast, auto, or expert (default fast)"},
    "disableSearch": {"required": false, "description": "Disable Grok web search (default false)"},
    "newChat": {"required": false, "description": "Start a new chat thread (default true)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site grok/chat \"Explain quantum computing in one paragraph\""
}
*/

async function(args) {
  if (!args.query) {
    return {error: 'Missing argument: query', hint: 'Provide a prompt for Grok'};
  }

  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  const loggedIn = hasCookie('sso') || hasCookie('x-userid');
  if (!loggedIn) {
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

  const modeMap = {
    fast: 'fast',
    auto: 'auto',
    expert: 'expert',
    'grok-3': 'fast',
    'grok-4': 'expert'
  };
  const modeId = modeMap[(args.model || 'fast').toLowerCase()] || 'fast';
  const startNewChat = args.newChat !== false;

  if (startNewChat) {
    var newChat = document.querySelector('[data-testid="new-chat"]');
    if (newChat) {
      newChat.click();
      await sleep(1200);
    } else if (location.pathname.indexOf('/c/') === 0) {
      location.href = 'https://grok.com/';
      await sleep(1500);
    }
  }

  if (!document.querySelector('[data-testid="chat-input"]')) {
    return {
      error: 'Chat input not found',
      hint: 'Grok 页面未加载完成，请刷新 grok.com 后重试',
      action: 'bun-browser open https://grok.com/'
    };
  }

  var beforeCount = getAssistantMessages().length;
  var beforeText = getAssistantMessages().map(getAssistantText).join('\n');

  if (!setChatInput(args.query)) {
    return {
      error: 'Chat input not found',
      hint: 'Grok 页面未加载完成，请刷新 grok.com 后重试',
      action: 'bun-browser open https://grok.com/'
    };
  }
  await sleep(400);

  if (!clickSubmit()) {
    return {
      error: 'Submit button not found',
      hint: '无法在 Grok 页面找到发送按钮，请刷新页面后重试',
      action: 'bun-browser open https://grok.com/'
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
      action: 'bun-browser open https://grok.com/'
    };
  }

  var out = {
    query: args.query,
    model: modeId,
    answer: answer,
    conversationId: getConversationId()
  };
  if (args.disableSearch === true) out.disableSearch = true;
  return out;
}
