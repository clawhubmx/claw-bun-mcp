/* @meta
{
  "name": "grok/agent-memory-remove",
  "description": "从 Agent Personal files 移除文件 (agent memory remove: removedFileId, fileName)",
  "domain": "grok.com",
  "args": {
    "agent": {"required": true, "description": "Agent UUID or project URL from grok/agents"},
    "fileId": {"required": false, "description": "File ID from grok/agent-memory-list output"},
    "fileName": {"required": false, "description": "Filename to remove (resolved via list if fileId omitted)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "bun-browser site grok/agent-memory-remove 2262a42d-da6b-478d-843f-69f811626817 notes.md"
}
*/

async function(args) {
  // API: DELETE /rest/assets/{assetId}?workspaceId={id}
  var helpers = globalThis.__grokMemoryHelpers;
  if (!helpers || !helpers.removeAsset) {
    await (async function() {
      if (globalThis.__grokMemoryHelpers && globalThis.__grokMemoryHelpers.removeAsset) return;
      await (async function(args) {
        var h = globalThis.__grokMemoryHelpers;
        if (h && h.removeAsset) return;
        (function installGrokMemoryHelpers() {
          if (globalThis.__grokMemoryHelpers && globalThis.__grokMemoryHelpers.removeAsset) return globalThis.__grokMemoryHelpers;
          function parseAgentId(raw) {
            if (!raw) return null;
            var text = String(raw).trim();
            var fromPath = text.match(/\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (fromPath) return fromPath[1].toLowerCase();
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return text.toLowerCase();
            return null;
          }
          function hasCookie(name) {
            return document.cookie.split(';').some(function(c) { return c.trim().startsWith(name + '='); });
          }
          function ensureLoggedIn() {
            if (hasCookie('sso') || hasCookie('x-userid')) return null;
            return { error: 'Not logged in', hint: '需要先在浏览器中登录 grok.com（X/xAI 账号）', action: 'bun-browser open https://grok.com/' };
          }
          async function readResponseError(resp) {
            var errText = '';
            try { errText = await resp.text(); } catch (e) {}
            if (resp.status === 403 || errText.indexOf('anti-bot') !== -1) {
              return { error: 'Anti-bot verification required', hint: 'Grok 拒绝了请求，请在浏览器中打开 grok.com 完成验证并登录', action: 'bun-browser open https://grok.com/' };
            }
            return { error: 'HTTP ' + resp.status, hint: 'Grok API 请求失败，请确认已登录 grok.com', action: 'bun-browser open https://grok.com/' };
          }
          function normalizeAssetEntry(raw, agentId) {
            if (!raw || typeof raw !== 'object') return null;
            var fileId = raw.assetId || raw.fileMetadataId || raw.fileId || raw.id || null;
            if (!fileId) return null;
            return { fileId: fileId, fileName: raw.name || raw.fileName || raw.filename || null, url: 'https://grok.com/project/' + agentId };
          }
          function extractFilesFromAssets(assets, agentId) {
            if (!Array.isArray(assets)) return [];
            return assets.map(function(entry) { return normalizeAssetEntry(entry, agentId); }).filter(Boolean);
          }
          async function fetchWorkspace(agentId) {
            var resp = await fetch('/rest/workspaces/' + agentId, { method: 'GET', credentials: 'include' });
            if (resp.status === 404) return { error: 'Agent not found', hint: '该 agent id 不存在或无权访问，请用 grok/agents 查看可用列表', action: 'bun-browser site grok/agents' };
            if (!resp.ok) return readResponseError(resp);
            try { return { workspace: await resp.json() }; } catch (e) { return { error: 'Invalid JSON response', hint: 'Grok /rest/workspaces 返回格式异常', action: 'bun-browser open https://grok.com/' }; }
          }
          async function fetchWorkspaceAssets(agentId) {
            var resp = await fetch('/rest/assets?workspaceId=' + agentId, { method: 'GET', credentials: 'include' });
            if (!resp.ok) return readResponseError(resp);
            try { var data = await resp.json(); return { assets: Array.isArray(data.assets) ? data.assets : [] }; } catch (e) { return { error: 'Invalid JSON response', hint: 'Grok /rest/assets 返回格式异常', action: 'bun-browser open https://grok.com/' }; }
          }
          async function removeAsset(agentId, assetId) {
            var resp = await fetch('/rest/assets/' + assetId + '?workspaceId=' + agentId, { method: 'DELETE', credentials: 'include' });
            if (resp.status === 404) return { error: 'File not found', hint: '该 fileId 不在 Agent Personal files 中，请用 grok/agent-memory-list 查看', action: 'bun-browser site grok/agent-memory-list ' + agentId };
            if (!resp.ok) return readResponseError(resp);
            return { ok: true };
          }
          globalThis.__grokMemoryHelpers = { parseAgentId: parseAgentId, ensureLoggedIn: ensureLoggedIn, fetchWorkspace: fetchWorkspace, fetchWorkspaceAssets: fetchWorkspaceAssets, extractFilesFromAssets: extractFilesFromAssets, removeAsset: removeAsset };
          return globalThis.__grokMemoryHelpers;
        })();
      })({ agent: args.agent });
    })();
    helpers = globalThis.__grokMemoryHelpers;
  }
  if (!helpers) {
    return { error: 'Helpers not loaded', hint: '请先打开 grok.com 并登录后重试', action: 'bun-browser open https://grok.com/' };
  }

  if (!args.agent) {
    return {
      error: 'Missing argument: agent',
      hint: 'Provide an agent id or project URL from bun-browser site grok/agents',
      action: 'bun-browser site grok/agents'
    };
  }

  var fileId = args.fileId ? String(args.fileId).trim() : '';
  var fileNameArg = args.fileName ? String(args.fileName).trim() : '';
  // CLI global parser drops unknown --flags; positional 2nd arg may land in fileId
  if (fileId && !fileNameArg && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
    fileNameArg = fileId;
    fileId = '';
  }
  if (!fileId && !fileNameArg) {
    return {
      error: 'Missing argument',
      hint: 'Provide --fileId or --fileName (from grok/agent-memory-list)',
      action: 'bun-browser site grok/agent-memory-list ' + (args.agent || '')
    };
  }

  var agentId = helpers.parseAgentId(args.agent);
  if (!agentId) {
    return {
      error: 'Invalid agent id',
      hint: 'agent 必须是 UUID 或 https://grok.com/project/{id} 格式的 URL',
      action: 'bun-browser site grok/agents'
    };
  }

  var loginErr = helpers.ensureLoggedIn();
  if (loginErr) return loginErr;

  var wsResult = await helpers.fetchWorkspace(agentId);
  if (wsResult.error) return wsResult;

  if (!fileId && fileNameArg) {
    if (!helpers.fetchWorkspaceAssets) {
      return { error: 'Internal error', hint: 'helpers.fetchWorkspaceAssets missing — run grok/agent-memory-list first' };
    }
    var assetsResult = await helpers.fetchWorkspaceAssets(agentId);
    if (assetsResult.error) return assetsResult;
    var files = helpers.extractFilesFromAssets(assetsResult.assets, agentId);
    var matches = files.filter(function(f) {
      return f.fileName && f.fileName.toLowerCase() === fileNameArg.toLowerCase();
    });
    if (matches.length === 0) {
      return {
        error: 'File not found',
        hint: '找不到名为 "' + fileNameArg + '" 的文件，请用 grok/agent-memory-list 确认',
        action: 'bun-browser site grok/agent-memory-list ' + agentId
      };
    }
    if (matches.length > 1) {
      return {
        error: 'Ambiguous fileName',
        hint: '存在多个同名文件，请改用 --fileId 指定',
        action: 'bun-browser site grok/agent-memory-list ' + agentId
      };
    }
    fileId = matches[0].fileId;
    fileNameArg = matches[0].fileName || fileNameArg;
  }

  var removeResult = await helpers.removeAsset(agentId, fileId);
  if (removeResult.error) return removeResult;

  return {
    agentId: agentId,
    removedFileId: fileId,
    fileName: fileNameArg || null,
    url: 'https://grok.com/project/' + agentId,
    hint: '查看剩余文件: bun-browser site grok/agent-memory-list ' + agentId
  };
}
