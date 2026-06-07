# Reuters 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Reuters 文章全文与元数据**。优先从页面内嵌的 `Fusion.globalContent`（`content_elements`）提取正文；无需 Reuters API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 Reuters（复用浏览器 Cookie，降低 bot challenge 概率）

```bash
bun-browser open https://www.reuters.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `claw-bun-mcp`）

```bash
bun-browser site update
bun-browser site list | grep reuters   # 应看到 search 与 get-article
```

> adapter 在 `www.reuters.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 Reuters。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `reuters/get-article` | 读取文章标题、作者、日期、摘要、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |
| `reuters/search` | 搜索 Reuters 新闻 | 发现文章链接 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info reuters/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site reuters/get-article "https://www.reuters.com/world/asia-pacific/us-eyes-iranian-assets-gulf-allies-reconstruction-source-says-2026-06-06/"
```

### 先打开再读（bot challenge 时更稳）

若直接 `fetch` 被 captcha 拦截，可先在 Chrome 打开该文，再执行命令——adapter 会优先读取当前页内的 `Fusion.globalContent` 与已渲染段落：

```bash
bun-browser open "https://www.reuters.com/world/asia-pacific/us-eyes-iranian-assets-gulf-allies-reconstruction-source-says-2026-06-06/" --tab current
# 等待页面加载完成
bun-browser site reuters/get-article "https://www.reuters.com/world/asia-pacific/us-eyes-iranian-assets-gulf-allies-reconstruction-source-says-2026-06-06/"
```

### 只取元数据或正文长度

```bash
bun-browser site reuters/get-article "https://www.reuters.com/..." --json --jq '{title, author, publishedAt, section, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site reuters/get-article "https://www.reuters.com/..." --json --jq '.articleBody[:500]'
```

---

## reuters/get-article — 读取文章

从 Reuters 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site reuters/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Reuters 文章链接（`reuters.com` 或 `*.reuters.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.reuters.com/world/asia-pacific/us-eyes-iranian-assets-gulf-allies-reconstruction-source-says-2026-06-06/`
- `https://reuters.com/...`（自动规范化）
- 子域如 `*.reuters.com` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.reuters.com/world/asia-pacific/us-eyes-iranian-assets-gulf-allies-reconstruction-source-says-2026-06-06/",
  "title": "US eyes Iranian assets for Gulf allies' reconstruction, source says",
  "author": "David Lawder, Eman Abouhassira, Ahmed Elimam",
  "publishedAt": "2026-06-06T22:28:29.212Z",
  "dateModified": "2026-06-07T02:57:48.71Z",
  "description": "U.S. Treasury Secretary Scott Bessent has directed a team to assess costs for damage already inflicted on Gulf allies by Iran.",
  "section": "Asia Pacific",
  "articleBody": "WASHINGTON/DUBAI, June 7 (Reuters) - The U.S. government will attempt...\n\nSecond paragraph...",
  "bodyCharacterCount": 6040,
  "source": "fusion",
  "isAccessibleForFree": true
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
| `section` | 版块名（如 Asia Pacific、Business） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |
| `isAccessibleForFree` | JSON-LD 中的免费可读标记（若可解析） |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `fusionOpenPage` | 读取 `window.Fusion.globalContent.result` |
| 2 | `fetch` 后 HTML 中的 `Fusion.globalContent` | `fusion` | 从 `content_elements` 解析段落，**主要路径** |
| 3 | `application/ld+json` | `jsonLd` | `NewsArticle` 元数据；正文通常为空 |
| 4 | Open Graph / `<h1>` / `article:*` meta | — | 仅补元数据 |
| 5 | DOM `[data-testid="ArticleBody"] [data-testid^="paragraph-"]` | `dom` | 已渲染段落；会过滤 newsletter、署名行等 boilerplate |

**正文清洗：** adapter 会过滤 newsletter 引导语、"Our Standards"、编辑署名行等，避免污染 `articleBody`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site reuters/get-article "https://www.reuters.com/..." --json --jq '{title, author, publishedAt, section, source, bodyCharacterCount}'

# 正文段落数（按双换行分段）
bun-browser site reuters/get-article "https://www.reuters.com/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site reuters/get-article "https://www.reuters.com/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not a Reuters URL`

`url` 必须是 `reuters.com` 或 `*.reuters.com` 上的文章链接。

```bash
bun-browser open https://www.reuters.com --tab current
```

### `HTTP 4xx` / `HTTP 5xx`

文章可能已下线、地区限制，或当前 session 无法访问。

```bash
bun-browser open "<同一 URL>" --tab current
# 在 Chrome 中确认能打开后重试
bun-browser site reuters/get-article "<url>"
```

### `Bot challenge blocked fetch`

Reuters 的 DataDome / captcha 拦截了无 Cookie 的抓取。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再执行 `get-article`（会走 `fusionOpenPage` 路径）

### `Could not extract full article body`

页面 HTML 中未找到可用的 `Fusion.globalContent`，DOM 也无正文段落。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再重试
3. 确认 URL 是标准文章页，而非首页或版块列表

### 需要登录吗？

- **通常不需要**：Reuters 大部分文章可免费读取。
- adapter **不会**代替你完成登录；若遇到地区限制，请在 Chrome 中自行处理。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/reuters/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **数据模型** — Reuters 使用 Arc XP PageBuilder；文章数据嵌在 `Fusion.globalContent.result.content_elements` 中。
- **与 Agent 协作** — 用 `site info reuters/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 Reuters 并发过高。

适配器源码：`get-article.js`

---

## English summary

Two read-only CLI commands for Reuters via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `reuters/get-article <url>` | Fetch title, author, dates, section, summary, and full article body |
| `reuters/search <query>` | Search Reuters news |

**Prerequisites:** `bun-browser start`, optionally open `https://www.reuters.com/`, run `bun-browser site update`.

**Extraction:** Full text comes from embedded `Fusion.globalContent.result.content_elements` (Arc XP). Fallback: `ArticleBody` DOM paragraphs. If fetch is blocked by bot challenge, open the article in Chrome first, then retry.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `reuters/get-article <same-url>`.

**Per-command docs:** `bun-browser site info reuters/get-article`
