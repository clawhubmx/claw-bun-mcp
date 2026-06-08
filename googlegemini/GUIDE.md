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
| `bun-browser site googlegemini/branch <conversation> [messageIndex]` | 从某条助手回复处分叉到新对话（UI：Branch in new chat） |
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
| `thinking` | 3.5 Thinking / Thinking level → Extended | 复杂推理；新 UI 下为 Flash + **Extended** 思考级别 |
| `pro` | 3.1 Pro | 数学与代码 |

别名：`3.5-flash`、`3.5-thinking`、`3.1-pro` 等会自动映射。

若页面当前为 **Flash-Lite**（如 `Gemini Flash-Lite` / `3.1 Flash-Lite`），请求 `flash` 时会视为已匹配，无需强制切换到 3.5 Flash。

**Thinking level（2024+ UI）：** 部分账号的模型选择器不再单独列出 `3.5 Thinking`，而是用 **Thinking level** 子菜单（`Standard` / `Extended`）。`--model thinking` 会自动选择 Flash 系列并将思考级别设为 **Extended**；`--model flash` 会设为 **Standard**。`googlegemini/modes` 会在 `thinkingLevels` 与 `currentThinkingLevel` 中反映该子菜单。

**窄屏 / 宽屏差异：** 在 **mobile**（&lt; 768px 或 `is-mobile`）下，Thinking level 会在同一菜单内向下展开 `Standard` / `Extended`；在 **desktop** 下，这两项出现在右侧 flyout 子面板中，位置不同。adapter 会按 `viewport.layout` 调整等待时间、滚动到可见区域，并在桌面端优先搜索 flyout 子菜单。

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
| `answerJson` / `answerFormat` | 若回复含 JSON 块则解析（见下文「结构化 JSON 回复」） |
| `conversationId` | 对话 id（用于 chatfollow） |
| `attachments` / `transport` | 文件附件时才有（见上文） |
| `context` | 使用 `context` 参数时为 `true` |
| `loggedIn` | 是否检测到 Google 登录 cookie |
| `anonymous` | 是否为匿名会话（页面有 Sign in 按钮） |

## 结构化 JSON 回复

`chat` 与 `chatfollow` 会在助手回复中检测 JSON（含 ` ```json ` 代码块或裸 `{...}`），并额外返回：

| 字段 | 说明 |
|------|------|
| `answerFormat` | 为 `"json"` 表示已成功解析 |
| `answerJson` | 解析后的对象（可直接用于程序消费） |

示例 prompt：

```bash
bun-browser site googlegemini/chat \
  'Reply with ONLY a JSON object: {"status":"ok","code":"PING-1"}'
```

成功时除 `answer` 外还有：

```json
{
  "answerFormat": "json",
  "answerJson": { "status": "ok", "code": "PING-1" }
}
```

建议在 prompt 中明确要求「仅 JSON、无多余文字」，或指定键名与类型，以提高解析成功率。

## 分叉对话 (googlegemini/branch)

对应 Gemini 网页端助手回复 **Show more options → Branch in new chat**：从某条助手回复处复制上下文，**新建一条独立对话**，原对话不变。

### 使用示例

```bash
# 从最后一条助手回复处分叉（默认）
bun-browser site googlegemini/branch 4b4ee6aa216306a2

# 从第 0 条助手回复处分叉（0-based index）
bun-browser site googlegemini/branch 4b4ee6aa216306a2 0

# 也支持完整 URL
bun-browser site googlegemini/branch "https://gemini.google.com/app/4b4ee6aa216306a2"
```

位置参数顺序：`conversation`（必填）→ `messageIndex`（可选，默认最后一条助手回复）。

### 返回字段

| 字段 | 说明 |
|------|------|
| `sourceConversationId` | 原对话 id（未被修改） |
| `conversationId` | 新分叉对话 id |
| `url` | `https://gemini.google.com/app/{id}` |
| `title` | 通常为 `Branch • {原标题}` |
| `messageIndex` | 分叉所依据的助手回复索引 |
| `messagesCopied` | 复制到新对话的轮数 |
| `snapshot` | `{ turnCount, userQueries[], responses[] }` 快照 |
| `viewport` / `loggedIn` / `anonymous` | 同其他 adapter |

分叉后继续提问：

```bash
bun-browser site googlegemini/chatfollow <newConversationId> "Try a different approach"
```

### 与 chatfollow 的区别

| 操作 | 效果 |
|------|------|
| `chatfollow` | 在**同一条**对话里追加后续轮次 |
| `branch` | **新建**对话 id，保留分叉点之前的上下文，原线程不受影响 |

适用场景：从同一检查点并行尝试不同 follow-up、A/B 对比、保留「主对话」的同时探索变体。

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

