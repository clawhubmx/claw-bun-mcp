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
const trustDrainBlock = "  await h.drainUrlTrustPrompts();\n";
const restoreComposerBlock = "  await h.closeModelPickerSurface();\n";
const parseArgHelpers = `  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  function pickPositional(args, index) {
    if (!args._positional || args._positional.length <= index) return undefined;
    return args._positional[index];
  }

  function pickArg(args, name, index, defaultVal) {
    if (args[name] !== undefined && args[name] !== null && args[name] !== '') return args[name];
    if (index >= 0) {
      var pos = pickPositional(args, index);
      if (pos !== undefined && pos !== null && pos !== '') return pos;
    }
    return defaultVal;
  }

  function pickBoolArg(args, name, index, defaultVal) {
    return parseBool(pickArg(args, name, index, undefined), defaultVal);
  }

`;
const busyTabGuardBlock = `  var allowBusyTab = pickBoolArg(args, 'allowBusyTab', -1, false);
  if (newChat && !waitOnly && !allowBusyTab && h.isChatInProgress()) {
    return {
      error: 'Tab busy',
      kind: 'chat_in_progress',
      hint: 'This Notion tab is still generating a reply. Open a fresh tab for a new prompt instead of restarting this one.',
      action: 'bun-browser open https://app.notion.com/ai --tab new',
      conversationId: h.getConversationId(),
      generating: true
    };
  }

`;
const attachBlock = `  var attachPlan = h.prepareNotionAttachmentPlan(args);
  if (attachPlan.error) {
    return { error: attachPlan.error, hint: attachPlan.hint || attachPlan.error };
  }
  var attachedItems = null;
  if (attachPlan.hasAttachments) {
    var attachResult = await h.attachNotionChatContext(attachPlan);
    if (!attachResult.ok) {
      return {
        error: 'Attachment failed',
        hint: attachResult.hint || attachResult.error,
        requestedAttachments: attachPlan
      };
    }
    attachedItems = attachResult.attachments || null;
  }
  var queryText = attachPlan.query || args.query;

`;
const captureWarningHelper = `  function attachCaptureWarning(obj, isFailure) {
    var capWarn = h.getLastCaptureWarning();
    if (!capWarn || !obj) return obj;
    if (isFailure) {
      obj.hint = obj.hint ? (obj.hint + ' ' + capWarn) : capWarn;
    } else {
      obj.captureWarning = capWarn;
    }
    return obj;
  }

`;
const emptyAnswerRecoveryBlock = `    answer = await h.recoverCompletedAnswer(beforeCount, beforeText, waitOpts);
`;
const attachAnswerFieldsBlock = (outVar, queryVar) => `  var answerFields = h.buildAnswerFields(${outVar}.answer, ${queryVar}, waitOpts);
  if (answerFields) {
    if (answerFields.answer != null) ${outVar}.answer = answerFields.answer;
    if (answerFields.answerFormat) ${outVar}.answerFormat = answerFields.answerFormat;
    if (answerFields.answerJson) ${outVar}.answerJson = answerFields.answerJson;
    if (answerFields.jsonRecovered) ${outVar}.jsonRecovered = true;
  } else {
    var parsedAnswerJson = h.parseAnswerJson(${outVar}.answer);
    if (parsedAnswerJson) {
      ${outVar}.answerJson = parsedAnswerJson;
      ${outVar}.answerFormat = 'json';
    }
  }
  var captureSource = h.getLastCaptureSource();
  if (captureSource) ${outVar}.captureSource = captureSource;
`;
const incompleteJsonRejectBlock = `  if (answer) {
    answer = h.rejectIncompleteJsonFailedAnswer(answer, waitOpts);
  }
`;

const modelFallbackOutField = `  if (modelFallbackMeta) out.modelFallback = modelFallbackMeta;
`;

