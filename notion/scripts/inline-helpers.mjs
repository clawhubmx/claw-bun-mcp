import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "..");
const helpers = readFileSync(join(root, "chat-helpers.js"), "utf8");

function makeFile(meta, body) {
  return meta + "\n\nasync function(args) {\n" + body + "\n}\n";
}

const helperBody = helpers
  .trim()
  .replace(/^\/\*\*[\s\S]*?\*\/\s*/, "")
  .replace(/^function installNotionAiChatHelpers\(\) \{\n?/, "")
  .replace(/\n?\}\s*$/, "");

const installBlock =
  "  var h = (function installNotionAiChatHelpers() {\n" +
  helperBody +
  "\n  })();\n";

const loginBlock = `  var loginBlock = (function() {
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
    return null;
  })();
  if (loginBlock) return loginBlock;

`;

writeFileSync(
  join(root, "chat.js"),
  makeFile(
    `/* @meta
{
  "name": "notion/chat",
  "description": "Ask Notion AI in sidebar chat (AI chat: answer, model, conversationId)",
  "domain": "app.notion.com",
  "args": {
    "query": {"required": false, "description": "Prompt to send to Notion AI (optional when selectOnly is true)"},
    "model": {"required": false, "description": "Model name from notion/models (default Auto). Examples: auto, sonnet, opus, gemini, gpt-5.4"},
    "newChat": {"required": false, "description": "Start a new chat thread (default true)"},
    "selectOnly": {"required": false, "description": "Only open chat and select model; do not submit a prompt (default false)"},
    "waitOnly": {"required": false, "description": "Skip new chat / submit; only poll for the in-flight assistant reply (default false)"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms (default 15m)"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/chat \\"Summarize this week in one paragraph\\""
}
*/`,
    `  var selectOnly = args.selectOnly === true;
  if (!args.query && !selectOnly) {
    return { error: 'Missing argument: query', hint: 'Provide a prompt for Notion AI' };
  }

${loginBlock}
${installBlock}
  var waitOpts = h.buildWaitOpts(args);
  var waitOnly = args.waitOnly === true;
  var modeId = h.resolveNotionMode(args.model || 'auto');

  var accessBlock = h.detectNotionPageAbnormal();
  if (accessBlock) return accessBlock;

  if (selectOnly) {
    if (args.newChat !== false) {
      var selectNav = await h.ensureNewChatView();
      if (!selectNav.ok) {
        if (selectNav.needsRetry) {
          return {
            error: selectNav.error || 'Navigation required',
            hint: selectNav.hint || 'Re-run the same command after Notion finishes loading.',
            action: selectNav.action || 'retry same command'
          };
        }
        return selectNav;
      }
    }
    if (!h.getChatInput()) {
      return {
        error: 'Chat input not found',
        hint: 'Notion AI chat view did not load. Open the sidebar Chat tab and retry.',
        action: 'bun-browser open https://app.notion.com/ai'
      };
    }
    var selectResult = await h.setNotionMode(modeId);
    if (!selectResult.ok) {
      return {
        error: 'Mode selection failed',
        hint: selectResult.error || selectResult.hint || ('Could not select model "' + modeId + '"'),
        requestedMode: modeId,
        action: 'bun-browser site notion/models'
      };
    }
    return {
      model: modeId,
      modeTitle: selectResult.modeTitle || null,
      modeLabel: selectResult.label || h.readNotionModeLabel(),
      selected: true,
      selectOnly: true,
      conversationId: h.getConversationId()
    };
  }

  if (waitOnly) {
    var existing = h.getAssistantMessages();
    var pollBeforeCount = Math.max(0, existing.length - 1);
    var pollBeforeText = pollBeforeCount < existing.length ? h.getAssistantText(existing[pollBeforeCount]) : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      if (h.wasLastWaitPending()) {
        return { error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' };
      }
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      return { error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' };
    }
    var waitOut = {
      query: args.query,
      model: modeId,
      modeLabel: h.readNotionModeLabel(),
      answer: waitedAnswer,
      conversationId: h.getConversationId(),
      waitOnly: true
    };
    var waitJson = h.parseAnswerJson(waitedAnswer);
    if (waitJson) { waitOut.answerJson = waitJson; waitOut.answerFormat = 'json'; }
    return waitOut;
  }

  if (args.newChat !== false) {
    var nav = await h.ensureNewChatView();
    if (!nav.ok) {
      if (nav.needsRetry) {
        return {
          error: nav.error || 'Navigation required',
          hint: nav.hint || 'Re-run the same command after Notion finishes loading.',
          action: nav.action || 'retry same command'
        };
      }
      return nav;
    }
  }

  if (!h.getChatInput()) {
    return {
      error: 'Chat input not found',
      hint: 'Notion AI chat view did not load. Open the sidebar Chat tab and retry.',
      action: 'bun-browser open https://app.notion.com/ai'
    };
  }

  var modeResult = await h.setNotionMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.error || modeResult.hint || ('Could not select model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site notion/models'
    };
  }

  var beforeCount = h.getAssistantMessages().length;
  var beforeText = h.getAssistantMessages().map(h.getAssistantText).join('\\n');

  if (!h.setChatInput(args.query)) {
    return { error: 'Chat input not found', hint: 'Could not fill the Notion AI prompt box.', action: 'bun-browser open https://app.notion.com/ai' };
  }
  await h.sleep(400);

  accessBlock = h.detectNotionPageAbnormal();
  if (accessBlock) return accessBlock;

  if (!h.clickSubmit()) {
    accessBlock = h.detectNotionPageAbnormal();
    if (accessBlock) return accessBlock;
    return { error: 'Submit button not found', hint: 'Could not find the Notion AI send button.', action: 'bun-browser open https://app.notion.com/ai' };
  }

  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    if (h.wasLastWaitPending()) {
      return { error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' };
    }
    return { error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' };
  }

  var out = {
    query: args.query,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readNotionModeLabel(),
    answer: answer,
    conversationId: h.getConversationId()
  };
  var answerJson = h.parseAnswerJson(answer);
  if (answerJson) { out.answerJson = answerJson; out.answerFormat = 'json'; }
  return out;`
  )
);

