# Google Gemini 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里向 **[Google Gemini](https://gemini.google.com/)** 提问并读取回复。浏览器已登录 Google 账号时无需 API Key；未登录时也可匿名使用部分模型。

## 前置条件

1. 已安装 [bun-browser](https://github.com/epiral/bun-browser)
2. Chrome 扩展已连接，daemon 在运行（`bun-browser status`）
3. 在浏览器中打开 Gemini（建议登录 Google 账号以使用全部模型）

```bash
bun-browser open https://gemini.google.com/ --tab current
```

## 相关命令

| 命令 | 作用 |
|------|------|
| `bun-browser site googlegemini/chat "<prompt>"` | 向 Gemini 提问（推荐） |
| `bun-browser site googlegemini/chatfollow <conversation> "<prompt>"` | 在已有对话中继续提问 |
| `bun-browser site googlegemini/search [query] [limit] [resolveLimit]` | 列出最近对话或搜索聊天历史 |
| `bun-browser site googlegemini/library [section] [limit]` | 列出 Library（My Stuff）中的创作 |
| `bun-browser site googlegemini/modes` | 查看当前账号可用的模型 |
| `bun-browser site googlegemini/health` | 检查登录、Cloudflare、速率限制与发送按钮（不发送消息） |

## 模型模式 (googlegemini/modes)

Gemini 网页端支持多种模型，通过 `--model` 传给 `googlegemini/chat` 与 `googlegemini/chatfollow`。

### 查看可用模型

```bash
bun-browser site googlegemini/modes
```

### 常用模型 id

| id | UI 标题 | 说明 |
|----|---------|------|
| `flash` | 3.5 Flash | 默认，快速通用回复 |
| `thinking` | 3.5 Thinking | 复杂推理，耗时更长 |
| `pro` | 3.1 Pro | 数学与代码 |

别名：`3.5-flash`、`3.5-thinking`、`3.1-pro` 等会自动映射。

### 使用示例

```bash
# 默认 flash
bun-browser site googlegemini/chat "Hello"

# 深度思考
bun-browser site googlegemini/chat "Prove sqrt(2) is irrational" --model thinking

# 继续同一对话
bun-browser site googlegemini/chatfollow abc123def456 "Summarize in 3 bullets"
```

## 聊天历史 (googlegemini/search)

对应 Gemini 网页端的 **[Search chats](https://gemini.google.com/search)**，用于浏览最近对话或按关键词搜索。**不是** Library（My Stuff）。

### 列出最近对话

```bash
bun-browser site googlegemini/search
```

返回 `mode: "recent"`，每项含 `title`、`date`（不含 `conversationId`）。

### 搜索聊天

```bash
bun-browser site googlegemini/search "pandemic"
```

返回 `mode: "search"`，每项含 `title`、`snippet`、`date`，搜索词匹配处会有 `highlights`。有关键词时会自动解析前几条结果的 `conversationId` 与 `url`。

### 最近对话 + 解析 conversationId

用 `*` 作为 query 表示「最近列表 + 解析 ID」：

```bash
# 最近 5 条，解析前 3 条的 conversationId
bun-browser site googlegemini/search "*" 5 3
```

位置参数顺序：`query`、`limit`（默认 20）、`resolveLimit`（默认 5）。

### 返回字段

| 字段 | 说明 |
|------|------|
| `mode` | `recent` 或 `search` |
| `query` | 搜索词；最近列表为 `null` |
| `results` | 结果数组 |
| `results[].title` | 对话标题 |
| `results[].date` | 如 `Today` |
| `results[].snippet` | 搜索命中摘要（仅 search 模式） |
| `results[].highlights` | 高亮匹配词（仅 search 模式） |
| `results[].conversationId` | 十六进制对话 id（解析后才有） |
| `results[].url` | `https://gemini.google.com/app/{id}` |
| `viewport` | `{ width, height, layout }`，`layout` 为 `mobile` 或 `desktop` |

解析 `conversationId` 需要短暂点击导航，请保持 `gemini.google.com` 标签页可用。

## Library / My Stuff (googlegemini/library)

对应 **[Library](https://gemini.google.com/library)**（侧栏 My Stuff），存放 **创作物**，不是聊天记录：

- **Media**：生成的图片、视频
- **Documents**：Deep Research 报告、Canvas 文档与代码项目

完整文档列表页：`https://gemini.google.com/mystuff/documents`

### 使用示例

```bash
# 全部区块（Media + Documents）
bun-browser site googlegemini/library

# 仅 Media
bun-browser site googlegemini/library media

# 仅 Documents，最多 10 条
bun-browser site googlegemini/library documents 10
```

位置参数顺序：`section`（`all` / `media` / `documents`，默认 `all`）、`limit`（默认 20）。

### 返回字段

| 字段 | 说明 |
|------|------|
| `section` | 请求的区块 |
| `empty` | 是否为空（尚无创作） |
| `message` | 空状态文案（如 *Any documents or media you create will appear here*） |
| `media` | 媒体项：`title`、`type`（`media`）、`url` |
| `documents` | 文档项：`title`、`type`（`document` / `research` / `code`）、`url` |
| `viewport` | 当前视口与布局（见上文） |

## 外部内容与文件附件

`googlegemini/chat` 与 `googlegemini/chatfollow` 支持两类「外部输入」：

| 参数 | 作用 |
|------|------|
| `context` | 将外部文本以 `--- External context ---` 块拼接到 prompt 前（走 DOM 发送） |
| `fileName` + `fileContent` | 上传 UTF-8 文本文件并作为附件提问（走 `StreamGenerate`） |
| `fileName` + `fileBase64` | 上传二进制文件（base64）并作为附件提问 |

> **CLI 提示**：`bun-browser` 顶层会吞掉未知 `--flag`，附件参数请用**位置参数**按 meta 顺序传入（见下）。

### chat 位置参数顺序

`query` → `model` → `newChat` → `waitOnly` → `context` → `fileName` → `fileContent` → `fileBase64` → `maxWaitMs` → `graceWaitMs`

```bash
# 新对话 + 文本附件
bun-browser site googlegemini/chat \
  "List 2 facts from the attached file about Paris." \
  flash true false "" \
  notes.txt "The Eiffel Tower is in Paris, France."

# 仅附加外部 context（无文件）
bun-browser site googlegemini/chat \
  "Reply with exactly: CONTEXT-OK-123" \
  flash false false \
  "External note: the magic word is CONTEXT-OK-123"
```

### chatfollow 位置参数顺序

`conversation` → `query` → `model` → `waitOnly` → `context` → `fileName` → `fileContent` → `fileBase64` → `maxWaitMs` → `graceWaitMs`

```bash
bun-browser site googlegemini/chatfollow abc123def456 \
  "What is the secret in the attached file?" \
  flash false "" \
  followup.txt "The follow-up secret is GAMMA-77."
```

带文件时会通过 `content-push.googleapis.com` 上传，再用浏览器会话调用 `StreamGenerate`；**不需要**在 UI 里手动点 Upload。`chatfollow` 会通过 `hNvQHb` 读取对话 metadata，无需先打开该对话页（但 DOM 续聊仍建议先打开对应 URL）。

### 附件相关返回字段

| 字段 | 说明 |
|------|------|
| `attachments` | `[{ fileName, fileId, mimeType }]` |
| `transport` | 带文件时为 `stream_generate` |
| `context` | 为 `true` 表示使用了 `context` 参数 |

## 返回字段（chat / chatfollow）

成功时 JSON 包含：

| 字段 | 说明 |
|------|------|
| `query` | 发送的 prompt（含 context 块时已是合并后的文本） |
| `model` | 请求的 mode id |
| `modeLabel` | 页面模型选择器当前显示文字 |
| `answer` | 助手回复正文 |
| `answerJson` / `answerFormat` | 若回复含 JSON 块则解析 |
| `conversationId` | 对话 id（用于 chatfollow） |
| `attachments` / `transport` | 文件附件时才有（见上文） |
| `context` | 使用 `context` 参数时为 `true` |
| `loggedIn` | 是否检测到 Google 登录 cookie |
| `anonymous` | 是否为匿名会话（页面有 Sign in 按钮） |

## 多轮对话

1. 用 `googlegemini/chat` 发起首轮提问，记下返回的 `conversationId`
2. 或用 `googlegemini/search` 从历史中找到 `conversationId`
3. 用 `googlegemini/chatfollow <conversationId> "<follow-up>"` 继续

```bash
bun-browser site googlegemini/chat "What is the capital of France?"
# => conversationId: abc123...

# 或从历史搜索
bun-browser site googlegemini/search "France"
# => results[].conversationId

bun-browser site googlegemini/chatfollow abc123... "What is its population?"
```

`conversation` 参数支持纯 id 或 `https://gemini.google.com/app/{id}` URL。

## 长时间生成 / waitOnly

Thinking 模式或长回复可能仍在流式输出。若返回 `Still generating`：

```bash
bun-browser site googlegemini/chat "long task..." --model thinking
# 若超时或仍在生成：
bun-browser site googlegemini/chat "long task..." --waitOnly true
```

## 健康检查

```bash
bun-browser site googlegemini/health
```

不发送任何消息，检查：

- Google 登录 / 匿名状态
- Cloudflare 挑战页
- 速率限制文案
- 聊天输入框与 Send 按钮是否可用

## 窄屏 / 移动端布局

Gemini 网页在较窄窗口或带 `is-mobile` 标记时会收起侧栏。`search` 与 `library` 会：

- 在响应中返回 `viewport.layout`（`mobile` / `desktop`）
- 必要时自动打开或关闭侧栏，避免遮挡主内容
- 在 mobile 布局下使用略长的页面等待时间

建议自动化时保持标签页宽度 ≥ 768px，或直接访问 `/search`、`/library` 路径（adapter 会自动导航）。

## 登录说明

- **已登录 Google**：`loggedIn: true`，通常可使用更多模型，且可访问聊天历史与 Library
- **匿名**：`anonymous: true`，仍可使用 Flash / Thinking / Pro（视地区与 Google 政策而定），页面会显示 Sign in；历史搜索与 Library 可能受限

与 Grok 不同，Gemini **允许匿名聊天**，`health` 与 `chat` 不会在匿名时直接报错。

## 故障排查

| 现象 | 建议 |
|------|------|
| `Chat input not found` | `bun-browser open https://gemini.google.com/app` 后重试 |
| `Cloudflare verification required` | 在浏览器中手动完成验证 |
| `Still generating` | 加 `--waitOnly true` 继续等待 |
| `Mode selection failed` | 运行 `googlegemini/modes` 查看可用项 |
| `Search page not available` | `bun-browser open https://gemini.google.com/search` 后重试 |
| `Library page not available` | `bun-browser open https://gemini.google.com/library` 后重试 |
| `results` 无 `conversationId` | 对最近列表使用 `googlegemini/search "*"`，或带关键词搜索 |
| 空回复 | 页面 DOM 可能已更新，请反馈 adapter |

## English summary

Use bun-browser site adapters on an open `gemini.google.com` tab:

- **chat** / **chatfollow** — ask and continue threads; models `flash` (default), `thinking`, `pro`
- **search** — list recent chats (`/search`) or keyword search; use query `*` to resolve `conversationId`
- **library** — list My Stuff creations at `/library` (Canvas, Deep Research, images, videos); not chat history
- **modes** / **health** — model list and access checks

`search` and `library` return `viewport` (`mobile` / `desktop`) and adapt to narrow layouts (sidebar open/close, longer waits). Positional args: `search [query] [limit] [resolveLimit]`, `library [section] [limit]`. Chain `search` → `chatfollow` for multi-turn workflows. Anonymous chat is supported without Google sign-in.