const modelFallbackSharedRetry = `    var fallbackModeResult = await h.setNotionMode(fallbackTo);
    if (!fallbackModeResult.ok) {
      var fallbackFailMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason,
        failed: true
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        fallbackFailMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
      return {
        error: 'Mode selection failed',
        hint: fallbackModeResult.hint || fallbackModeResult.error || ('Could not select fallback model "' + fallbackTo + '"'),
        requestedMode: fallbackTo,
        modelFallback: fallbackFailMeta,
        action: 'bun-browser site notion/models'
      };
    }
    modeId = fallbackTo;
    modeResult = fallbackModeResult;
    waitOpts.mode = modeId;
    beforeCount = h.getAssistantMessagesSinceLastUser().length;
    beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\\n');
    submitResult = await h.submitChatPrompt(queryText, beforeCount, beforeText, waitOpts);
    if (!submitResult.ok) {
      if (submitResult.kind) return submitResult;
      var fallbackSubmitMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason,
        submitFailed: true
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        fallbackSubmitMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
      return {
        error: submitResult.error || 'Submit failed',
        hint: submitResult.hint || 'Could not resubmit after model fallback.',
        action: submitResult.action || 'bun-browser open https://app.notion.com/ai',
        modelFallback: fallbackSubmitMeta
      };
    }
    answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
    if (!answer) {
      answer = await h.recoverCompletedAnswer(beforeCount, beforeText, waitOpts);
    }
    if (answer) {
      modelFallbackMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        modelFallbackMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
    }
`;

const modelFallbackChatBlock = `  var modelFallbackMeta = null;
  if (!answer && h.shouldRetryModelFallback(modeId, queryText, waitOpts)) {
    var fallbackReason = h.getModelFallbackTriggerReason();
    var fallbackFromMode = modeId;
    var fallbackFromTitle = modeResult.modeTitle || modeResult.label || modeId;
    var fallbackTo = h.resolveModelFallbackTarget(modeId, waitOpts);
    var fallbackNav = await h.ensureNewChatView();
    if (!fallbackNav.ok) {
      if (fallbackNav.needsRetry) {
        return {
          error: fallbackNav.error || 'Navigation required',
          hint: fallbackNav.hint || 'Re-run the same command after Notion finishes loading.',
          action: fallbackNav.action || 'retry same command'
        };
      }
      return fallbackNav;
    }
${modelFallbackSharedRetry}  }
`;

const modelFallbackSharedRetryChatfollow = `    var fallbackModeResult = await h.setNotionMode(fallbackTo);
    if (!fallbackModeResult.ok) {
      var fallbackFailMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason,
        failed: true
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        fallbackFailMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
      return {
        error: 'Mode selection failed',
        hint: fallbackModeResult.hint || fallbackModeResult.error || ('Could not select fallback model "' + fallbackTo + '"'),
        requestedMode: fallbackTo,
        conversationId: conversationId,
        modelFallback: fallbackFailMeta,
        action: 'bun-browser site notion/models'
      };
    }
    modeId = fallbackTo;
    modeResult = fallbackModeResult;
    waitOpts.mode = modeId;
    beforeCount = h.getAssistantMessagesSinceLastUser().length;
    beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\\n');
    submitResult = await h.submitChatPrompt(queryText, beforeCount, beforeText, waitOpts);
    if (!submitResult.ok) {
      if (submitResult.kind) return submitResult;
      var fallbackSubmitMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason,
        submitFailed: true
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        fallbackSubmitMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
      return {
        error: submitResult.error || 'Submit failed',
        hint: submitResult.hint || 'Could not resubmit after model fallback.',
        action: submitResult.action || ('bun-browser open ' + h.buildConversationUrl(conversationId)),
        conversationId: conversationId,
        modelFallback: fallbackSubmitMeta
      };
    }
    answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
    if (!answer) {
      answer = await h.recoverCompletedAnswer(beforeCount, beforeText, waitOpts);
    }
    if (answer) {
      modelFallbackMeta = {
        from: fallbackFromTitle,
        fromAlias: fallbackFromMode,
        to: fallbackTo,
        reason: fallbackReason
      };
      if (fallbackReason === 'incomplete_json_stuck') {
        modelFallbackMeta.stuckMs = waitOpts.modelFallbackStuckMs || h.INCOMPLETE_JSON_STUCK_MS;
      }
    }
`;

