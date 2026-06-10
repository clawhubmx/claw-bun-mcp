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
  var labels = root.querySelectorAll('[aria-label]');
  var hasCopyResponse = false;
  var hasFeedback = false;
  for (var i = 0; i < labels.length; i++) {
    var label = (labels[i].getAttribute('aria-label') || '').trim().toLowerCase();
    if (label === 'copy response') hasCopyResponse = true;
    if (label === 'share positive feedback' || label === 'share negative feedback') hasFeedback = true;
  }
  if (hasCopyResponse && hasFeedback) {
    return { busy: false, loggedIn: true, helpersLoaded: false, url: location.href };
  }

  var text = (root.innerText || root.textContent || '').slice(-5000);
  if (/Notion AI finished/i.test(text)) {
    return { busy: false, loggedIn: true, helpersLoaded: false, url: location.href };
  }
  var lines = text.split('\n').slice(-30);
  var busy = false;
  for (var j = 0; j < lines.length; j++) {
    var line = String(lines[j] || '').trim();
    if (!line) continue;
    if (/^Notion AI finished\.?$/i.test(line)) continue;
    if (/^(Searching|Reading|Browsing|Fetching|Thinking|Running|Exploring|Computing|Thought|Searching the web|Reading files|Running tool|Generating|Writing file|Loading web page|Loaded web page|Called function|Searched the web|Browsing|Fetching top|Fetching recent|\d+s)\b/i.test(line)) {
      busy = true;
      break;
    }
  }
  return { busy: busy, loggedIn: true, helpersLoaded: false, url: location.href };
}
