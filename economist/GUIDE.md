# The Economist 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **The Economist 文章全文与元数据**。优先从 Next.js 数据路由 `/_next/data/{buildId}/...json`（`pageProps.content.body`）提取正文，绕过 HTML 中仅含首段的 paywall 预览；无需 Economist API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 The Economist（订阅账号可提高成功率；非订阅通常只能拿到首段预览）

```bash
bun-browser open https://www.economist.com/ --tab current
# 如有订阅，在 Chrome 中完成登录
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep economist   # 应看到 1 个命令
```

> adapter 在 `www.economist.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。站点有 Cloudflare 保护，裸 `curl` 通常会失败；带 Cookie 的 `fetch` 或已打开的标签页更可靠。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `economist/get-article` | 读取文章标题、作者、日期、摘要、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info economist/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site economist/get-article "https://www.economist.com/finance-and-economics/2026/06/05/how-hot-is-americas-labour-market"
```

### 先打开再读（订阅文章更稳）

若直接 `fetch` 只能拿到 paywall 预览，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内的 `__NEXT_DATA__` 与已渲染段落：

```bash
bun-browser open "https://www.economist.com/finance-and-economics/2026/06/05/how-hot-is-americas-labour-market" --tab current
# 等待页面加载完成
bun-browser site economist/get-article "https://www.economist.com/finance-and-economics/2026/06/05/how-hot-is-americas-labour-market"
```

### 只取元数据或正文长度

```bash
bun-browser site economist/get-article "https://www.economist.com/..." --json --jq '{title, rubric, publishedAt, section, bodyCharacterCount, paywallBypassed, walled, isSubscriber}'
```

### 正文前 500 字预览

```bash
bun-browser site economist/get-article "https://www.economist.com/..." --json --jq '.articleBody[:500]'
```

---

## economist/get-article — 读取文章

从 The Economist 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site economist/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Economist 文章链接（`economist.com` 或 `*.economist.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.economist.com/finance-and-economics/2026/06/05/how-hot-is-americas-labour-market`
- `https://economist.com/...`（自动规范化）
- 子域如 `*.economist.com` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.economist.com/finance-and-economics/2026/06/05/how-hot-is-americas-labour-market",
  "title": "How hot is America's labour market?",
  "author": null,
  "publishedAt": "2026-06-05T19:10:43.000Z",
  "dateModified": "2026-06-05T19:10:56.502Z",
  "description": "At the moment, balmy. But it wouldn't take a lot to require some Fed air-conditioning",
  "rubric": "At the moment, balmy. But it wouldn't take a lot to require some Fed air-conditioning",
  "flyTitle": "Taking the temperature",
  "section": "Finance & economics",
  "articleBody": "First paragraph...\n\nSecond paragraph...",
  "bodyCharacterCount": 8420,
  "source": "nextData",
  "walled": false,
  "isSubscriber": true,
  "paywallBypassed": true
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者（多个以逗号分隔）；Economist 文章常无署名，可能为 `null` |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要（优先 `rubric`，其次 SEO description） |
| `rubric` | 文章导语 / deck 行 |
| `flyTitle` | 栏目小标题（fly title） |
| `section` | 版块名（如 Finance & economics） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |
| `walled` | 页面是否标记为付费墙内容 |
| `isSubscriber` | 当前 session 是否为订阅用户 |
| `paywallBypassed` | `true` 表示正文来自 embedded 数据且已解锁，而非 DOM 预览 |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长且非 paywall 预览**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | `/_next/data/{buildId}{pathname}.json` | `nextDataRoute` | Next.js 客户端导航数据；**主要 paywall 绕过路径**，常比 HTML 内嵌 `__NEXT_DATA__` 含更多正文 |
| 2 | 当前 tab 已打开同一篇文章 | `openPage` / `openPageHtml` | 读取 `window.__NEXT_DATA__` 后同样会尝试 `nextDataRoute` |
| 3 | `fetch` 后 HTML 中的 `__NEXT_DATA__` | `nextData` | 从 `pageProps.content.body` 解析；paywall 页通常仅 1 段，随后由 `nextDataRoute` 补全 |
| 4 | `application/ld+json` | `jsonLd` | `NewsArticle` 的 `articleBody`（Economist 通常不含完整正文） |
| 5 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |
| 6 | DOM `article[data-testid="Article"] p[data-component="paragraph"]` | `dom` | 已渲染段落；会过滤相关文章 teaser 与 boilerplate |

