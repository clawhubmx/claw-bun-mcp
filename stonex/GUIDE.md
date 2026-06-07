# StoneX 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **StoneX Insights 文章全文与元数据**。解析页面内嵌的 `NewsArticle` JSON-LD 与正文 DOM（`font-body-md-regular` 段落，止于法律免责声明）；无需 API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 StoneX（站点有 Cloudflare，需浏览器 session）

```bash
bun-browser open https://www.stonex.com/en-gb/insights/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `claw-bun-mcp`）

```bash
bun-browser site update
bun-browser site list | grep stonex   # 应看到 1 个命令
```

> adapter 在 `www.stonex.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 StoneX。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `stonex/get-article` | 读取 Insights 文章标题、作者、日期、主题与正文 | 抓取全文、做摘要、Agent 读市场评论 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info stonex/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site stonex/get-article "https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/"
```

### 先打开再读（Cloudflare 更稳）

若直接 `fetch` 被 Cloudflare 拦截，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内已渲染段落：

```bash
bun-browser open "https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/" --tab current
# 等待页面加载完成
bun-browser site stonex/get-article "https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/"
```

### 只取元数据或正文长度

```bash
bun-browser site stonex/get-article "https://www.stonex.com/en-gb/insights/..." --json --jq '{title, author, authorRole, publishedAt, section, topics, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site stonex/get-article "https://www.stonex.com/en-gb/insights/..." --json --jq '.articleBody[:500]'
```

---

## stonex/get-article — 读取文章

从 StoneX Insights 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site stonex/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | StoneX Insights 文章链接（路径须含 `/insights/`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/`
- `https://www.stonex.com/en-us/insights/...`
- 其他 locale 前缀下的 `/insights/` 文章页

**返回示例（成功）**

```json
{
  "url": "https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/",
  "canonicalUrl": "https://www.stonex.com/en-gb/insights/japan-green-coffee-stocks-jump-11-6pct-year-on-year/",
  "title": "Japan Green Coffee Stocks Jump 11.6% Year on Year",
  "author": "Alexis Rubinstein",
  "authorRole": "Managing Editor - Coffee Network",
  "publishedAt": "2022-05-27T14:00:00.000Z",
  "dateModified": null,
  "description": "morning breaking news",
  "section": "Insights",
  "topics": ["Coffee"],
  "articleBody": "CoffeeNetwork (New York) – The latest data...\n\nThis represents a 3.4% increase...",
  "bodyCharacterCount": 412,
  "source": "dom"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `canonicalUrl` | `<link rel="canonical">` |
| `title` | 标题 |
| `author` | 作者名 |
| `authorRole` | 作者职务（来自 `By:` 行） |
| `publishedAt` | 发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要 / meta description |
| `section` | 版块（通常为 Insights） |
| `topics` | 主题标签（来自 JSON-LD `about`） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔；不含法律免责声明） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` | 读取 live DOM，最多轮询约 3.6 秒 |
| 2 | `fetch` 后 HTML 中的 DOM | `dom` | 从 `main` 内包含 `By:` 的正文区提取 `p.font-body-md-regular` |
| 3 | `application/ld+json` | `jsonLd` | `NewsArticle` 元数据（StoneX 通常不含 `articleBody`） |
| 4 | Open Graph / `<h1>` / `<time>` | — | 补元数据 |

**正文边界：** 提取止于 “This material should be construed as market commentary” 法律免责声明之前；并跳过 “Discover more insights” / “Related articles” 等推荐区块。

**正文清洗：** adapter 会过滤 Cookie 横幅、站点推广段落、监管披露等 boilerplate。

---

## 用 jq 过滤 JSON

```bash
# 元数据一览
bun-browser site stonex/get-article "https://www.stonex.com/en-gb/insights/..." --json --jq '{title, author, publishedAt, topics, source}'

# 正文段落数
bun-browser site stonex/get-article "https://www.stonex.com/en-gb/insights/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'
```

---

## 常见问题

### `Not a StoneX URL` / `Not a StoneX insights article URL`

`url` 必须是 `stonex.com` 上且路径包含 `/insights/` 的文章链接。

```bash
bun-browser open https://www.stonex.com/en-gb/insights/ --tab current
```

### `Cloudflare challenge blocked fetch`

站点启用了 Cloudflare。请在 Chrome 中打开文章，等页面完全加载后再执行 `get-article`。

### `Could not extract article body`

页面 HTML 中未找到正文段落。先在 Chrome 打开该 URL 后重试。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/stonex/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Cloudflare** — 无头 `fetch` 可能被挑战页拦截；已打开 tab 的 DOM 路径更可靠。
- **与 Agent 协作** — 用 `site info stonex/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for StoneX Insights via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `stonex/get-article <url>` | Fetch title, author, dates, topics, and article body from `/insights/` pages |

**Prerequisites:** `bun-browser start`, optionally open `https://www.stonex.com/en-gb/insights/`, run `bun-browser site update`.

**Cloudflare:** Site may block bare `fetch`. Open the article in Chrome first, then retry. Body is extracted from article DOM paragraphs before the legal disclaimer.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `stonex/get-article <same-url>`.

**Per-command docs:** `bun-browser site info stonex/get-article`
