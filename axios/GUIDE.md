# Axios 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Axios 文章全文与元数据**。优先从页面内嵌的 `__NEXT_DATA__`（`data.story.blocks`）提取正文；无需 Axios API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 Axios（Cloudflare 会拦截无 Cookie 的请求）

```bash
bun-browser open https://www.axios.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep axios   # 应看到 1 个命令
```

> adapter 在 `www.axios.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 Axios。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `axios/get-article` | 读取文章标题、作者、日期、摘要、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info axios/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site axios/get-article "https://www.axios.com/2026/06/05/senate-ice-border-patrol-funding-vote"
```

### 先打开再读（Cloudflare / Pro 文章更稳）

若直接 `fetch` 返回 Cloudflare 挑战页或正文不完整，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内的 `__NEXT_DATA__` 与已渲染段落：

```bash
bun-browser open "https://www.axios.com/2026/06/05/senate-ice-border-patrol-funding-vote" --tab current
# 等待页面加载完成
bun-browser site axios/get-article "https://www.axios.com/2026/06/05/senate-ice-border-patrol-funding-vote"
```

### 只取元数据或正文长度

```bash
bun-browser site axios/get-article "https://www.axios.com/..." --json --jq '{title, author, publishedAt, section, bodyCharacterCount, paywallBypassed, source}'
```

### 正文前 500 字预览

```bash
bun-browser site axios/get-article "https://www.axios.com/..." --json --jq '.articleBody[:500]'
```

---

## axios/get-article — 读取文章

从 Axios 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site axios/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Axios 文章链接（`axios.com` 或 `*.axios.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.axios.com/2026/06/05/senate-ice-border-patrol-funding-vote`
- `https://axios.com/...`（自动规范化）
- 子域如 `*.axios.com` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.axios.com/2026/06/05/senate-ice-border-patrol-funding-vote",
  "title": "Senate advances ICE funding through Trump's second term",
  "author": "Justin Green, Hans Nichols",
  "publishedAt": "2026-06-05T10:19:19Z",
  "dateModified": "2026-06-05T10:24:26.464546Z",
  "description": "The final vote was 52-47, with one Senate Republican voting \"no.\"",
  "section": "Top Stories",
  "articleBody": "Senate Republicans advanced...\n\nWhy it matters:...",
  "bodyCharacterCount": 4200,
  "source": "nextData",
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
| `description` | 摘要 / OG description |
| `section` | 版块名（如 Top Stories） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔，列表项以 `•` 前缀） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |
| `paywallBypassed` | `true` 表示正文来自 embedded 数据，而非 DOM 预览 |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长且非 boilerplate** 的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` / `openPageHtml` | 读取 `window.__NEXT_DATA__`，最多轮询约 2.5 秒；同时尝试 live DOM 段落 |
| 2 | `fetch` 后 HTML 中的 `__NEXT_DATA__` | `nextData` | 从 `data.story.blocks.blocks` 解析段落与列表项，**主要提取路径** |
| 3 | `data.story.bodyHtml` | `nextData` | 合并 `beforeKeepReading` + `afterKeepReading`（strip HTML） |
| 4 | `application/ld+json` | `jsonLd` | `NewsArticle` / `Article` 的 `articleBody` |
| 5 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |
| 6 | DOM `main p` / `main li` | `dom` | 已渲染段落；会过滤 Google 推广、分享按钮等 boilerplate |

**Paywall 检测：** 若 `data.hasPaywall === true` 且无 `afterKeepReading` 内容，或正文含 Axios Pro 订阅提示，视为预览而非全文。

**正文清洗：** adapter 会过滤 Google 来源推广、图片说明、分享/社交链接等，避免污染 `articleBody`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site axios/get-article "https://www.axios.com/..." --json --jq '{title, author, publishedAt, section, paywallBypassed, source}'

# 正文段落数（按双换行分段）
bun-browser site axios/get-article "https://www.axios.com/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site axios/get-article "https://www.axios.com/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not an Axios URL`

`url` 必须是 `axios.com` 或 `*.axios.com` 上的文章链接。

```bash
bun-browser open https://www.axios.com --tab current
```

### `HTTP 4xx` / `HTTP 5xx` / `Cloudflare challenge page`

Axios 使用 Cloudflare 保护。无浏览器 Cookie 的 `fetch` 可能返回挑战页。

```bash
bun-browser open "<同一 URL>" --tab current
# 在 Chrome 中确认能打开后重试
bun-browser site axios/get-article "<url>"
```

### `Could not extract full article body`

页面 HTML 中未找到可用的 `story.blocks`，JSON-LD 也无完整正文，DOM 只有 boilerplate。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）
3. 确认 URL 是标准文章页（`/YYYY/MM/DD/slug`），而非首页或版块列表

### `Only paywall preview available`

提取到的正文被识别为 Axios Pro paywall 预览。返回中会附带 `preview`（前 500 字）以及 `title` / `publishedAt`（若已解析）。

Pro 订阅用户：先在 Chrome 打开文章并确认能读全文，再重试。

### `paywallBypassed: false` 但返回了正文

正文来自 DOM（`source: "dom"`）或 JSON-LD 时，`paywallBypassed` 可能为 `false`，内容可能不完整。以 `paywallBypassed: true` 且 `source` 为 `nextData` / `openPage` 为准更可靠。

### 需要登录或订阅吗？

- **公开文章**：多数报道在 `__NEXT_DATA__` 中包含全文（`hasPaywall: false`）。
- **Axios Pro**：部分深度报道需要 Pro 订阅；已登录 Pro session 下 `afterKeepReading` 更常包含完整正文。
- adapter **不会**代替你完成登录；请在 Chrome 中自行登录 Axios。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/axios/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Cloudflare** — 必须在 bun-browser 管理的 Chrome tab 中执行；纯 curl 无法绕过挑战页。
- **与 Agent 协作** — 用 `site info axios/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 Axios 并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for Axios via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `axios/get-article <url>` | Fetch title, author, dates, section, summary, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.axios.com/` in Chrome, run `bun-browser site update`.

**Cloudflare:** Axios is behind Cloudflare. Run via bun-browser so `fetch` reuses browser cookies. If you get `Cloudflare challenge page`, open the article in Chrome first, then retry.

**Extraction:** Full text is extracted from embedded `__NEXT_DATA__` (`data.story.blocks.blocks`), with `bodyHtml` and DOM fallbacks. `paywallBypassed: true` when body came from `nextData` / `openPage` and `hasPaywall` is not true.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `axios/get-article <same-url>`.

**Errors:** `Could not extract full article body` or `Only paywall preview available` — open the article in Chrome and retry.

**Per-command docs:** `bun-browser site info axios/get-article`