writeFileSync(
  join(root, "chatfollow.js"),
  makeFile(
    `/* @meta
{
  "name": "notion/chatfollow",
  "description": "Continue an existing Notion AI chat (chat follow: conversationId, query, answer, turn)",
  "domain": "app.notion.com",
  "args": {
    "conversation": {"required": true, "description": "Thread id or https://app.notion.com/chat?t={id} URL from notion/chat or notion/search"},
    "query": {"required": true, "description": "Follow-up prompt in the existing thread"},
    "model": {"required": false, "description": "Model name from notion/models (default Auto)"},
    "waitOnly": {"required": false, "description": "Skip navigation/submit; only poll for the in-flight assistant reply (default false)"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms (default 15m)"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/chatfollow 37b746ce-978e-8096-8d54-00a96c21f6ad \\"refine the answer\\""
}
*/`,
    `  if (!args.conversation) {
    return { error: 'Missing argument: conversation', hint: 'Provide a thread id or chat URL from notion/search', action: 'bun-browser site notion/search \\"keyword\\"' };
  }
  if (!args.query) {
    return { error: 'Missing argument: query', hint: 'Provide a follow-up prompt for the existing conversation' };
  }

${loginBlock}
${installBlock}
  var conversationId = h.parseConversationId(args.conversation);
  if (!conversationId) {
    return { error: 'Invalid conversation id', hint: 'conversation must be a thread UUID or https://app.notion.com/chat?t={id} URL', action: 'bun-browser site notion/search \\"keyword\\"' };
  }

  var waitOpts = h.buildWaitOpts(args);
  var waitOnly = args.waitOnly === true;
  var modeId = h.resolveNotionMode(args.model || 'auto');

  var accessBlock = h.detectNotionPageAbnormal();
  if (accessBlock) return accessBlock;

  if (waitOnly) {
    var existing = h.getAssistantMessages();
    var pollBeforeCount = Math.max(0, existing.length - 1);
    var pollBeforeText = pollBeforeCount < existing.length ? h.getAssistantText(existing[pollBeforeCount]) : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      if (h.wasLastWaitPending()) {
        return { error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' };
      }
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      return { error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' };
    }
    return {
      query: args.query,
      conversationId: conversationId,
      model: modeId,
      modeLabel: h.readNotionModeLabel(),
      answer: waitedAnswer,
      turn: h.getAssistantMessages().length,
      url: location.href,
      waitOnly: true
    };
  }

  var nav = await h.navigateToConversation(conversationId);
  if (!nav.ok) {
    if (nav.needsRetry) {
      return {
        error: nav.error || 'Navigation required',
        hint: nav.hint || 'Re-run the same command after Notion opens the conversation.',
        action: nav.action || 'retry same command',
        conversationId: conversationId
      };
    }
    return nav;
  }

  if (!h.getChatInput()) {
    return { error: 'Chat input not found', hint: 'Conversation page did not expose the Notion AI input.', action: nav.action || ('bun-browser open ' + h.buildConversationUrl(conversationId)) };
  }

  var modeResult = await h.setNotionMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.error || modeResult.hint || ('Could not select model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site notion/models'
    };
  }

  var beforeCount = h.getAssistantMessages().length;
  var beforeText = h.getAssistantMessages().map(h.getAssistantText).join('\\n');

  if (!h.setChatInput(args.query)) {
    return { error: 'Chat input not found', hint: 'Could not fill the Notion AI prompt box.', action: 'bun-browser open ' + h.buildConversationUrl(conversationId) };
  }
  await h.sleep(400);

  accessBlock = h.detectNotionPageAbnormal();
  if (accessBlock) return accessBlock;

  if (!h.clickSubmit()) {
    accessBlock = h.detectNotionPageAbnormal();
    if (accessBlock) return accessBlock;
    return { error: 'Submit button not found', hint: 'Could not find the Notion AI send button.', action: 'bun-browser open ' + h.buildConversationUrl(conversationId) };
  }

  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    if (h.wasLastWaitPending()) {
      return { error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' };
    }
    return { error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open ' + h.buildConversationUrl(conversationId) };
  }

  var out = {
    query: args.query,
    conversationId: conversationId,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readNotionModeLabel(),
    answer: answer,
    turn: h.getAssistantMessages().length,
    url: location.href
  };
  var answerJson = h.parseAnswerJson(answer);
  if (answerJson) { out.answerJson = answerJson; out.answerFormat = 'json'; }
  return out;`
  )
);

writeFileSync(
  join(root, "models.js"),
  makeFile(
    `/* @meta
{
  "name": "notion/models",
  "description": "List Notion AI model options (models: available, id, title, mapped)",
  "domain": "app.notion.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/models"
}
*/`,
    `${loginBlock}
${installBlock}
  var nav = await h.ensureNewChatView();
  if (!nav.ok) {
    if (nav.needsRetry) {
      return {
        error: nav.error || 'Navigation required',
        hint: nav.hint || 'Re-run the same command after Notion finishes loading.',
        action: nav.action || 'retry same command'
      };
    }
    return nav;
  }

  if (!h.getChatInput()) {
    return {
      defaultModelId: 'auto',
      current: 'Auto',
      available: ['auto'],
      models: [{ id: 'auto', title: 'Auto', available: true, mapped: true }],
      warning: 'Model picker not reachable. Open Notion AI chat first, then retry.'
    };
  }

  var listed = await h.listNotionModelsFromUi();
  var models = listed.models || [];
  return {
    defaultModelId: 'auto',
    current: listed.current || 'Auto',
    available: models.map(function(m) { return m.id; }),
    models: models
  };`
  )
);

console.log("Wrote chat.js, chatfollow.js, and models.js");