const modelFallbackChatfollowBlock = `  var modelFallbackMeta = null;
  if (!answer && h.shouldRetryModelFallback(modeId, queryText, waitOpts)) {
    var fallbackReason = h.getModelFallbackTriggerReason();
    var fallbackFromMode = modeId;
    var fallbackFromTitle = modeResult.modeTitle || modeResult.label || modeId;
    var fallbackTo = h.resolveModelFallbackTarget(modeId, waitOpts);
${modelFallbackSharedRetryChatfollow}  }
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
    "allowBusyTab": {"required": false, "description": "Allow newChat on a tab that is still generating (default false; use a new tab instead)"},
    "maxWaitMs": {"required": false, "description": "Override max wait in ms (default 15m)"},
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"},
    "context": {"required": false, "description": "Optional text prepended to the prompt"},
    "fileName": {"required": false, "description": "Attachment file name when using fileContent or fileBase64"},
    "fileContent": {"required": false, "description": "UTF-8 text file content to attach via Give context"},
    "fileBase64": {"required": false, "description": "Base64-encoded file bytes to attach via Give context"},
    "files": {"required": false, "description": "JSON array of {fileName, fileContent|fileBase64} for multiple files"},
    "pages": {"required": false, "description": "Comma-separated Notion page titles or URLs to mention"},
    "page": {"required": false, "description": "Single Notion page title or URL to mention"},
    "modelFallback": {"required": false, "description": "Retry with fallback model when --json/expectJson incomplete JSON, Opus JSON stalls, or premium models return a single-char failure (default true)"},
    "modelFallbackTo": {"required": false, "description": "Fallback model alias when Opus JSON is stuck (default auto)"},
    "modelFallbackStuckMs": {"required": false, "description": "Ms of unchanged incomplete JSON before Opus fallback (default 5000)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/chat \\"Summarize this week in one paragraph\\""
}
*/`,
    `${parseArgHelpers}  var selectOnly = pickBoolArg(args, 'selectOnly', 3, false);
  var queryTextArg = pickArg(args, 'query', 0, '');
  if (!queryTextArg && !selectOnly) {
    return { error: 'Missing argument: query', hint: 'Provide a prompt for Notion AI' };
  }

${loginBlock}
${installBlock}
${captureWarningHelper}  h.resetUrlTrustState();
  var waitOpts = h.buildWaitOpts(args);
  var waitOnly = pickBoolArg(args, 'waitOnly', 4, false);
  var newChat = pickBoolArg(args, 'newChat', 2, true);
  var modeId = h.resolveNotionMode(pickArg(args, 'model', 1, 'auto') || 'auto');

  var accessBlock = h.detectNotionPageAbnormal({ skipSubmitCheck: waitOnly || selectOnly });
  if (accessBlock) return accessBlock;
${trustDrainBlock}${busyTabGuardBlock}  if (selectOnly) {
    if (newChat) {
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
        hint: selectResult.hint || selectResult.error || ('Could not select model "' + modeId + '"'),
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
    waitOpts.query = queryTextArg || args.query;
${trustDrainBlock}    var existing = h.getAssistantMessages();
    var pollBeforeCount = h.getCurrentReplyAssistantStartCount();
    var pollBeforeText = pollBeforeCount < existing.length ? h.getAssistantText(existing[pollBeforeCount]) : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      waitedAnswer = await h.recoverCompletedAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    }
    if (waitedAnswer) {
      waitedAnswer = h.rejectIncompleteJsonFailedAnswer(waitedAnswer, waitOpts);
    }
    if (!waitedAnswer) {
      if (h.wasLastWaitPending()) {
        return attachCaptureWarning({ error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' }, true);
      }
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      return attachCaptureWarning({ error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' }, true);
    }
    var waitOut = {
      query: queryTextArg || args.query,
      model: modeId,
      modeLabel: h.readNotionModeLabel(),
      answer: waitedAnswer,
      conversationId: h.getConversationId(),
      waitOnly: true
    };
    var waitTrust = h.getLastUrlTrustAccepts();
    if (waitTrust.length) waitOut.urlTrustAccepted = waitTrust;
    var waitQuery = queryTextArg || args.query;
${attachAnswerFieldsBlock('waitOut', 'waitQuery')}${restoreComposerBlock}    return attachCaptureWarning(waitOut, false);
  }

  if (newChat) {
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
${trustDrainBlock}  }

  if (newChat && h.isStaleChatThread()) {
    var reclear = await h.ensureNewChatView();
    if (!reclear.ok) {
      if (reclear.needsRetry) {
        return {
          error: reclear.error || 'Navigation required',
          hint: reclear.hint || 'Re-run the same command after Notion finishes loading.',
          action: reclear.action || 'retry same command'
        };
      }
      return reclear;
    }
  }

  if (newChat && h.isStaleChatThread()) {
    return {
      error: 'Stale chat thread still visible',
      kind: 'stale_thread',
      hint: 'Notion did not clear the prior reply before submit. Open a new tab and retry.',
      action: 'bun-browser open https://app.notion.com/ai --tab new'
    };
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
      hint: modeResult.hint || modeResult.error || ('Could not select model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site notion/models'
    };
  }
  waitOpts.mode = modeId;
${trustDrainBlock}
${attachBlock}
  var beforeCount = h.getAssistantMessagesSinceLastUser().length;
  var beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\\n');

  var submitResult = await h.submitChatPrompt(queryText, beforeCount, beforeText, waitOpts);
  if (!submitResult.ok) {
    if (submitResult.kind) return submitResult;
    return {
      error: submitResult.error || 'Submit failed',
      hint: submitResult.hint || 'Could not submit the Notion AI prompt.',
      action: submitResult.action || 'bun-browser open https://app.notion.com/ai'
    };
  }
${trustDrainBlock}
  waitOpts.query = queryText;
  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
  if (!answer) {
${emptyAnswerRecoveryBlock}  }
${incompleteJsonRejectBlock}${modelFallbackChatBlock}  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    if (h.wasLastWaitPending()) {
      return attachCaptureWarning({ error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' }, true);
    }
    return attachCaptureWarning({ error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' }, true);
  }

  var out = {
    query: queryText,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readNotionModeLabel(),
    answer: answer,
    conversationId: h.getConversationId()
  };
  if (attachedItems) out.attachments = attachedItems;
  var trustAccepted = h.getLastUrlTrustAccepts();
  if (trustAccepted.length) out.urlTrustAccepted = trustAccepted;
${attachAnswerFieldsBlock('out', 'queryText')}${modelFallbackOutField}${restoreComposerBlock}  return attachCaptureWarning(out, false);`
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
    "graceWaitMs": {"required": false, "description": "Optional extra wait in ms added on top of maxWaitMs"},
    "context": {"required": false, "description": "Optional text prepended to the prompt"},
    "fileName": {"required": false, "description": "Attachment file name when using fileContent or fileBase64"},
    "fileContent": {"required": false, "description": "UTF-8 text file content to attach via Give context"},
    "fileBase64": {"required": false, "description": "Base64-encoded file bytes to attach via Give context"},
    "files": {"required": false, "description": "JSON array of {fileName, fileContent|fileBase64} for multiple files"},
    "pages": {"required": false, "description": "Comma-separated Notion page titles or URLs to mention"},
    "page": {"required": false, "description": "Single Notion page title or URL to mention"},
    "modelFallback": {"required": false, "description": "Retry with fallback model when --json/expectJson incomplete JSON, Opus JSON stalls, or premium models return a single-char failure (default true)"},
    "modelFallbackTo": {"required": false, "description": "Fallback model alias when Opus JSON is stuck (default auto)"},
    "modelFallbackStuckMs": {"required": false, "description": "Ms of unchanged incomplete JSON before Opus fallback (default 5000)"}
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
${captureWarningHelper}  h.resetUrlTrustState();
  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

  var conversationId = h.parseConversationId(args.conversation);
  if (!conversationId) {
    return { error: 'Invalid conversation id', hint: 'conversation must be a thread UUID or https://app.notion.com/chat?t={id} URL', action: 'bun-browser site notion/search \\"keyword\\"' };
  }

  var waitOpts = h.buildWaitOpts(args);
  var waitOnly = parseBool(args.waitOnly, false);
  var modeId = h.resolveNotionMode(args.model || 'auto');

  var accessBlock = h.detectNotionPageAbnormal({ skipSubmitCheck: waitOnly });
  if (accessBlock) return accessBlock;
