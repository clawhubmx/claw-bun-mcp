/* @meta
{
  "name": "grok/agent-memory-add",
  "description": "上传文件到 Agent Personal files (agent memory add: fileId, fileName, sizeBytes, uploadTime)",
  "domain": "grok.com",
  "args": {
    "agent": {"required": true, "description": "Agent UUID or project URL from grok/agents"},
    "fileName": {"required": true, "description": "Target filename (e.g. notes.md, doc.pdf)"},
    "content": {"required": false, "description": "Plain-text file body (for .txt, .md, .json, code)"},
    "fileBase64": {"required": false, "description": "Base64-encoded file bytes (for PDF/binary)"},
    "mimeType": {"required": false, "description": "MIME type (default inferred from fileName extension)"}
  },
  "capabilities": ["network"],
  "readOnly": false,
  "example": "bun-browser site grok/agent-memory-add 2262a42d-da6b-478d-843f-69f811626817 --fileName memory.md --content \"# My notes\""
}
*/

async function(args) {
  // API: POST upload-file → POST /rest/assets → POST /rest/workspaces/{id}/assets
  var helpers = globalThis.__grokMemoryHelpers;
  if (!helpers || !helpers.createAndLinkAsset) {
    await (async function(args) {
      return await (async function installViaList(a) {
        var h = globalThis.__grokMemoryHelpers;
        if (h && h.createAndLinkAsset) return h;
        var listResult = await (async function listBootstrap(args2) {
          var install = (function installGrokMemoryHelpers() {
            if (globalThis.__grokMemoryHelpers && globalThis.__grokMemoryHelpers.fetchWorkspaceAssets) return globalThis.__grokMemoryHelpers;
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
            function toIsoTime(value) {
              if (!value) return null;
              if (typeof value === 'string') { var d = new Date(value); return isNaN(d.getTime()) ? value : d.toISOString(); }
              if (typeof value === 'number') { var sec = value > 1e12 ? value : value * 1000; return new Date(sec).toISOString(); }
              return null;
            }
            function normalizeAssetEntry(raw, agentId) {
              if (!raw || typeof raw !== 'object') return null;
              var fileId = raw.assetId || raw.fileMetadataId || raw.fileId || raw.id || null;
              if (!fileId) return null;
              return { fileId: fileId, fileName: raw.name || raw.fileName || raw.filename || null, sizeBytes: raw.sizeBytes != null ? raw.sizeBytes : null, mimeType: raw.mimeType || raw.fileMimeType || raw.contentType || null, uploadTime: toIsoTime(raw.createTime || raw.createdAt || raw.uploadTime), url: 'https://grok.com/project/' + agentId };
            }
            function extractFilesFromAssets(assets, agentId) {
              if (!Array.isArray(assets)) return [];
              return assets.map(function(entry) { return normalizeAssetEntry(entry, agentId); }).filter(Boolean);
            }
            async function fetchWorkspace(agentId) {
              var resp = await fetch('/rest/workspaces/' + agentId, { method: 'GET', credentials: 'include' });
              if (resp.status === 404) return { error: 'Agent not found', hint: '该 agent id 不存在或无权访问，请用 grok/agents 查看可用列表', action: 'bun-browser site grok/agents' };
              if (!resp.ok) return readResponseError(resp);
              try { return { workspace: await resp.json() }; } catch (e) { return { error: 'Invalid JSON response', hint: 'Grok /rest/workspaces 返回格式异常，请刷新页面后重试', action: 'bun-browser open https://grok.com/' }; }
            }
            async function fetchWorkspaceAssets(agentId) {
              var resp = await fetch('/rest/assets?workspaceId=' + agentId, { method: 'GET', credentials: 'include' });
              if (!resp.ok) return readResponseError(resp);
              try { var data = await resp.json(); return { assets: Array.isArray(data.assets) ? data.assets : [] }; } catch (e) { return { error: 'Invalid JSON response', hint: 'Grok /rest/assets 返回格式异常，请刷新页面后重试', action: 'bun-browser open https://grok.com/' }; }
            }
            function guessMimeType(fileName) {
              var name = String(fileName || '').toLowerCase();
              var ext = name.indexOf('.') === -1 ? '' : name.slice(name.lastIndexOf('.'));
              var map = { '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html', '.js': 'application/javascript', '.ts': 'application/typescript', '.py': 'text/x-python', '.xml': 'application/xml', '.yaml': 'application/yaml', '.yml': 'application/yaml' };
              return map[ext] || 'application/octet-stream';
            }
            function decodeBase64Bytes(base64) {
              var binary = atob(String(base64).replace(/\s+/g, ''));
              var bytes = new Uint8Array(binary.length);
              for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              return bytes;
            }
            async function uploadFileContent(fileName, mimeType, bytes) {
              var maxBytes = 48 * 1024 * 1024;
              if (!bytes || !bytes.length) return { error: 'Empty file', hint: '文件内容为空，请提供有效的 content 或 fileBase64' };
              if (bytes.length > maxBytes) return { error: 'File too large', hint: '单文件最大约 48 MB，请拆分后重试' };
              var base64 = '';
              var chunkSize = 0x8000;
              for (var i = 0; i < bytes.length; i += chunkSize) base64 += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
              base64 = btoa(base64);
              var resp = await fetch('/rest/app-chat/upload-file', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: fileName, fileMimeType: mimeType || guessMimeType(fileName), content: base64, fileSource: 'SELF_UPLOAD_FILE_SOURCE' }) });
              if (!resp.ok) return readResponseError(resp);
              var data;
              try { data = await resp.json(); } catch (e) { return { error: 'Invalid JSON response', hint: 'Grok /rest/app-chat/upload-file 返回格式异常', action: 'bun-browser open https://grok.com/' }; }
              if (!data.fileMetadataId) return { error: 'Upload failed', hint: '上传未返回 fileMetadataId，Grok API 可能已变更', action: 'bun-browser open https://grok.com/' };
              return { upload: data };
            }
            async function createAndLinkAsset(agentId, uploadData) {
              var createResp = await fetch('/rest/assets?workspaceId=' + agentId, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileMetadataId: uploadData.fileMetadataId, name: uploadData.fileName, mimeType: uploadData.fileMimeType }) });
              if (!createResp.ok) return readResponseError(createResp);
              var asset;
              try { asset = await createResp.json(); } catch (e) { return { error: 'Invalid JSON response', hint: 'Grok /rest/assets 返回格式异常', action: 'bun-browser open https://grok.com/' }; }
              if (!asset.assetId) return { error: 'Asset creation failed', hint: '创建 asset 未返回 assetId', action: 'bun-browser open https://grok.com/' };
              var linkResp = await fetch('/rest/workspaces/' + agentId + '/assets', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: asset.assetId }) });
              if (!linkResp.ok) return readResponseError(linkResp);
              return { asset: asset };
            }
            async function removeAsset(agentId, assetId) {
              var resp = await fetch('/rest/assets/' + assetId + '?workspaceId=' + agentId, { method: 'DELETE', credentials: 'include' });
              if (resp.status === 404) return { error: 'File not found', hint: '该 fileId 不在 Agent Personal files 中，请用 grok/agent-memory-list 查看', action: 'bun-browser site grok/agent-memory-list ' + agentId };
              if (!resp.ok) return readResponseError(resp);
              return { ok: true };
            }
            globalThis.__grokMemoryHelpers = { parseAgentId: parseAgentId, ensureLoggedIn: ensureLoggedIn, fetchWorkspace: fetchWorkspace, fetchWorkspaceAssets: fetchWorkspaceAssets, extractFilesFromAssets: extractFilesFromAssets, normalizeAssetEntry: normalizeAssetEntry, uploadFileContent: uploadFileContent, createAndLinkAsset: createAndLinkAsset, removeAsset: removeAsset, guessMimeType: guessMimeType, decodeBase64Bytes: decodeBase64Bytes };
            return globalThis.__grokMemoryHelpers;
          })();
          return install;
        })(a);
        return listResult;
      })(args);
    })(args);
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

  if (!args.fileName || !String(args.fileName).trim()) {
    return { error: 'Missing argument: fileName', hint: 'Provide a target filename, e.g. notes.md' };
  }

  var hasContent = args.content != null && String(args.content).length > 0;
  var hasBase64 = args.fileBase64 != null && String(args.fileBase64).trim().length > 0;
  if (hasContent === hasBase64) {
    return {
      error: 'Missing file payload',
      hint: 'Provide exactly one of --content (text) or --fileBase64 (binary)'
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

  var fileName = String(args.fileName).trim();
  var mimeType = args.mimeType ? String(args.mimeType) : helpers.guessMimeType(fileName);
  var bytes;
  if (hasContent) {
    bytes = new TextEncoder().encode(String(args.content));
  } else {
    try {
      bytes = helpers.decodeBase64Bytes(String(args.fileBase64));
    } catch (e) {
      return { error: 'Invalid fileBase64', hint: 'fileBase64 不是有效的 base64 编码' };
    }
  }

  var wsResult = await helpers.fetchWorkspace(agentId);
  if (wsResult.error) return wsResult;

  var uploadResult = await helpers.uploadFileContent(fileName, mimeType, bytes);
  if (uploadResult.error) return uploadResult;

  var uploadData = uploadResult.upload;
  uploadData.fileName = uploadData.fileName || fileName;
  uploadData.fileMimeType = uploadData.fileMimeType || mimeType;
  uploadData.sizeBytes = uploadData.sizeBytes != null ? uploadData.sizeBytes : bytes.length;

  var attachResult = await helpers.createAndLinkAsset(agentId, uploadData);
  if (attachResult.error) return attachResult;

  var asset = attachResult.asset;

  return {
    agentId: agentId,
    fileId: asset.assetId,
    fileName: asset.name || uploadData.fileName,
    sizeBytes: asset.sizeBytes != null ? asset.sizeBytes : uploadData.sizeBytes,
    mimeType: asset.mimeType || uploadData.fileMimeType,
    uploadTime: toIsoTimeSafe(asset.createTime || uploadData.createTime),
    url: 'https://grok.com/project/' + agentId,
    hint: '查看全部文件: bun-browser site grok/agent-memory-list ' + agentId
  };

  function toIsoTimeSafe(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toISOString();
  }
}
