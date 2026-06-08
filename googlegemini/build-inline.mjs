/**
 * Regenerate googlegemini/chat.js, chatfollow.js, health.js, modes.js
 * from googlegemini/chat-helpers.js (keeps browser adapters in sync).
 *
 * Run: node googlegemini/build-inline.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const helpers = readFileSync(join(dir, "chat-helpers.js"), "utf8");
const body = helpers
  .replace(/^[\s\S]*?function installGeminiChatHelpers\(\) \{\n/, "")
  .replace(/\n}\s*$/, "");
const inline = `(function installGeminiChatHelpers() {\n${body}\n})()`;

function makeFile(meta, mainBody) {
  return `${meta}\n\nasync function(args) {\n${mainBody}\n}\n`;
}

writeFileSync(
  join(dir, "chat.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/chat",
  "description": "Ask Google Gemini a question (AI chat: answer, model, conversationId)",
  "domain": "gemini.google.com",
  "args": {
    "query": {"required": true, "description": "Prompt to send to Gemini"},
    "model": {"required": false, "description": "Gemini model: flash, thinking, pro (default flash). Aliases: 3.5-flash, 3.5-thinking, 3.1-pro"},
    "newChat": {"required": false, "description": "Start a new chat thread (default true)"},
    "waitOnly": {"required": false, "description": "Skip new chat / submit; only poll for the in-flight assistant reply (default false)"},
    "context": {"required": false, "description": "External text content prepended to the prompt (inline context block)"},
    "fileName": {"required": false, "description": "Attachment file name when using fileContent or fileBase64"},
    "fileContent": {"required": false, "description": "UTF-8 text file content to upload and attach"},
    "fileBase64": {"required": false, "description": "Base64-encoded file bytes to upload and attach"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms (default by mode: flash 15m, thinking/pro 25m)"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/chat \\"Explain quantum computing in one paragraph\\""
}
*/`,
    `  if (!args.query) {
    return { error: 'Missing argument: query', hint: 'Provide a prompt for Gemini' };
  }

  var h = ${inline};

  function getConversationId() {
    var match = location.pathname.match(/\\/app\\/([0-9a-f]+)/i);
    return match ? match[1] : null;
  }

  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  var modeId = h.resolveGeminiMode(args.model || 'flash');
  var waitOpts = h.buildWaitOpts(args, modeId);
  var waitOnly = parseBool(args.waitOnly, false);
  var loginState = h.getLoginState();
  var attachmentPlan = h.prepareGeminiAttachmentPlan(args);
  var effectiveQuery = attachmentPlan.query;

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  if (waitOnly) {
    var existingMessages = h.getAssistantMessages();
    var pollBeforeCount = Math.max(0, existingMessages.length - 1);
    var pollBeforeText = pollBeforeCount < existingMessages.length
      ? h.getAssistantText(existingMessages[pollBeforeCount]) || ''
      : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      var waitWorkspaceBlock = h.checkGeminiAnswerBlocked('');
      if (waitWorkspaceBlock) return waitWorkspaceBlock;
      if (h.wasLastWaitPending()) {
        return {
          error: 'Still generating',
          hint: 'Gemini is still generating. Retry with waitOnly: true',
          action: 'retry with waitOnly: true'
        };
      }
      return {
        error: 'Empty response',
        hint: 'Gemini returned no content. The page DOM may have changed.',
        action: 'bun-browser open https://gemini.google.com/'
      };
    }
    var waitWorkspaceAnswerBlock = h.checkGeminiAnswerBlocked(waitedAnswer);
    if (waitWorkspaceAnswerBlock) return waitWorkspaceAnswerBlock;
    var waitOut = {
      query: effectiveQuery,
      model: modeId,
      modeLabel: h.readGeminiModeLabel(),
      answer: waitedAnswer,
      conversationId: getConversationId(),
      waitOnly: true,
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
    if (attachmentPlan.hasContext) waitOut.context = true;
    var waitAnswerJson = h.parseAnswerJson(waitedAnswer);
    if (waitAnswerJson) {
      waitOut.answerJson = waitAnswerJson;
      waitOut.answerFormat = 'json';
    }
    return waitOut;
  }

  var startNewChat = args.newChat !== false;
  if (startNewChat) {
    var chatNav = await h.startNewChat();
    if (chatNav && !chatNav.ok) {
      return {
        error: 'New chat requires navigation',
        hint: chatNav.hint || 'Open a fresh Gemini tab and retry.',
        action: chatNav.action || 'bun-browser open https://gemini.google.com/app'
      };
    }
  }

  if (attachmentPlan.hasFiles) {
    var attachResult = await h.submitGeminiWithAttachments({
      query: effectiveQuery,
      files: attachmentPlan.files,
      modeId: modeId
    });
    if (!attachResult.ok) {
      return {
        error: attachResult.error || 'Attachment submit failed',
        hint: attachResult.hint || 'Could not upload and send files to Gemini.',
        action: 'bun-browser open https://gemini.google.com/app'
      };
    }
    var attachOut = {
      query: effectiveQuery,
      model: modeId,
      modeLabel: h.readGeminiModeLabel(),
      answer: attachResult.answer,
      conversationId: attachResult.conversationId || getConversationId(),
      attachments: attachResult.attachments,
      transport: attachResult.transport,
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
    if (attachmentPlan.hasContext) attachOut.context = true;
    var attachAnswerJson = h.parseAnswerJson(attachResult.answer);
    if (attachAnswerJson) {
      attachOut.answerJson = attachAnswerJson;
      attachOut.answerFormat = 'json';
    }
    return attachOut;
  }

  if (!h.getChatEditor()) {
    return {
      error: 'Chat input not found',
      hint: 'Gemini page did not finish loading. Open gemini.google.com and retry.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }

  var modeResult = await h.setGeminiMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.hint || modeResult.error || ('Could not select Gemini model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site googlegemini/modes'
    };
  }

  var existingMessages = h.getAssistantMessages();
  var beforeCount = existingMessages.length;
  var beforeText = beforeCount
    ? (h.getAssistantText(existingMessages[beforeCount - 1]) || '')
    : '';

  if (!h.setChatInput(effectiveQuery)) {
    return {
      error: 'Chat input not found',
      hint: 'Could not set Gemini chat input.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }
  await h.sleep(400);

  accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  if (!h.clickSubmit()) {
    accessBlock = h.detectGeminiPageAbnormal();
    if (accessBlock) return accessBlock;
    return {
      error: 'Submit button not found',
      hint: 'Could not click Send on Gemini. Refresh the page and retry.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }

  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);

  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    var workspaceBlock = h.checkGeminiAnswerBlocked('');
    if (workspaceBlock) return workspaceBlock;
    if (h.wasLastWaitPending()) {
      return {
        error: 'Still generating',
        hint: 'Gemini is still generating (streaming/thinking). Retry with waitOnly: true',
        action: 'retry with waitOnly: true'
      };
    }
    return {
      error: 'Empty response',
      hint: 'Gemini returned no content. The page DOM may have changed.',
      action: 'bun-browser open https://gemini.google.com/'
    };
  }

  var workspaceAnswerBlock = h.checkGeminiAnswerBlocked(answer);
  if (workspaceAnswerBlock) return workspaceAnswerBlock;

  var out = {
    query: effectiveQuery,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readGeminiModeLabel(),
    answer: answer,
    conversationId: getConversationId(),
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous
  };
  if (attachmentPlan.hasContext) out.context = true;
  var answerJson = h.parseAnswerJson(answer);
  if (answerJson) {
    out.answerJson = answerJson;
    out.answerFormat = 'json';
  }
  return out;`,
  ),
);

writeFileSync(
  join(dir, "chatfollow.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/chatfollow",
  "description": "Continue an existing Gemini conversation (chat follow: conversationId, query, answer)",
  "domain": "gemini.google.com",
  "args": {
    "conversation": {"required": true, "description": "Conversation id or https://gemini.google.com/app/{id} URL from googlegemini/chat"},
    "query": {"required": true, "description": "Follow-up prompt to send in the existing thread"},
    "model": {"required": false, "description": "Gemini model: flash, thinking, pro (default flash)"},
    "waitOnly": {"required": false, "description": "Skip navigation/submit; only poll for the in-flight assistant reply (default false)"},
    "context": {"required": false, "description": "External text content prepended to the follow-up prompt"},
    "fileName": {"required": false, "description": "Attachment file name when using fileContent or fileBase64"},
    "fileContent": {"required": false, "description": "UTF-8 text file content to upload and attach"},
    "fileBase64": {"required": false, "description": "Base64-encoded file bytes to upload and attach"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/chatfollow 470d783cedf1bbb6 \\"refine the answer\\""
}
*/`,
    `  function parseConversationId(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    var fromPath = text.match(/\\/app\\/([0-9a-f]+)/i);
    if (fromPath) return fromPath[1].toLowerCase();
    if (/^[0-9a-f]+$/i.test(text)) return text.toLowerCase();
    return null;
  }

  if (!args.conversation) {
    return {
      error: 'Missing argument: conversation',
      hint: 'Provide a conversation id or URL from googlegemini/chat',
      action: 'bun-browser site googlegemini/chat \\"hello\\"'
    };
  }

  if (!args.query) {
    return { error: 'Missing argument: query', hint: 'Provide a follow-up prompt' };
  }

  var conversationId = parseConversationId(args.conversation);
  if (!conversationId) {
    return {
      error: 'Invalid conversation id',
      hint: 'conversation must be a hex id or https://gemini.google.com/app/{id} URL',
      action: 'bun-browser site googlegemini/chat \\"hello\\"'
    };
  }

  var h = ${inline};

  function getConversationId() {
    var match = location.pathname.match(/\\/app\\/([0-9a-f]+)/i);
    return match ? match[1] : null;
  }

  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  var modeId = h.resolveGeminiMode(args.model || 'flash');
  var waitOpts = h.buildWaitOpts(args, modeId);
  var waitOnly = parseBool(args.waitOnly, false);
  var loginState = h.getLoginState();
  var attachmentPlan = h.prepareGeminiAttachmentPlan(args);
  var effectiveQuery = attachmentPlan.query;

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  var currentId = getConversationId();
  if (!attachmentPlan.hasFiles && currentId !== conversationId) {
    location.href = 'https://gemini.google.com/app/' + conversationId;
    await h.sleep(2000);
  }

  if (waitOnly) {
    var existingMessages = h.getAssistantMessages();
    var pollBeforeCount = Math.max(0, existingMessages.length - 1);
    var pollBeforeText = pollBeforeCount < existingMessages.length
      ? h.getAssistantText(existingMessages[pollBeforeCount]) || ''
      : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      var waitWorkspaceBlock = h.checkGeminiAnswerBlocked('');
      if (waitWorkspaceBlock) return waitWorkspaceBlock;
      if (h.wasLastWaitPending()) {
        return {
          error: 'Still generating',
          hint: 'Gemini is still generating. Retry with waitOnly: true',
          action: 'retry with waitOnly: true'
        };
      }
      return {
        error: 'Empty response',
        hint: 'Gemini returned no content.',
        action: 'bun-browser open https://gemini.google.com/'
      };
    }
    var waitWorkspaceAnswerBlock = h.checkGeminiAnswerBlocked(waitedAnswer);
    if (waitWorkspaceAnswerBlock) return waitWorkspaceAnswerBlock;
    var waitOut = {
      conversationId: conversationId,
      query: effectiveQuery,
      model: modeId,
      modeLabel: h.readGeminiModeLabel(),
      answer: waitedAnswer,
      waitOnly: true,
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
    if (attachmentPlan.hasContext) waitOut.context = true;
    var waitAnswerJson = h.parseAnswerJson(waitedAnswer);
    if (waitAnswerJson) {
      waitOut.answerJson = waitAnswerJson;
      waitOut.answerFormat = 'json';
    }
    return waitOut;
  }

  if (attachmentPlan.hasFiles) {
    var followAttach = await h.submitGeminiWithAttachments({
      query: effectiveQuery,
      files: attachmentPlan.files,
      modeId: modeId,
      conversationHexId: conversationId
    });
    if (!followAttach.ok) {
      return {
        error: followAttach.error || 'Attachment submit failed',
        hint: followAttach.hint || 'Could not upload and send files in this conversation.',
        conversationId: conversationId,
        action: 'bun-browser open https://gemini.google.com/app/' + conversationId
      };
    }
    var followAttachOut = {
      conversationId: conversationId,
      query: effectiveQuery,
      model: modeId,
      modeLabel: h.readGeminiModeLabel(),
      answer: followAttach.answer,
      attachments: followAttach.attachments,
      transport: followAttach.transport,
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
    if (attachmentPlan.hasContext) followAttachOut.context = true;
    var followAttachJson = h.parseAnswerJson(followAttach.answer);
    if (followAttachJson) {
      followAttachOut.answerJson = followAttachJson;
      followAttachOut.answerFormat = 'json';
    }
    return followAttachOut;
  }

  if (!h.getChatEditor()) {
    return {
      error: 'Chat input not found',
      hint: 'Gemini conversation page did not finish loading.',
      action: 'bun-browser open https://gemini.google.com/app/' + conversationId
    };
  }

  var modeResult = await h.setGeminiMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.hint || modeResult.error,
      requestedMode: modeId,
      action: 'bun-browser site googlegemini/modes'
    };
  }

  var existingMessages = h.getAssistantMessages();
  var beforeCount = existingMessages.length;
  var beforeText = beforeCount
    ? (h.getAssistantText(existingMessages[beforeCount - 1]) || '')
    : '';

  if (!h.setChatInput(effectiveQuery)) {
    return {
      error: 'Chat input not found',
      hint: 'Could not set Gemini chat input.',
      action: 'bun-browser open https://gemini.google.com/app/' + conversationId
    };
  }
  await h.sleep(400);

  accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  if (!h.clickSubmit()) {
    accessBlock = h.detectGeminiPageAbnormal();
    if (accessBlock) return accessBlock;
    return {
      error: 'Submit button not found',
      hint: 'Could not click Send on Gemini.',
      action: 'bun-browser open https://gemini.google.com/app/' + conversationId
    };
  }

  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    var workspaceBlock = h.checkGeminiAnswerBlocked('');
    if (workspaceBlock) return workspaceBlock;
    if (h.wasLastWaitPending()) {
      return {
        error: 'Still generating',
        hint: 'Gemini is still generating. Retry with waitOnly: true',
        action: 'retry with waitOnly: true'
      };
    }
    return {
      error: 'Empty response',
      hint: 'Gemini returned no content.',
      action: 'bun-browser open https://gemini.google.com/app/' + conversationId
    };
  }

  var workspaceAnswerBlock = h.checkGeminiAnswerBlocked(answer);
  if (workspaceAnswerBlock) return workspaceAnswerBlock;

  var out = {
    conversationId: conversationId,
    query: effectiveQuery,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readGeminiModeLabel(),
    answer: answer,
    turn: h.getAssistantMessages().length,
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous
  };
  if (attachmentPlan.hasContext) out.context = true;
  var answerJson = h.parseAnswerJson(answer);
  if (answerJson) {
    out.answerJson = answerJson;
    out.answerFormat = 'json';
  }
  return out;`,
  ),
);

writeFileSync(
  join(dir, "health.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/health",
  "description": "Check Gemini chat access: login state, Cloudflare, rate limits, submit state",
  "domain": "gemini.google.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/health"
}
*/`,
    `  var h = ${inline};

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) {
    accessBlock.ok = false;
    return accessBlock;
  }

  var loginState = h.getLoginState();
  var chatInput = !!h.getChatEditor();
  var submitBtn = h.getSubmitButton();
  var submitEnabled = !!(submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true');
  var modeLabel = h.readGeminiModeLabel();

  if (submitBtn && !submitEnabled) {
    return {
      ok: false,
      error: 'Chat submission blocked',
      kind: 'submit_disabled',
      hint: 'Send button is disabled — often due to rate limits or an empty input.',
      action: 'bun-browser open https://gemini.google.com/',
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous,
      chatInput: chatInput,
      submitEnabled: false,
      modeLabel: modeLabel
    };
  }

  return {
    ok: true,
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous,
    chatInput: chatInput,
    submitEnabled: submitEnabled,
    modeLabel: modeLabel,
    url: location.href,
    hint: chatInput
      ? (submitEnabled
        ? (loginState.anonymous
          ? 'Gemini chat appears accessible (anonymous session — sign in for full model access).'
          : 'Gemini chat appears accessible.')
        : 'Chat input present but Send is disabled.')
      : 'Chat input not found — open gemini.google.com/app.'
  };`,
  ),
);

writeFileSync(
  join(dir, "modes.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/modes",
  "description": "List available Gemini models from the mode picker (flash, thinking, pro)",
  "domain": "gemini.google.com",
  "args": {},
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/modes"
}
*/`,
    `  var h = ${inline};

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  var ui = await h.listGeminiModesFromUi();
  var modes = ui.modes || [];
  var byTitle = {};
  for (var i = 0; i < modes.length; i++) {
    var title = modes[i].title || '';
    if (/3\\.5\\s*flash/i.test(title)) byTitle.flash = modes[i];
    else if (/3\\.5\\s*thinking/i.test(title)) byTitle.thinking = modes[i];
    else if (/3\\.1\\s*pro/i.test(title)) byTitle.pro = modes[i];
  }

  var loginState = h.getLoginState();

  return {
    defaultModeId: 'flash',
    current: ui.current || h.readGeminiModeLabel(),
    available: Object.keys(byTitle).length ? Object.keys(byTitle) : ['flash', 'thinking', 'pro'],
    modes: modes,
    modeMap: byTitle,
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous
  };`,
  ),
);

writeFileSync(
  join(dir, "search.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/search",
  "description": "Search or list Gemini chat history (title, snippet, date, conversationId, url)",
  "domain": "gemini.google.com",
  "args": {
    "query": {"required": false, "description": "Search keyword; omit for recent list; use * for recent with conversationId resolution"},
    "limit": {"required": false, "description": "Max results (default 20, max 50)"},
    "resolveLimit": {"required": false, "description": "Max items to resolve conversationId via click (default 5 when resolving, max 20)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/search \\"pandemic\\""
}
*/`,
    `  var h = ${inline};

  var rawQuery = args.query != null ? String(args.query).trim() : '';
  var resolveRecent = rawQuery === '*';
  var searchQuery = resolveRecent ? '' : rawQuery;
  var limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50);
  var resolveIds = !!searchQuery || resolveRecent;
  var resolveLimit = Math.min(Math.max(parseInt(args.resolveLimit, 10) || 5, 0), 20);
  var loginState = h.getLoginState();

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  var page = await h.ensureGeminiSearchPage();
  if (!page.ok) {
    return {
      error: 'Search page not available',
      hint: 'Open gemini.google.com in the browser and sign in, then retry.',
      action: 'bun-browser open https://gemini.google.com/search',
      viewport: h.getGeminiViewport(),
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
  }

  var mode = searchQuery ? 'search' : 'recent';
  var rawItems = [];

  if (searchQuery) {
    var searchRun = await h.runGeminiChatSearch(searchQuery);
    if (!searchRun.ok) {
      return {
        query: searchQuery,
        mode: mode,
        count: 0,
        results: [],
        hint: 'No matching chats found.',
        viewport: h.getGeminiViewport(),
        loggedIn: loginState.loggedIn,
        anonymous: loginState.anonymous
      };
    }
    rawItems = h.scrapeGeminiSearchResults(limit);
  } else {
    rawItems = h.scrapeGeminiRecentChats(limit);
  }

  var results = resolveIds
    ? await h.resolveGeminiConversationIds(rawItems, resolveLimit)
    : rawItems.map(function(item) {
        var out = { title: item.title, date: item.date || null };
        if (item.snippet) out.snippet = item.snippet;
        if (item.highlights) out.highlights = item.highlights;
        return out;
      });

  return {
    query: searchQuery || null,
    mode: mode,
    count: results.length,
    results: results,
    resolveIds: resolveIds,
    resolveLimit: resolveIds ? resolveLimit : 0,
    viewport: h.getGeminiViewport(),
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous,
    hint: resolveIds
      ? 'Use conversationId with googlegemini/chatfollow to continue a thread.'
      : 'Pass query * (or search a keyword) to populate conversationId and url fields.'
  };`,
  ),
);

writeFileSync(
  join(dir, "library.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/library",
  "description": "List Gemini Library creations: Canvas docs, Deep Research, images, videos (My Stuff)",
  "domain": "gemini.google.com",
  "args": {
    "section": {"required": false, "description": "all (default), media, documents"},
    "limit": {"required": false, "description": "Max items per section (default 20, max 50)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/library"
}
*/`,
    `  var h = ${inline};

  var section = String(args.section || 'all').toLowerCase();
  if (['all', 'media', 'documents'].indexOf(section) === -1) {
    return {
      error: 'Invalid section',
      hint: 'section must be all, media, or documents',
      action: 'bun-browser site googlegemini/library'
    };
  }

  var limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50);
  var loginState = h.getLoginState();

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  if (section === 'documents') {
    var docsNav = await h.navigateToGeminiPath('/mystuff/documents', {
      selectors: ['library-sections-overview-page', 'library-documents-page', 'mat-sidenav-content'],
      timeoutMs: 12000
    });
    await h.dismissGeminiSidebarIfBlocking();
    if (!docsNav.ok && !h.scrapeGeminiLibraryDocumentsPage(1).length) {
      var fallback = await h.ensureGeminiLibraryPage();
      if (!fallback.ok) {
        return {
          error: 'Library page not available',
          hint: 'Open gemini.google.com/library in the browser and sign in, then retry.',
          action: 'bun-browser open https://gemini.google.com/library',
          viewport: h.getGeminiViewport(),
          loggedIn: loginState.loggedIn,
          anonymous: loginState.anonymous
        };
      }
      var overview = h.scrapeGeminiLibrary();
      return {
        section: section,
        empty: overview.empty,
        count: overview.documents.length,
        documents: overview.documents.slice(0, limit),
        media: [],
        viewport: h.getGeminiViewport(),
        loggedIn: loginState.loggedIn,
        anonymous: loginState.anonymous,
        url: location.href
      };
    }
    var documents = h.scrapeGeminiLibraryDocumentsPage(limit);
    return {
      section: section,
      empty: !documents.length,
      count: documents.length,
      documents: documents,
      media: [],
      viewport: h.getGeminiViewport(),
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous,
      url: location.href
    };
  }

  var page = await h.ensureGeminiLibraryPage();
  if (!page.ok) {
    return {
      error: 'Library page not available',
      hint: 'Open gemini.google.com/library in the browser and sign in, then retry.',
      action: 'bun-browser open https://gemini.google.com/library',
      viewport: h.getGeminiViewport(),
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
  }

  if (section === 'media') {
    var mediaNav = await h.navigateToGeminiPath('/mystuff/media', {
      selectors: ['library-sections-overview-page', 'mat-sidenav-content'],
      timeoutMs: 10000,
      waitMs: 1500
    });
    await h.dismissGeminiSidebarIfBlocking();
  }

  var library = h.scrapeGeminiLibrary();
  if (!library.ok) {
    return {
      error: library.error || 'Library scrape failed',
      hint: 'Gemini Library DOM may have changed.',
      action: 'bun-browser open https://gemini.google.com/library',
      viewport: h.getGeminiViewport()
    };
  }

  var media = (library.media || []).slice(0, limit);
  var documents = (library.documents || []).slice(0, limit);
  var out = {
    section: section,
    empty: library.empty,
    viewport: h.getGeminiViewport(),
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous,
    url: location.href
  };
  if (library.message) out.message = library.message;

  if (section === 'all') {
    out.count = media.length + documents.length;
    out.media = media;
    out.documents = documents;
  } else if (section === 'media') {
    out.count = media.length;
    out.media = media;
    out.documents = [];
  } else {
    out.count = documents.length;
    out.media = [];
    out.documents = documents;
  }

  return out;`,
  ),
);

writeFileSync(
  join(dir, "branch.js"),
  makeFile(
    `/* @meta
{
  "name": "googlegemini/branch",
  "description": "Branch a Gemini conversation at an assistant reply (fork into a new chat thread)",
  "domain": "gemini.google.com",
  "args": {
    "conversation": {"required": true, "description": "Source conversation id or https://gemini.google.com/app/{id} URL"},
    "messageIndex": {"required": false, "description": "0-based assistant reply index to branch from (default: last reply)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site googlegemini/branch 470d783cedf1bbb6"
}
*/`,
    `  if (!args.conversation) {
    return {
      error: 'Missing argument: conversation',
      hint: 'Provide a conversation id or URL from googlegemini/chat or googlegemini/search',
      action: 'bun-browser site googlegemini/search \\"*\\" 5 3'
    };
  }

  var h = ${inline};

  var conversationId = h.parseConversationIdArg(args.conversation);
  if (!conversationId) {
    return {
      error: 'Invalid conversation id',
      hint: 'conversation must be a hex id or https://gemini.google.com/app/{id} URL',
      action: 'bun-browser site googlegemini/search \\"*\\" 5 3'
    };
  }

  var messageIndex = args.messageIndex;
  if (messageIndex != null && messageIndex !== '') {
    messageIndex = parseInt(messageIndex, 10);
    if (isNaN(messageIndex)) {
      return {
        error: 'Invalid messageIndex',
        hint: 'messageIndex must be a non-negative integer',
        action: 'bun-browser site googlegemini/branch ' + conversationId
      };
    }
  } else {
    messageIndex = undefined;
  }

  var loginState = h.getLoginState();

  var accessBlock = h.detectGeminiPageAbnormal();
  if (accessBlock) return accessBlock;

  var result = await h.branchGeminiConversationAt(conversationId, messageIndex);
  if (!result.ok) {
    return {
      error: result.error || 'Branch failed',
      hint: result.hint || 'Open the conversation in Gemini and retry.',
      sourceConversationId: conversationId,
      action: 'bun-browser open https://gemini.google.com/app/' + conversationId,
      viewport: h.getGeminiViewport(),
      loggedIn: loginState.loggedIn,
      anonymous: loginState.anonymous
    };
  }

  return {
    sourceConversationId: result.sourceConversationId,
    conversationId: result.conversationId,
    url: result.url,
    title: result.title,
    messageIndex: result.messageIndex,
    messagesCopied: result.messagesCopied,
    snapshot: result.snapshot,
    viewport: h.getGeminiViewport(),
    loggedIn: loginState.loggedIn,
    anonymous: loginState.anonymous,
    hint: 'Continue the branched thread with googlegemini/chatfollow ' + result.conversationId
  };`,
  ),
);

console.log("Regenerated chat.js, chatfollow.js, health.js, modes.js, search.js, library.js, branch.js");
