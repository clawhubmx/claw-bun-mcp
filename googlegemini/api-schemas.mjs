/**
 * Response shape validators for googlegemini site adapters.
 * Used by scripts/run-api-flow.mjs and unit tests.
 */

const HEX_ID = /^[0-9a-f]+$/i;

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isHexConversationId(value) {
  return typeof value === "string" && HEX_ID.test(value);
}

export function isGeminiAppUrl(value, conversationId) {
  if (typeof value !== "string") return false;
  if (!value.startsWith("https://gemini.google.com/app/")) return false;
  if (!conversationId) return true;
  return value.endsWith("/" + conversationId.toLowerCase());
}

export function validateViewport(viewport, errors, prefix = "viewport") {
  if (!isObject(viewport)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (typeof viewport.width !== "number" || viewport.width <= 0) {
    errors.push(`${prefix}.width must be a positive number`);
  }
  if (typeof viewport.height !== "number" || viewport.height <= 0) {
    errors.push(`${prefix}.height must be a positive number`);
  }
  if (viewport.layout !== "mobile" && viewport.layout !== "desktop") {
    errors.push(`${prefix}.layout must be "mobile" or "desktop"`);
  }
}

export function validateLoginFields(data, errors) {
  if (typeof data.loggedIn !== "boolean") errors.push("loggedIn must be boolean");
  if (typeof data.anonymous !== "boolean") errors.push("anonymous must be boolean");
}

export function validateHealth(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (typeof data.ok !== "boolean") errors.push("ok must be boolean");
  validateLoginFields(data, errors);
  if (typeof data.chatInput !== "boolean") errors.push("chatInput must be boolean");
  if (typeof data.submitEnabled !== "boolean") errors.push("submitEnabled must be boolean");
  if (data.ok === true && !data.chatInput) errors.push("ok:true requires chatInput:true");
  if (data.ok === true && !data.submitEnabled) errors.push("ok:true requires submitEnabled:true");
  return { ok: errors.length === 0, errors, data };
}

export function validateModes(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (!Array.isArray(data.modes)) errors.push("modes must be an array");
  if (!Array.isArray(data.available)) errors.push("available must be an array");
  if (!isNonEmptyString(String(data.current || "")) && data.current !== null) {
    errors.push("current must be a non-empty string or null");
  }
  validateLoginFields(data, errors);
  return { ok: errors.length === 0, errors, data };
}

export function validateChatResponse(data, opts = {}) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };

  if (!isNonEmptyString(data.query)) errors.push("query must be a non-empty string");
  if (!isNonEmptyString(data.answer)) errors.push("answer must be a non-empty string");
  if (!isHexConversationId(data.conversationId)) {
    errors.push("conversationId must be a hex string");
  }
  if (typeof data.loggedIn !== "boolean") errors.push("loggedIn must be boolean");

  if (opts.expectExact && opts.exactText) {
    const answer = String(data.answer).trim();
    if (answer !== opts.exactText) {
      errors.push(`answer must be exactly "${opts.exactText}", got "${answer.slice(0, 80)}"`);
    }
  }

  if (opts.expectJson) {
    if (data.answerFormat !== "json") errors.push('answerFormat must be "json"');
    if (!isObject(data.answerJson)) errors.push("answerJson must be an object");
    if (opts.jsonShape && isObject(data.answerJson)) {
      for (const [key, type] of Object.entries(opts.jsonShape)) {
        if (!(key in data.answerJson)) errors.push(`answerJson missing key "${key}"`);
        else if (typeof data.answerJson[key] !== type) {
          errors.push(`answerJson.${key} must be ${type}`);
        }
      }
    }
    if (opts.jsonValues && isObject(data.answerJson)) {
      for (const [key, value] of Object.entries(opts.jsonValues)) {
        if (data.answerJson[key] !== value) {
          errors.push(`answerJson.${key} must be ${JSON.stringify(value)}`);
        }
      }
    }
  } else if (data.answerFormat === "json" && !opts.allowJson) {
    errors.push("unexpected answerFormat json");
  }

  if (opts.expectAttachments) {
    if (!Array.isArray(data.attachments) || !data.attachments.length) {
      errors.push("attachments must be a non-empty array");
    } else {
      const item = data.attachments[0];
      if (!isNonEmptyString(item.fileName)) errors.push("attachments[0].fileName required");
      if (!isNonEmptyString(item.fileId)) errors.push("attachments[0].fileId required");
    }
    if (data.transport !== "stream_generate") {
      errors.push('transport must be "stream_generate" when attachments present');
    }
  }

  return { ok: errors.length === 0, errors, data };
}