### 典型工作流

```bash
# 1. 新对话提问
bun-browser site googlegemini/chat "Outline three options for X"
# => conversationId: abc123...

# 2. 同线程继续
bun-browser site googlegemini/chatfollow abc123... "Expand option 2"

# 3. 从某轮回复分叉，在新线程探索
bun-browser site googlegemini/branch abc123... 
# => conversationId: def456...（新 id）

bun-browser site googlegemini/chatfollow def456... "What if we chose option 1 instead?"
```

或从历史恢复：

```bash
bun-browser site googlegemini/search "*" 5 3
bun-browser site googlegemini/chatfollow <conversationId> "Resume where we left off"
```

## 长时间生成 / waitOnly

Thinking 模式或长回复可能仍在流式输出。若返回 `Still generating`：

```bash
bun-browser site googlegemini/chat "long task..." --model thinking
# 若超时或仍在生成（位置参数 waitOnly = true）：
bun-browser site googlegemini/chat "long task..." flash false true
```

`chat` / `chatfollow` 位置参数中第 4 项为 `waitOnly`（默认 `false`）；最后一项可设 `maxWaitMs` 覆盖等待上限（毫秒）。

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
| `Branch in new chat menu item not found` | 打开对话页，确认助手回复旁有 **Show more options**；窄屏下先展开 `message-actions` |
| `Branch did not navigate` | 重试 `branch`；确保标签页停留在 `gemini.google.com/app/{id}` |
| 空回复 | 页面 DOM 可能已更新，请反馈 adapter |

## 测试

### 单元测试（无需浏览器）

```bash
cd googlegemini
bun test test-chat-helpers.test.mjs test-api-schemas.test.mjs
```

- `test-chat-helpers.test.mjs` — DOM 解析、模式匹配、JSON 提取等 helper 逻辑
- `test-api-schemas.test.mjs` — 各 adapter 返回结构的 schema 校验（`api-schemas.mjs`）

### 端到端 API 流程（需要 bun-browser + Gemini 标签页）

```bash
# 前置：bun-browser status 正常，并已打开 gemini.google.com
bun googlegemini/scripts/run-api-flow.mjs

# 可选
bun googlegemini/scripts/run-api-flow.mjs --skip-attach    # 跳过附件上传步骤
bun googlegemini/scripts/run-api-flow.mjs --tab 0          # 指定标签页
bun googlegemini/scripts/run-api-flow.mjs --json-out /tmp/gemini-flow.json
```

流程依次验证：`health` → `modes` → `chat` / `chatfollow`（含 JSON 结构）→ `search` → `library` → `branch` → 分叉后续聊。结果写入 `googlegemini/.api-flow-results.json`。

开发 adapter 后需同步到 bun-browser 社区目录（或运行 `bun-browser site update`）：

```bash
cp googlegemini/{chat,chatfollow,branch,health,modes,search,library}.js \
  ~/.bun-browser/claw-bun-mcp/googlegemini/
```

修改 `chat-helpers.js` 后请运行 `node googlegemini/build-inline.mjs` 再同步上述文件。

## English summary

Use bun-browser site adapters on an open `gemini.google.com` tab:

- **chat** / **chatfollow** — ask and continue threads; models `flash` (default), `thinking`, `pro`; Flash-Lite counts as `flash`
- **branch** — fork a thread at an assistant reply into a **new** `conversationId` (UI: *Branch in new chat*); original thread unchanged
- **search** — list recent chats (`/search`) or keyword search; use query `*` to resolve `conversationId`
- **library** — list My Stuff creations at `/library` (Canvas, Deep Research, images, videos); not chat history
- **modes** / **health** — model list and access checks

**JSON outputs:** when the model reply contains parseable JSON, responses include `answerFormat: "json"` and `answerJson` (object).

**Positional args:** `search [query] [limit] [resolveLimit]`, `library [section] [limit]`, `branch <conversation> [messageIndex]`. Chat/chatfollow arg order is documented above (`newChat`, `waitOnly`, attachments, `maxWaitMs`, etc.).

**Typical chain:** `chat` → `chatfollow` (same thread) or `chat` → `branch` → `chatfollow` (forked thread). Use `search` / `search "*"` to recover `conversationId`.

**Tests:** `bun test googlegemini/test-*.test.mjs` (unit); `bun googlegemini/scripts/run-api-flow.mjs` (live E2E). Regenerate adapters with `node googlegemini/build-inline.mjs` after editing `chat-helpers.js`.

`search` and `library` return `viewport` (`mobile` / `desktop`) and adapt to narrow layouts. Anonymous chat is supported without Google sign-in.