${trustDrainBlock}
  if (waitOnly) {
    waitOpts.query = args.query;
${trustDrainBlock}    var existing = h.getAssistantMessages();
    var pollBeforeCount = h.getCurrentReplyAssistantStartCount();
    var pollBeforeText = pollBeforeCount < existing.length ? h.getAssistantText(existing[pollBeforeCount]) : '';
    var waitedAnswer = await h.waitForAssistantAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    if (!waitedAnswer) {
      waitedAnswer = await h.recoverCompletedAnswer(pollBeforeCount, pollBeforeText, waitOpts);
    }
    if (waitedAnswer) {
      waitedAnswer = h.rejectIncompleteJsonFailedAnswer(waitedAnswer, waitOpts);
    }
    if (!waitedAnswer) {
      if (h.wasLastWaitPending()) {
        return attachCaptureWarning({ error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' }, true);
      }
      var waitAbnormal = h.getLastWaitAbnormal();
      if (waitAbnormal) return waitAbnormal;
      return attachCaptureWarning({ error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open https://app.notion.com/' }, true);
    }
    var waitFollowOut = {
      query: args.query,
      conversationId: conversationId,
      model: modeId,
      modeLabel: h.readNotionModeLabel(),
      answer: waitedAnswer,
      turn: h.getAssistantMessages().length,
      url: location.href,
      waitOnly: true
    };
    var waitFollowTrust = h.getLastUrlTrustAccepts();
    if (waitFollowTrust.length) waitFollowOut.urlTrustAccepted = waitFollowTrust;
${attachAnswerFieldsBlock('waitFollowOut', 'args.query')}${restoreComposerBlock}    return attachCaptureWarning(waitFollowOut, false);
  }

  var landing = await h.ensureAiLandingPage();
  if (!landing.ok) {
    if (landing.needsRetry) {
      return {
        error: landing.error || 'Navigation required',
        hint: landing.hint || 'Re-run the same command after Notion opens the AI landing page.',
        action: landing.action || 'retry same command',
        conversationId: conversationId
      };
    }
    return landing;
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
${trustDrainBlock}
  if (!h.getChatInput()) {
    return { error: 'Chat input not found', hint: 'Conversation page did not expose the Notion AI input.', action: nav.action || ('bun-browser open ' + h.buildConversationUrl(conversationId)) };
  }

  if (!waitOnly && h.isChatInProgress()) {
    return {
      error: 'Tab busy',
      kind: 'chat_in_progress',
      hint: 'This thread is still generating a reply. Retry with waitOnly: true instead of sending a new prompt.',
      action: 'retry with waitOnly: true',
      conversationId: conversationId,
      generating: true
    };
  }

  var modeResult = await h.setNotionMode(modeId);
  if (!modeResult.ok) {
    return {
      error: 'Mode selection failed',
      hint: modeResult.hint || modeResult.error || ('Could not select model "' + modeId + '"'),
      requestedMode: modeId,
      action: 'bun-browser site notion/models'
    };
  }
  waitOpts.mode = modeId;
${trustDrainBlock}
${attachBlock}
  var beforeCount = h.getAssistantMessagesSinceLastUser().length;
  var beforeText = h.getAssistantMessagesSinceLastUser().map(h.getAssistantText).join('\\n');

  var submitResult = await h.submitChatPrompt(queryText, beforeCount, beforeText, waitOpts);
  if (!submitResult.ok) {
    if (submitResult.kind) return submitResult;
    return {
      error: submitResult.error || 'Submit failed',
      hint: submitResult.hint || 'Could not submit the Notion AI prompt.',
      action: submitResult.action || ('bun-browser open ' + h.buildConversationUrl(conversationId))
    };
  }
${trustDrainBlock}
  waitOpts.query = queryText;
  var answer = await h.waitForAssistantAnswer(beforeCount, beforeText, waitOpts);
  if (!answer) {
${emptyAnswerRecoveryBlock}  }
${incompleteJsonRejectBlock}${modelFallbackChatfollowBlock}  if (!answer) {
    var answerAbnormal = h.getLastWaitAbnormal();
    if (answerAbnormal) return answerAbnormal;
    if (h.wasLastWaitPending()) {
      return attachCaptureWarning({ error: 'Still generating', hint: 'Notion AI is still generating. Retry with waitOnly: true.', action: 'retry with waitOnly: true' }, true);
    }
    return attachCaptureWarning({ error: 'Empty response', hint: 'Notion AI returned no content.', action: 'bun-browser open ' + h.buildConversationUrl(conversationId) }, true);
  }

  var out = {
    query: queryText,
    conversationId: conversationId,
    model: modeId,
    modeTitle: modeResult.modeTitle || null,
    modeLabel: modeResult.label || h.readNotionModeLabel(),
    answer: answer,
    turn: h.getAssistantMessages().length,
    url: location.href
  };
  if (attachedItems) out.attachments = attachedItems;
  var followTrustAccepted = h.getLastUrlTrustAccepts();
  if (followTrustAccepted.length) out.urlTrustAccepted = followTrustAccepted;
${attachAnswerFieldsBlock('out', 'queryText')}${modelFallbackOutField}${restoreComposerBlock}  return attachCaptureWarning(out, false);`
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
  var nav = await h.ensureNotionModelListView();
  if (!nav.ok) {
    return nav;
  }

  if (!h.findModelPickerButton()) {
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
${restoreComposerBlock}  return {
    defaultModelId: 'auto',
    current: listed.current || 'Auto',
    available: models.map(function(m) { return m.id; }),
    models: models
  };`
  )
);

writeFileSync(
  join(root, "mode.js"),
  makeFile(
    `/* @meta
{
  "name": "notion/mode",
  "description": "List or set Notion AI behavior mode from Settings (default, ask, plan, research)",
  "domain": "app.notion.com",
  "args": {
    "mode": {"required": false, "description": "Behavior mode to select: default, ask, plan, research. Omit to list current and available modes."},
    "selectOnly": {"required": false, "description": "Only select mode; skip listing extras when mode is provided (default false)"}
  },
  "capabilities": ["network"],
  "readOnly": true,
  "example": "bun-browser site notion/mode --mode ask"
}
*/`,
    `${loginBlock}
${installBlock}
  function parseBool(val, defaultVal) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (val === true || val === false) return val;
    var s = String(val).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return defaultVal;
  }

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
      error: 'Chat input not found',
      hint: 'Notion AI chat view did not load. Open the sidebar Chat tab and retry.',
      action: 'bun-browser open https://app.notion.com/ai'
    };
  }

  var selectOnly = parseBool(args.selectOnly, false);
  if (args.mode) {
    var modeId = h.resolveNotionBehaviorMode(args.mode);
    var selectResult = await h.setNotionBehaviorMode(modeId);
    if (!selectResult.ok) {
      return {
        error: 'Behavior mode selection failed',
        hint: selectResult.hint || selectResult.error || ('Could not select mode "' + modeId + '"'),
        requestedMode: modeId,
        action: 'bun-browser site notion/mode'
      };
    }
    if (selectOnly) {
      return {
        mode: modeId,
        modeTitle: selectResult.modeTitle || null,
        modeLabel: selectResult.label || modeId,
        selected: true,
        selectOnly: true
      };
    }
  }

  var listed = await h.listNotionBehaviorModesFromUi();
  var modes = listed.modes || [];
  return {
    defaultModeId: 'default',
    current: listed.current || 'Default',
    available: modes.map(function(m) { return m.id; }),
    modes: modes,
    warning: listed.warning || null,
    selected: !!args.mode,
    modeLabel: listed.current || 'Default'
  };`
  )
);

console.log("Wrote chat.js, chatfollow.js, models.js, and mode.js");
