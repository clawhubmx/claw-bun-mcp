# Investing.com 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Investing.com 新闻文章全文与元数据**。优先从页面内嵌的 `__NEXT_DATA__`（`newsStore._article.body`）提取正文；无需 API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser daemon start    # 如未运行
```

2. 建议在 Chrome 中打开 Investing.com（站点有 Cloudflare 保护，浏览器 session 更稳）

```bash
bun-browser open https://www.investing.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep investing   # 应看到 1 个命令
```

> adapter 在 `www.investing.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 Investing.com。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `investing/get-article` | 读取文章标题、作者、日期、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info investing/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site investing/get-article "https://www.investing.com/news/stock-market-news/whos-winning-the-pizza-race-4729642"
```

### 先打开再读（Cloudflare 场景更稳）

若直接 `fetch` 被 Cloudflare 拦截，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内的 `__NEXT_DATA__` 与已渲染段落：

```bash
bun-browser open "https://www.investing.com/news/stock-market-news/whos-winning-the-pizza-race-4729642" --tab current
# 等待页面加载完成
bun-browser site investing/get-article "https://www.investing.com/news/stock-market-news/whos-winning-the-pizza-race-4729642"
```

### 只取元数据或正文长度

```bash
bun-browser site investing/get-article "https://www.investing.com/news/..." --json --jq '{title, author, publishedAt, section, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site investing/get-article "https://www.investing.com/news/..." --json --jq '.articleBody[:500]'
```

---

## investing/get-article — 读取文章

从 Investing.com 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site investing/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Investing.com 文章链接（`investing.com` 或 `*.investing.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.investing.com/news/stock-market-news/whos-winning-the-pizza-race-4729642`
- `https://www.investing.com/analysis/...`
- 子域如 `in.investing.com`、`uk.investing.com` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.investing.com/news/stock-market-news/whos-winning-the-pizza-race-4729642",
  "title": "Who's winning the pizza race?",
  "author": "Simon Mugo",
  "publishedAt": "2026-06-07T03:24:09Z",
  "dateModified": "2026-06-07T03:24:09Z",
  "description": null,
  "section": "Stock Market News",
  "provider": "Investing.com",
  "sourceName": "Investing.com",
  "articleBody": "Investing.com -- Domino's Pizza (NYSE: DPZ)...\n\nSecond paragraph...",
  "bodyCharacterCount": 2840,
  "source": "nextData"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者；解析失败时为 `null` |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要 |
| `section` | 版块名（如 Stock Market News）；从 URL 路径或文章数据推断 |
| `provider` | 内容提供方 |
| `sourceName` | 来源名称 |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` / `openPageHtml` | 读取 `window.__NEXT_DATA__`，最多轮询约 3.6 秒；同时尝试 live DOM 段落 |
| 2 | `fetch` 后 HTML 中的 `__NEXT_DATA__` | `nextData` | 从 `newsStore._article.body` 解析 HTML 段落，**主要提取路径** |
| 3 | `application/ld+json` | `jsonLd` | `NewsArticle` / `Article` 的元数据与 `articleBody`（若存在） |
| 4 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |
| 5 | DOM `#article p` | `dom` | 已渲染段落；会过滤广告、Fair Value 推广等 boilerplate |

**正文清洗：** adapter 会剥离 HTML 标签、广告段落、Fair Value 计算器推广语等，避免污染 `articleBody`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site investing/get-article "https://www.investing.com/news/..." --json --jq '{title, author, publishedAt, section, source, bodyCharacterCount}'

# 正文段落数（按双换行分段）
bun-browser site investing/get-article "https://www.investing.com/news/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site investing/get-article "https://www.investing.com/news/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not an Investing.com URL`

`url` 必须是 `investing.com` 或 `*.investing.com` 上的文章链接。

```bash
bun-browser open https://www.investing.com --tab current
```

### `Cloudflare challenge blocked fetch`

站点启用了 Cloudflare 保护，裸 `fetch` 可能返回挑战页。

```bash
bun-browser open "<同一 URL>" --tab current
# 在 Chrome 中等待页面完全加载后重试
bun-browser site investing/get-article "<url>"
```

### `Could not extract full article body`

页面 HTML 中未找到可用的 `newsStore._article.body`，DOM 也无足够段落。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）
3. 确认 URL 是标准新闻/分析文章页，而非首页或行情页

### 需要登录吗？

- **不强制登录**：大多数公开新闻文章在 `__NEXT_DATA__` 中包含全文。
- adapter **不会**代替你完成登录；Pro 付费内容若被 paywall 遮挡，需先在 Chrome 中自行登录。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/investing/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **提取策略** — 优先 `__NEXT_DATA__.props.pageProps.state.newsStore._article`；DOM 为后备。Investing.com 前端结构变更可能导致需更新 adapter。
- **与 Agent 协作** — 用 `site info investing/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for Investing.com via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `investing/get-article <url>` | Fetch title, author, dates, section, and full article body |

**Prerequisites:** `bun-browser daemon start`, optionally open `https://www.investing.com/`, run `bun-browser site update`.

**Cloudflare:** The site uses Cloudflare. If fetch is blocked, open the article in Chrome first, then retry. Full text is extracted from embedded `__NEXT_DATA__` (`newsStore._article.body`).

**Typical flow:** `bun-browser open <article-url>` → wait for load → `investing/get-article <same-url>`.

**Per-command docs:** `bun-browser site info investing/get-article`
