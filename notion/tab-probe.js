/* @meta
{
  "name": "notion/tab-probe",
  "description": "Probe whether a Notion tab is busy generating an AI reply",
  "domain": "app.notion.com",
  "args": {},
  "readOnly": true,
  "example": "bun-browser site notion/tab-probe --tab 0"
}
*/

async function(args) {
  function hasCookie(name) {
    return document.cookie.split(';').some(function(c) {
      return c.trim().startsWith(name + '=');
    });
  }

  var REPLY_ACTION_LABELS = [
    'copy response',
    'save to private pages',
    'share positive feedback',
    'share negative feedback'
  ];

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

  function findReplyActionButton(scope, label) {
    if (!scope) return null;
    var want = normalizeReplyActionLabel(label);
    var nodes = scope.querySelectorAll('[aria-label]');
    var fallback = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (normalizeReplyActionLabel(node.getAttribute('aria-label')) !== want) continue;
      if (!node.querySelector('svg')) continue;
      if (isReplyActionElement(node)) return node;
      if (!fallback) fallback = node;
    }
    return fallback;
  }

  function hasCompletedReplyActions(scope) {
    if (!scope) return false;
    for (var k = 0; k < REPLY_ACTION_LABELS.length; k++) {
      if (!findReplyActionButton(scope, REPLY_ACTION_LABELS[k])) return false;
    }
    return true;
  }

  if (!hasCookie('notion_user_id') || !hasCookie('notion_users')) {
    return { busy: false, loggedIn: false, url: location.href };
  }

  var h = globalThis.__notionAiChatHelpers;
  if (h && h.isChatInProgress) {
    return {
      busy: h.isChatInProgress(),
      generating: h.isGenerating ? h.isGenerating() : false,
      conversationId: h.getConversationId ? h.getConversationId() : null,
      loggedIn: true,
      helpersLoaded: true,
      url: location.href
    };
  }

  var root = document.querySelector('.layout-chat') || document.body || document;
  if (hasCompletedReplyActions(root)) {
    return { busy: false, loggedIn: true, helpersLoaded: false, url: location.href };
  }

  var text = (root.innerText || root.textContent || '').slice(-5000);
  var lines = text.split('\n').slice(-30);
  var busy = false;
  for (var j = 0; j < lines.length; j++) {
    var line = String(lines[j] || '').trim();
    if (!line) continue;
    if (/^Notion AI finished\.?$/i.test(line)) continue;
    if (/^(Searching|Reading|Browsing|Fetching|Thinking|Running|Exploring|Computing|Searching the web|Reading files|Running tool|Generating|Writing file|Loading web page|Loaded web page|Called function|Searched the web|Browsing|Fetching top|Fetching recent|Brewing|Focusing|\d+s)\b/i.test(line)) {
      busy = true;
      break;
    }
  }
  return { busy: busy, loggedIn: true, helpersLoaded: false, url: location.href };
}
