# New York Times 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **NYTimes 文章全文与元数据**。优先从页面内嵌的 `window.__preloadedData` 提取正文，绕过 metered DOM 预览；无需 NYT API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 NYTimes（订阅账号可提高成功率；非订阅有时也能读到完整 embedded 数据）

```bash
bun-browser open https://www.nytimes.com/ --tab current
# 如有订阅，在 Chrome 中完成登录
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep nytimes   # 应看到 1 个命令
```

> adapter 在 `www.nytimes.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 NYTimes。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `nytimes/get-article` | 读取文章标题、作者、日期、摘要、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info nytimes/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site nytimes/get-article "https://www.nytimes.com/2026/06/05/us/politics/trump-wisconsin-farmers-midterms.html"
```

### 先打开再读（订阅文章更稳）

若直接 `fetch` 只能拿到 paywall 预览，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内的 `__preloadedData`：

```bash
bun-browser open "https://www.nytimes.com/2026/06/05/us/politics/trump-wisconsin-farmers-midterms.html" --tab current
# 等待页面加载完成
bun-browser site nytimes/get-article "https://www.nytimes.com/2026/06/05/us/politics/trump-wisconsin-farmers-midterms.html"
```

### 只取元数据或正文长度

```bash
bun-browser site nytimes/get-article "https://www.nytimes.com/..." --json --jq '{title, author, publishedAt, section, bodyCharacterCount, paywallBypassed}'
```

### 正文前 500 字预览

```bash
bun-browser site nytimes/get-article "https://www.nytimes.com/..." --json --jq '.articleBody[:500]'
```

---

## nytimes/get-article — 读取文章

从 NYTimes 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site nytimes/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | NYTimes 文章链接（`nytimes.com` 或 `*.nytimes.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.nytimes.com/2026/06/05/us/politics/article-slug.html`
- `https://nytimes.com/...`（自动规范化）
- 子域如 `cooking.nytimes.com` 等 `*.nytimes.com` 文章页

**返回示例（成功）**

```json
{
  "url": "https://www.nytimes.com/2026/06/05/us/politics/trump-wisconsin-farmers-midterms.html",
  "title": "Article Headline",
  "author": "Jane Doe, John Smith",
  "publishedAt": "2026-06-05T10:15:00.000Z",
  "dateModified": "2026-06-05T14:30:00.000Z",
  "description": "Deck or summary line from the article.",
  "section": "Politics",
  "articleBody": "First paragraph...\n\nSecond paragraph...",
  "bodyCharacterCount": 8420,
  "source": "preloadedData",
  "paywallBypassed": true
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者（多个以逗号分隔）；解析失败时为 `null` |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要 / deck |
| `section` | 版块名（如 Politics、Business） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |
| `paywallBypassed` | `true` 表示正文来自 embedded 数据或 JSON-LD，而非 metered DOM 预览 |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长且非 paywall 预览**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` / `openPageHtml` | 读取 `window.__preloadedData`，最多轮询约 1.6 秒 |
| 2 | `fetch` 后 HTML 中的 `window.__preloadedData` | `preloadedData` | 从 `sprinkledBody` 解析段落与标题块，**主要 paywall 绕过路径** |
| 3 | `application/ld+json` | `jsonLd` | `NewsArticle` / `Article` 的 `articleBody` |
| 4 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |
| 5 | DOM `section[name="articleBody"]` 或 `.meteredContent` | `dom` | 常为 metered 预览；会检测 “Want all of The Times” 等文案 |

**Paywall 检测：** 若正文含 “Want all of The Times”、“You have a preview”、“Subscribe to continue” 等，视为预览而非全文，返回错误而非成功结果。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site nytimes/get-article "https://www.nytimes.com/..." --json --jq '{title, author, publishedAt, section, paywallBypassed, source}'

# 正文段落数（按双换行分段）
bun-browser site nytimes/get-article "https://www.nytimes.com/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site nytimes/get-article "https://www.nytimes.com/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not a NYTimes URL`

`url` 必须是 `nytimes.com` 或 `*.nytimes.com` 上的文章链接。Wirecutter、Athletic 等非 NYT 主站域名不在范围内。

```bash
bun-browser open https://www.nytimes.com --tab current
```

### `HTTP 4xx` / `HTTP 5xx`

文章可能已下线、地区限制，或当前 session 无法访问。

```bash
bun-browser open "<同一 URL>" --tab current
# 在 Chrome 中确认能打开后重试
bun-browser site nytimes/get-article "<url>"
```

### `Could not extract full article body`

页面 HTML 中未找到可用的 `__preloadedData.sprinkledBody`，JSON-LD 也无完整正文，DOM 只有 paywall 占位。

**建议：**

1. 在 Chrome 中打开该文章（订阅账号登录）
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）
3. 确认 URL 是标准文章页（含日期路径的 `.html`），而非首页或版块列表

### `Only paywall preview available`

提取到的正文被识别为 metered 预览（通常 `source` 为 `dom`）。返回中会附带 `preview`（前 500 字）以及 `title` / `publishedAt`（若已解析）。

订阅用户：先在 Chrome 打开文章并确认能读全文，再重试。

### `paywallBypassed: false` 但返回了正文

正文来自 DOM metered 区域且未被预览文案拦截时仍可能成功，但内容可能不完整。以 `paywallBypassed: true` 且 `source` 为 `preloadedData` / `openPage` 为准更可靠。

### 需要登录或订阅吗？

- **不强制登录**：公开文章的 embedded 数据有时包含全文。
- **订阅有帮助**：metered 页面在已登录订阅 session 下，`__preloadedData` 更常包含完整 `sprinkledBody`。
- adapter **不会**代替你完成登录；请在 Chrome 中自行登录 NYTimes。

### Cooking / Games 等子域

`*.nytimes.com`  hostname 均接受；解析逻辑与主站相同，依赖各子域是否嵌入 `__preloadedData`。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/nytimes/`，同名文件会覆盖社区版（例如增加 live blog、多媒体 caption 等字段）。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Paywall 策略** — 有意**不**依赖可见 DOM 的 metered 预览；优先 `window.__preloadedData.initialData.data.article.sprinkledBody`。NYT 前端结构变更可能导致需更新 adapter。
- **与 Agent 协作** — 用 `site info nytimes/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 NYT 并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for The New York Times via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `nytimes/get-article <url>` | Fetch title, author, dates, section, summary, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.nytimes.com/` and log in with a subscription, run `bun-browser site update`.

**Paywall:** Full text is extracted from embedded `window.__preloadedData` (`sprinkledBody`), not the metered DOM preview. If that fails, open the article in Chrome first, then retry. `paywallBypassed: true` when body came from embedded data or JSON-LD.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `nytimes/get-article <same-url>`.

**Errors:** `Could not extract full article body` or `Only paywall preview available` — open the article in a logged-in tab and retry.

**Per-command docs:** `bun-browser site info nytimes/get-article`