**Paywall 检测：** HTML 内嵌数据在 `walled: true` 时通常只有首段；adapter 会通过 `nextDataRoute` 拉取完整 `content.body`。若最终正文仍仅 1 段或含 “Subscribe to The Economist” 等，视为预览并返回错误。

**正文清洗：** adapter 会过滤订阅引导、newsletter 推广、相关文章短标题等，避免污染 `articleBody`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site economist/get-article "https://www.economist.com/..." --json --jq '{title, rubric, flyTitle, publishedAt, section, paywallBypassed, walled, isSubscriber}'

# 正文段落数（按双换行分段）
bun-browser site economist/get-article "https://www.economist.com/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site economist/get-article "https://www.economist.com/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not an Economist URL`

`url` 必须是 `economist.com` 或 `*.economist.com` 上的文章链接。

```bash
bun-browser open https://www.economist.com --tab current
```

### `Bot challenge blocked fetch`

Cloudflare 拦截了无 Cookie 的请求。先在 Chrome 中打开 economist.com 或该文章，再重试。

```bash
bun-browser open "<同一 URL>"
bun-browser site economist/get-article "<url>"
```

### `Could not extract full article body`

页面 HTML 中未找到可用的 `content.body`，JSON-LD 也无完整正文，DOM 只有 paywall 占位。

**建议：**

1. 在 Chrome 中打开该文章（订阅账号登录）
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）
3. 确认 URL 是标准文章页，而非首页或版块列表

### `Only paywall preview available`

提取到的正文被识别为 paywall 预览（通常仅首段）。返回中会附带 `preview`（前 500 字）以及 `title` / `publishedAt` / `rubric`（若已解析）。

订阅用户：先在 Chrome 打开文章并确认能读全文，再重试。

### `walled: true` 或 `isSubscriber: false`

当前 session 未解锁全文。adapter 会尝试 fetch 完整页，但若未订阅，仍可能只拿到首段。请在 Chrome 中用订阅账号登录后重试。

### `paywallBypassed: false` 但返回了正文

正文来自 DOM（`source: "dom"`）时，`paywallBypassed` 为 `false`，内容可能不完整。以 `paywallBypassed: true` 且 `source` 为 `nextData` / `openPage` 为准更可靠。

### 需要登录或订阅吗？

- **不强制登录**：非订阅用户通常可拿到首段预览与完整元数据（标题、rubric、日期）。
- **订阅有帮助**：paywall 页面在已登录订阅 session 下，`content.body` 包含完整正文；`isSubscriber: true` 时 adapter 会标记 `paywallBypassed: true`。
- adapter **不会**代替你完成登录；请在 Chrome 中自行登录 The Economist。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/economist/`，同名文件会覆盖社区版（例如增加 `aiSummary`、播客旁白等字段）。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Paywall 策略** — 优先 `__NEXT_DATA__.props.pageProps.content.body`；DOM 为后备。Economist 前端结构变更可能导致需更新 adapter。
- **与 Agent 协作** — 用 `site info economist/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 Economist 并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for The Economist via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `economist/get-article <url>` | Fetch title, dates, rubric, section, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.economist.com/` and log in with a subscription, run `bun-browser site update`.

**Paywall:** Full text is extracted from the Next.js data route `/_next/data/{buildId}/...json` (`pageProps.content.body`), which often contains the complete article even when HTML `__NEXT_DATA__` shows only the lead paragraph. If that fails, open the article in Chrome first, then retry. `paywallBypassed: true` when `source` is `nextDataRoute`. Watch `walled: true` with `source: "nextData"` and a single paragraph — that means the route fetch failed.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `economist/get-article <same-url>`.

**Errors:** `Bot challenge blocked fetch` — open economist.com in Chrome first. `Could not extract full article body` or `Only paywall preview available` — open the article in a logged-in subscriber tab and retry.

**Per-command docs:** `bun-browser site info economist/get-article`
