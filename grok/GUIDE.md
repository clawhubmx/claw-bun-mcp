# Grok Project Agents 使用指南

Grok 的 **Projects**（项目）就是带自定义指令的 **Agent**。本指南说明如何：

1. 用 `grok/agents` 查找 Agent（获取 `id` 或 `url`）
2. 用 `grok/agent-memory-*` 管理 Agent 的 Personal files（知识文件）
3. 用 `grok/agent-chat` 在该 Agent 下提问
4. 用 `grok/search` 在历史对话中按关键词检索（可选）

## 前置条件

1. 已安装 [bun-browser](https://github.com/epiral/bun-browser)
2. Chrome 扩展已连接，daemon 在运行（`bun-browser status`）
3. 浏览器中已登录 [grok.com](https://grok.com/)（X / xAI 账号）

```bash
bun-browser open https://grok.com/ --tab current
```

## 相关命令

| 命令 | 作用 |
|------|------|
| `bun-browser site grok/agents` | 列出所有 Project Agent |
| `bun-browser site grok/agent-memory-list <agent>` | 列出 Agent Personal files |
| `bun-browser site grok/agent-memory-add <agent> --fileName ...` | 上传文件到 Personal files |
| `bun-browser site grok/agent-memory-remove <agent> --fileId ...` | 从 Personal files 移除文件 |
| `bun-browser site grok/agent-chat <agent> "<prompt>"` | 在指定 Agent 中提问（推荐） |
| `bun-browser site grok/chat "<prompt>"` | 向默认 Grok 聊天提问 |
| `bun-browser site grok/search "<keyword>"` | 在 Grok 对话历史中按关键词搜索 |
| `bun-browser site grok/modes` | 查看可用模型模式（fast / auto / expert 等） |

## 推荐工作流程

```
grok/agents              找到 Agent（name、id、url）
      ↓
grok/agent-memory-list   查看 / 确认 Personal files
grok/agent-memory-add    上传知识文件（可选）
      ↓
grok/agent-chat          传入 agent id 或 project URL + prompt
```

`grok/agent-chat` 会自动：

- 验证 agent 是否存在（`GET /rest/workspaces/{id}`）
- 导航到 `https://grok.com/project/{id}`
- 在该 Agent 的自定义指令上下文中发送消息并等待回复

**agent 参数格式**（二选一，均来自 `grok/agents` 返回）：

- UUID：`2262a42d-da6b-478d-843f-69f811626817`
- Project URL：`https://grok.com/project/2262a42d-da6b-478d-843f-69f811626817`

## Step 1：列出 Agent

```bash
bun-browser site grok/agents
```

返回示例：

```json
{
  "count": 45,
  "agents": [
    {
      "id": "2262a42d-da6b-478d-843f-69f811626817",
      "name": "prompt enhancer",
      "icon": "l:dollar-sign:pink",
      "preferredModel": null,
      "lastUseTime": "2025-08-22T06:32:02.932676Z",
      "hasInstructions": true,
      "instructionPreview": "You are an intelligent middleware layer that automatically applies the ACDQ ...",
      "url": "https://grok.com/project/2262a42d-da6b-478d-843f-69f811626817"
    }
  ]
}
```

### 按名称查找 Agent

用 `--jq` 过滤（需安装 [jq](https://jqlang.org/)）：

```bash
bun-browser site grok/agents --json --jq '.agents[] | select(.name == "prompt enhancer")'
```

模糊匹配：

```bash
bun-browser site grok/agents --json | jq '.agents[] | select(.name | test("prompt"; "i"))'
```

记下返回的 `id` 或 `url`，下一步传给 `grok/agent-chat`。

### 可选参数

```bash
# 拉取更多 Project
bun-browser site grok/agents --pageSize 200

# 包含共享 Project
bun-browser site grok/agents --includeShared true

# 包含无名称的空 Project
bun-browser site grok/agents --includeEmpty true
```

## Step 2：在 Agent 下提问

```bash
bun-browser site grok/agent-chat 2262a42d-da6b-478d-843f-69f811626817 "my dream is becoming a doctor"
```

或使用完整 Project URL：

```bash
bun-browser site grok/agent-chat "https://grok.com/project/2262a42d-da6b-478d-843f-69f811626817" "my dream is becoming a doctor"
```

**参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `agent` | 是 | Agent UUID 或 `https://grok.com/project/{id}`（来自 `grok/agents`） |
| `query` | 是 | 你的问题或 prompt |
| `--model` | 否 | 覆盖模型：`fast` / `auto` / `expert`（默认 `fast`） |
| `--disableSearch` | 否 | 设为 `true` 关闭网页搜索 |
| `--newChat` | 否 | 是否在 Project 内开新对话（默认 `false`） |

Agent 若配置了 `preferredModel`，可在 Step 1 结果里查看；需要时可手动指定：

```bash
bun-browser site grok/agent-chat 2262a42d-da6b-478d-843f-69f811626817 "my dream is becoming a doctor" --model auto
```

## 完整示例：prompt enhancer

**prompt enhancer** 会把简单输入改写成 ACDQ 框架（Act, Context, Deeply, Questions）下的高质量 prompt。

```bash
# 1. 查找 Agent
bun-browser site grok/agents --json --jq '.agents[] | select(.name == "prompt enhancer")'

# 2. 用 id 提问
bun-browser site grok/agent-chat 2262a42d-da6b-478d-843f-69f811626817 "my dream is becoming a doctor"
```

返回字段：

```json
{
  "agentId": "2262a42d-da6b-478d-843f-69f811626817",
  "agentName": "prompt enhancer",
  "url": "https://grok.com/project/2262a42d-da6b-478d-843f-69f811626817",
  "query": "my dream is becoming a doctor",
  "model": "fast",
  "answer": "...",
  "conversationId": "5c375edc-a6aa-40f5-bc7c-4f2c866c6b36"
}
```

`answer` 即该 Agent 在 Project 上下文中的回复；`conversationId` 可用于在浏览器中继续同一会话。

## Agent Personal files（agent-memory）

Grok Project 的 **Personal files** 是持久 attached 到 Agent 的知识文件。Adapter 通过 grok.com 内部 REST API 管理（需已登录浏览器 session）：

- 列出：`GET /rest/assets?workspaceId={id}`
- 上传：`POST /rest/app-chat/upload-file` → `POST /rest/assets?workspaceId={id}` → `POST /rest/workspaces/{id}/assets`
- 移除：`DELETE /rest/assets/{assetId}?workspaceId={id}`

`fileId` 即 list 返回的 `assetId`。

### 工作流程

```bash
# 1. 获取 agent id
bun-browser site grok/agents

# 2. 查看已有 Personal files
bun-browser site grok/agent-memory-list 2262a42d-da6b-478d-843f-69f811626817

# 3. 上传文本文件
bun-browser site grok/agent-memory-add 2262a42d-da6b-478d-843f-69f811626817 \
  --fileName memory.md --content "$(cat memory.md)"

# 4. 上传 PDF（binary）
bun-browser site grok/agent-memory-add 2262a42d-da6b-478d-843f-69f811626817 \
  --fileName doc.pdf \
  --fileBase64 "$(base64 -i doc.pdf)" \
  --mimeType application/pdf

# 5. 移除文件（用 list 返回的 fileId，或直接用文件名 positional）
bun-browser site grok/agent-memory-remove 2262a42d-da6b-478d-843f-69f811626817 \
  --fileId <assetId>
# 或按文件名（positional，因 CLI 不转发未知 --flag）：
bun-browser site grok/agent-memory-remove 2262a42d-da6b-478d-843f-69f811626817 memory.md
```

### agent-memory-list

```bash
bun-browser site grok/agent-memory-list <agent>
```

返回示例：

```json
{
  "agentId": "2262a42d-da6b-478d-843f-69f811626817",
  "agentName": "prompt enhancer",
  "count": 2,
  "files": [
    {
      "fileId": "abc123",
      "fileName": "memory.md",
      "sizeBytes": 1234,
      "mimeType": "text/markdown",
      "uploadTime": "2026-05-22T10:00:00.000Z",
      "url": "https://grok.com/project/2262a42d-..."
    }
  ]
}
```

### agent-memory-add 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `agent` | 是 | Agent UUID 或 project URL |
| `fileName` | 是 | 目标文件名 |
| `--content` | 二选一 | 文本文件内容 |
| `--fileBase64` | 二选一 | Base64 编码的二进制内容 |
| `--mimeType` | 否 | MIME 类型（默认按扩展名推断） |

单文件上限约 48 MB。

### agent-memory-remove 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `agent` | 是 | Agent UUID 或 project URL |
| `--fileId` | 二选一 | 来自 list 的 fileId |
| `--fileName` | 二选一 | 按文件名匹配（唯一时可用） |

### 常见错误

| 错误 | 处理 |
|------|------|
| `Not logged in` | 在 Chrome 中登录 grok.com |
| `Agent not found` | 用 `grok/agents` 确认 id |
| `Missing file payload` | add 时必须提供 `--content` 或 `--fileBase64` 之一 |
| `File not found` | 用 `grok/agent-memory-list` 确认 fileId |
| `HTTP 403` / anti-bot | 在浏览器打开 grok.com 完成验证 |

## 搜索对话历史 (grok/search)

在已登录的 grok.com 账号下，按关键词搜索**全部 Grok 聊天历史**（含默认聊天与各 Project 内的对话）。只读，不发送新消息。

### 基本用法

```bash
bun-browser site grok/search "doctor"
```

**参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `query` | 是 | 搜索关键词（匹配历史对话标题与内容） |
| `--pageSize` | 否 | 每页条数，默认 `20`，最大 `60` |
| `--pageToken` | 否 | 上一页返回的 `nextPageToken`，用于翻页 |

### 返回示例

```json
{
  "query": "doctor",
  "count": 3,
  "nextPageToken": "eyJ...",
  "results": [
    {
      "conversationId": "5c375edc-a6aa-40f5-bc7c-4f2c866c6b36",
      "title": "Career advice",
      "highlight": "...my dream is becoming a <em>doctor</em>...",
      "matchType": "CONTENT",
      "matchedWords": ["doctor"],
      "matchedResponseId": "abc123",
      "createTime": "2025-08-20T10:00:00.000Z",
      "modifyTime": "2025-08-22T06:32:02.932676Z",
      "starred": false,
      "projects": [
        {
          "id": "2262a42d-da6b-478d-843f-69f811626817",
          "url": "https://grok.com/project/2262a42d-da6b-478d-843f-69f811626817"
        }
      ],
      "url": "https://grok.com/c/5c375edc-a6aa-40f5-bc7c-4f2c866c6b36?rid=abc123"
    }
  ]
}
```

字段含义：

| 字段 | 说明 |
|------|------|
| `title` | 对话标题 |
| `highlight` | 命中片段（含 HTML 高亮标签） |
| `matchType` | 匹配类型（如标题或正文） |
| `matchedWords` | 命中的词列表 |
| `url` | 在浏览器中打开该条对话的链接（含 `rid` 时定位到具体回复） |
| `projects` | 若对话属于某个 Project，会列出 Agent 的 `id` 与 `url` |
| `nextPageToken` | 非空表示还有下一页 |

### 翻页

```bash
# 第一页
bun-browser site grok/search "doctor" --pageSize 40

# 用返回的 nextPageToken 拉下一页
bun-browser site grok/search "doctor" --pageToken "eyJ..."
```

### 与 Agent 工作流配合

1. 用 `grok/search` 找到曾经讨论过某主题的 `conversationId` 或 Project `id`
2. 若 `results[].projects` 非空，可用其中的 `id` 继续 `grok/agent-chat` 提问
3. 用 `results[].url` 在浏览器中打开原对话：

```bash
bun-browser open "https://grok.com/c/5c375edc-a6aa-40f5-bc7c-4f2c866c6b36" --tab current
```

### 按条件过滤（jq）

```bash
# 只显示属于某个 Project 的命中
bun-browser site grok/search "doctor" --json | jq '.results[] | select(.projects != null)'

# 只取对话链接
bun-browser site grok/search "doctor" --json --jq '.results[].url' -r
```

## 一键脚本（可选）

按 Agent 名称查找并提问：

```bash
AGENT_NAME="prompt enhancer"
PROMPT="my dream is becoming a doctor"

AGENT_ID=$(bun-browser site grok/agents --json --jq --arg n "$AGENT_NAME" \
  '.agents[] | select(.name == $n) | .id' -r)

bun-browser site grok/agent-chat "$AGENT_ID" "$PROMPT"
```

## 备选方式：手动 open + grok/chat

若需要在浏览器里先手动查看 Project 页面，仍可使用旧流程：

```bash
bun-browser open "https://grok.com/project/2262a42d-da6b-478d-843f-69f811626817" --tab current
bun-browser site grok/chat "my dream is becoming a doctor" --newChat false
```

注意：`grok/chat` 默认 `--newChat true`，在 Agent 场景下必须显式传 `--newChat false`，否则可能离开 Project 上下文。一般情况请直接用 `grok/agent-chat`。

## 常见问题

### `Not logged in`

```json
{
  "error": "Not logged in",
  "hint": "需要先在浏览器中登录 grok.com（X/xAI 账号）",
  "action": "bun-browser open https://grok.com/"
}
```

在 Chrome 中登录 grok.com 后重试。

### `Invalid agent id`

`agent` 必须是 UUID 或 `https://grok.com/project/{uuid}` 格式。先用 `grok/agents` 获取正确的 `id` / `url`。

### `Agent not found`

```json
{
  "error": "Agent not found",
  "hint": "该 agent id 不存在或无权访问，请用 grok/agents 查看可用列表",
  "action": "bun-browser site grok/agents"
}
```

确认 id 来自你自己的 `grok/agents` 列表，且账号有访问权限。

### 回复不像 Agent，像默认 Grok

- 确认使用的是 `grok/agent-chat`，而不是默认的 `grok/chat`
- 确认 `grok/agents` 里该 Agent 的 `hasInstructions` 为 `true`
- 检查返回 JSON 中的 `agentName` 是否为目标 Agent

### `Chat input not found`

Agent 页面尚未加载完，稍后重试即可（`grok/agent-chat` 会自动导航并等待）。若仍失败：

```bash
bun-browser open "https://grok.com/project/<id>" --tab current
bun-browser site grok/agent-chat "<id>" "your prompt"
```

### 找不到 Agent 名称

名称区分大小写，必须与 `grok/agents` 返回的 `name` 完全一致。可先列出所有名称：

```bash
bun-browser site grok/agents --json --jq '.agents[].name'
```

### 搜索无结果或 `count` 为 0

- 确认关键词与 grok.com 网页端「历史搜索」能搜到的一致（adapter 调用同一 REST 接口）
- 尝试更短或更通用的词；历史里可能用的是别的表述
- 若刚完成新对话，稍等片刻再搜（索引可能有延迟）

### `Anti-bot verification required`

与登录类错误类似：在 Chrome 中打开 grok.com，完成人机验证并确保已登录后重试。

## 下一步

- 管理 Agent 知识文件：`bun-browser site grok/agent-memory-list <agent>`
- 搜索历史对话：`bun-browser site grok/search "关键词"`
- 查看模型能力：`bun-browser site grok/modes`
- 在默认 Grok 聊天（非 Project）中提问：`bun-browser site grok/chat "Hello"`
- 更新 adapter：`bun-browser site update`
