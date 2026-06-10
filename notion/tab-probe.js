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

  var text = (document.body && (document.body.innerText || document.body.textContent) || '').slice(-12000);
  if (/Notion AI finished/i.test(text)) {
    return { busy: false, loggedIn: true, helpersLoaded: false, url: location.href };
  }
  var busy = /exploring|computing|thought|thinking|searching|reading files|running tool|generating|writing file|loading web page|loaded web page|called function|searched the web|browsing|fetch(?:ing)? (?:top|recent)/i.test(text);
  return { busy: busy, loggedIn: true, helpersLoaded: false, url: location.href };
}