export function validateSearchResponse(data, opts = {}) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };

  if (opts.mode && data.mode !== opts.mode) {
    errors.push(`mode must be "${opts.mode}", got "${data.mode}"`);
  }
  if (!Array.isArray(data.results)) errors.push("results must be an array");
  if (typeof data.count !== "number") errors.push("count must be a number");
  validateViewport(data.viewport, errors);
  validateLoginFields(data, errors);

  if (opts.expectResolvedId && Array.isArray(data.results)) {
    const resolved = data.results.find((r) => isHexConversationId(r.conversationId));
    if (!resolved) errors.push("expected at least one result with conversationId");
    else if (!isGeminiAppUrl(resolved.url, resolved.conversationId)) {
      errors.push("resolved result url must match conversationId");
    }
  }

  if (Array.isArray(data.results)) {
    for (let i = 0; i < Math.min(data.results.length, 3); i++) {
      const row = data.results[i];
      if (!isObject(row)) errors.push(`results[${i}] must be an object`);
      else if (!isNonEmptyString(row.title)) errors.push(`results[${i}].title required`);
    }
  }

  return { ok: errors.length === 0, errors, data };
}

export function validateLibraryResponse(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };

  if (!["all", "media", "documents"].includes(data.section)) {
    errors.push('section must be "all", "media", or "documents"');
  }
  if (typeof data.count !== "number") errors.push("count must be a number");
  if (typeof data.empty !== "boolean") errors.push("empty must be boolean");
  if (!Array.isArray(data.media)) errors.push("media must be an array");
  if (!Array.isArray(data.documents)) errors.push("documents must be an array");
  validateViewport(data.viewport, errors);
  validateLoginFields(data, errors);

  return { ok: errors.length === 0, errors, data };
}

export function validateBranchResponse(data, opts = {}) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };

  if (!isHexConversationId(data.sourceConversationId)) {
    errors.push("sourceConversationId must be a hex string");
  }
  if (!isHexConversationId(data.conversationId)) {
    errors.push("conversationId must be a hex string");
  }
  if (
    isHexConversationId(data.sourceConversationId) &&
    isHexConversationId(data.conversationId) &&
    data.sourceConversationId === data.conversationId
  ) {
    errors.push("conversationId must differ from sourceConversationId");
  }
  if (opts.sourceConversationId && data.sourceConversationId !== opts.sourceConversationId.toLowerCase()) {
    errors.push("sourceConversationId mismatch");
  }
  if (!isGeminiAppUrl(data.url, data.conversationId)) {
    errors.push("url must match conversationId");
  }
  if (!isNonEmptyString(data.title)) errors.push("title must be a non-empty string");
  if (typeof data.messageIndex !== "number") errors.push("messageIndex must be a number");
  if (typeof data.messagesCopied !== "number" || data.messagesCopied < 1) {
    errors.push("messagesCopied must be >= 1");
  }
  if (!isObject(data.snapshot)) errors.push("snapshot must be an object");
  else {
    if (!Array.isArray(data.snapshot.userQueries)) errors.push("snapshot.userQueries must be an array");
    if (!Array.isArray(data.snapshot.responses)) errors.push("snapshot.responses must be an array");
    if (typeof data.snapshot.turnCount !== "number" || data.snapshot.turnCount < 1) {
      errors.push("snapshot.turnCount must be >= 1");
    }
  }
  validateViewport(data.viewport, errors);
  validateLoginFields(data, errors);

  return { ok: errors.length === 0, errors, data };
}
