/**
 * Response shape validators for notion site adapters.
 * Used by scripts/run-api-flow.mjs and unit tests.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ABNORMAL_KINDS = new Set(["credits_exhausted", "rate_limit", "submit_disabled"]);

const PROGRESS_LINE_RE =
  /^(Notion AI finished\.?|(Searching|Reading|Browsing|Fetching|Thinking|Running)\b|\d+s)$/i;

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isUuidConversationId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isAbnormalResponse(data) {
  if (!isObject(data) || !data.error) return false;
  if (data.kind && ABNORMAL_KINDS.has(data.kind)) return true;
  return /credits exhausted|run out of free|rate limit|submission blocked/i.test(String(data.error));
}

export function isProgressLine(text) {
  const lines = String(text || "")
    .trim()
    .split("\n");
  return lines.some((line) => PROGRESS_LINE_RE.test(line.trim()));
}

export function looksLikeCompleteAnswer(text) {
  const t = String(text || "").trim();
  if (!t || isProgressLine(t)) return false;
  if (t.length < 2) return false;
  if (/^Auto$/i.test(t)) return false;
  if (/[.!?]/.test(t) && /[A-Za-z]{2,}/.test(t)) return true;
  return t.length >= 8;
}

export function validateAnswerComplete(answer) {
  const errors = [];
  if (!isNonEmptyString(answer)) {
    errors.push("answer must be a non-empty string");
    return { ok: false, errors };
  }
  if (isProgressLine(answer)) errors.push("answer contains progress lines");
  if (!looksLikeCompleteAnswer(answer)) errors.push("answer does not look complete");
  return { ok: errors.length === 0, errors };
}

export function validateHealth(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (typeof data.ok !== "boolean") errors.push("ok must be boolean");
  if (typeof data.chatInput !== "boolean") errors.push("chatInput must be boolean");
  if (typeof data.submitEnabled !== "boolean") errors.push("submitEnabled must be boolean");
  if (typeof data.apiReachable !== "boolean") errors.push("apiReachable must be boolean");
  if (data.ok === true && !data.chatInput) errors.push("ok:true requires chatInput:true");
  return { ok: errors.length === 0, errors, data };
}

export function validateModels(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (data.warning) errors.push(String(data.warning));
  if (data.defaultModelId !== "auto") errors.push('defaultModelId must be "auto"');
  if (!isNonEmptyString(data.current)) errors.push("current must be a non-empty string");
  if (!Array.isArray(data.models)) errors.push("models must be an array");
  if (!Array.isArray(data.available)) errors.push("available must be an array");
  if (Array.isArray(data.models)) {
    if (!data.models.length) errors.push("models must not be empty");
    for (let i = 0; i < data.models.length; i++) {
      const row = data.models[i];
      if (!isObject(row)) errors.push(`models[${i}] must be an object`);
      else {
        if (!isNonEmptyString(row.id)) errors.push(`models[${i}].id required`);
        if (!isNonEmptyString(row.title)) errors.push(`models[${i}].title required`);
        if (row.available !== true) errors.push(`models[${i}].available must be true`);
        if (typeof row.mapped !== "boolean") errors.push(`models[${i}].mapped must be boolean`);
      }
    }
    if (Array.isArray(data.available) && data.models.length) {
      const ids = data.models.map((m) => m.id);
      for (const id of data.available) {
        if (!ids.includes(id)) errors.push(`available contains unknown id "${id}"`);
      }
    }
  }
  return { ok: errors.length === 0, errors, data };
}

export function validateChatResponse(data, opts = {}) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };

  if (!opts.allowSelectOnly && !isNonEmptyString(data.query)) {
    errors.push("query must be a non-empty string");
  }
  if (!isNonEmptyString(data.answer)) errors.push("answer must be a non-empty string");
  if (!isUuidConversationId(data.conversationId)) {
    errors.push("conversationId must be a UUID string");
  }
  if (!isNonEmptyString(data.modeLabel)) errors.push("modeLabel must be a non-empty string");

  if (data.attachments != null) {
    if (!Array.isArray(data.attachments)) {
      errors.push("attachments must be an array when present");
    } else {
      for (let i = 0; i < data.attachments.length; i++) {
        const item = data.attachments[i];
        if (!isObject(item)) {
          errors.push(`attachments[${i}] must be an object`);
          continue;
        }
        if (item.type !== "file" && item.type !== "page") {
          errors.push(`attachments[${i}].type must be "file" or "page"`);
        }
        if (item.type === "file" && !isNonEmptyString(item.fileName)) {
          errors.push(`attachments[${i}].fileName required for file attachments`);
        }
        if (item.type === "page" && !isNonEmptyString(item.title)) {
          errors.push(`attachments[${i}].title required for page attachments`);
        }
      }
    }
  }

  if (opts.expectExact && opts.exactText) {
    const answer = String(data.answer).trim();
    if (answer !== opts.exactText) {
      errors.push(`answer must be exactly "${opts.exactText}", got "${answer.slice(0, 80)}"`);
    }
  }

  const complete = validateAnswerComplete(data.answer);
  if (!complete.ok) errors.push(...complete.errors);

  return { ok: errors.length === 0, errors, data };
}

export function validateModelSelection(data, expectedTitle) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (data.selected !== true) errors.push("selected must be true");
  if (!isNonEmptyString(data.modeLabel)) errors.push("modeLabel must be a non-empty string");
  if (expectedTitle && data.modeLabel !== expectedTitle) {
    errors.push(`modeLabel must be "${expectedTitle}", got "${data.modeLabel}"`);
  }
  return { ok: errors.length === 0, errors, data };
}

export function validateAbnormal(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (!data.error) return { ok: false, errors: ["error field required for abnormal response"], data };
  if (!data.kind || !ABNORMAL_KINDS.has(data.kind)) {
    errors.push(`kind must be one of: ${[...ABNORMAL_KINDS].join(", ")}`);
  }
  if (!isNonEmptyString(data.hint)) errors.push("hint must be a non-empty string");
  if (!isNonEmptyString(data.action)) errors.push("action must be a non-empty string");
  return { ok: errors.length === 0, errors, data };
}

export function validateSearchResponse(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (!Array.isArray(data.results)) errors.push("results must be an array");
  if (typeof data.count !== "number") errors.push("count must be a number");
  return { ok: errors.length === 0, errors, data };
}

export const NOTION_BEHAVIOR_MODE_ALIASES = {
  default: "Default",
  ask: "Ask",
  plan: "Plan",
  research: "Research",
};

export function validateBehaviorModes(data) {
  const errors = [];
  if (!isObject(data)) return { ok: false, errors: ["response must be an object"] };
  if (data.error) return { ok: false, errors: [String(data.error)], data };
  if (data.defaultModeId !== "default") errors.push('defaultModeId must be "default"');
  if (!isNonEmptyString(data.current)) errors.push("current must be a non-empty string");
  if (!Array.isArray(data.modes)) errors.push("modes must be an array");
  if (Array.isArray(data.modes)) {
    if (!data.modes.length) errors.push("modes must not be empty");
    for (let i = 0; i < data.modes.length; i++) {
      const row = data.modes[i];
      if (!isObject(row)) errors.push(`modes[${i}] must be an object`);
      else {
        if (!isNonEmptyString(row.id)) errors.push(`modes[${i}].id required`);
        if (!isNonEmptyString(row.title)) errors.push(`modes[${i}].title required`);
        if (row.available !== true) errors.push(`modes[${i}].available must be true`);
        if (typeof row.mapped !== "boolean") errors.push(`modes[${i}].mapped must be boolean`);
      }
    }
  }
  return { ok: errors.length === 0, errors, data };
}

/** Known alias map for drift checks in run-api-flow.mjs */
export const NOTION_MODE_ALIASES = {
  auto: "Auto",
  sonnet: "Sonnet 4.6",
  "sonnet-4.6": "Sonnet 4.6",
  opus: "Opus 4.7",
  "opus-4.7": "Opus 4.7",
  "opus-4.8": "Opus 4.8",
  fable: "Fable 5",
  "fable-5": "Fable 5",
  gemini: "Gemini 3.1 Pro",
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.5": "GPT-5.5",
  grok: "Grok 4.3",
  "grok-4.3": "Grok 4.3",
  "grok-build": "Grok Build 0.1",
  kimi: "Kimi K2.6",
  "kimi-k2.6": "Kimi K2.6",
  deepseek: "DeepSeek V4 Pro",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

export function modelTitleToId(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findUnmappedModels(models) {
  if (!Array.isArray(models)) return [];
  return models.filter((m) => m.mapped === false).map((m) => m.title);
}

export function findStaleAliases(models) {
  const liveTitles = new Set((models || []).map((m) => m.title));
  const aliasTitles = new Set(Object.values(NOTION_MODE_ALIASES));
  return [...aliasTitles].filter((title) => !liveTitles.has(title));
}
