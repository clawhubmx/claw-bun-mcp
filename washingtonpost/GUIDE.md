# Washington Post 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Washington Post 文章全文与元数据**。优先调用站点自身的 Arc `prism-content-api`（完整 `content_elements`），绕过 paywall teaser；无需 WaPo API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 Washington Post（订阅账号可提高成功率；非订阅通常只能拿到 teaser）

```bash
bun-browser open https://www.washingtonpost.com/ --tab current
# 如有订阅，在 Chrome 中完成登录
```

3. 安装/更新 site adapter（本仓库或上游 `claw-bun-mcp`）

```bash
bun-browser site update
bun-browser site list | grep washingtonpost   # 应看到 1 个命令
```

> adapter 在 `www.washingtonpost.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 Washington Post。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `washingtonpost/get-article` | 读取文章标题、作者、日期、摘要、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info washingtonpost/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/"
```

### 先打开再读（订阅文章更稳）

若直接 `fetch` 只能拿到 teaser 或 paywall 占位，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内的 `__NEXT_DATA__` 与已渲染段落：

```bash
bun-browser open "https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/" --tab current
# 等待页面加载完成
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/"
```

### 只取元数据或正文长度

```bash
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/..." --json --jq '{title, author, publishedAt, section, bodyCharacterCount, paywallBypassed, isTeaserContent}'
```

### 正文前 500 字预览

```bash
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/..." --json --jq '.articleBody[:500]'
```

---

## washingtonpost/get-article — 读取文章

从 Washington Post 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site washingtonpost/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | WaPo 文章链接（`washingtonpost.com` 或 `*.washingtonpost.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/`
- `https://washingtonpost.com/...`（自动规范化）
- 子域如 `*.washingtonpost.com` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/",
  "canonicalUrl": "https://www.washingtonpost.com/national-security/2026/06/05/cia-officer-accused-stealing-gold-bars-created-fake-black-box-spy-program/",
  "title": "CIA officer who had millions in gold bars accused of creating fake spy program",
  "author": "Warren Strobel, Ellen Nakashima",
  "publishedAt": "2026-06-05T23:54:48.587Z",
  "dateModified": "2026-06-06T00:26:39.080Z",
  "description": "David J. Rush worked on highly secretive intelligence programs...",
  "section": "Intelligence",
  "articleBody": "First paragraph...\n\nSecond paragraph...",
  "bodyCharacterCount": 8420,
  "source": "nextData",
  "isTeaserContent": false,
  "hasSubscribeCta": false,
  "paywallBypassed": true
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `canonicalUrl` | Arc 发布的 canonical 路径 |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者（多个以逗号分隔） |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `displayDate` | 展示用发布时间 |
| `description` | 摘要 / deck |
| `section` | 主版块（如 Intelligence、National Security） |
| `subtype` | 文章子类型（如 `default`） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |
| `isTeaserContent` | `true` 表示 `content_elements` 仅含 teaser + `subscribe-cta` |
| `hasSubscribeCta` | 内嵌数据是否包含订阅 CTA 块 |
| `paywallBypassed` | `true` 表示正文来自完整 `content_elements`，而非 DOM 预览 |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长且非 paywall 预览**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | Arc `prism-content-api`（同源 fetch） | `prismContentApi` | `GET /arc/prism/api/prism-content-api?query={"canonical_url":...}`，返回完整 `content_elements`，**主要 paywall 绕过路径** |
| 2 | 当前 tab 已打开同一篇文章 | `openPage` / `openPageHtml` | 读取 `window.__NEXT_DATA__`；若仅为 teaser，再调 prism API |
| 3 | `fetch` 后 HTML 中的 `__NEXT_DATA__` | `nextData` | 从 `globalContent.content_elements` 解析；teaser 时同样会再调 prism API |
| 4 | `application/ld+json` | `jsonLd` | `NewsArticle` / `Article` 的 `articleBody`（WaPo 通常不含全文） |
| 5 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |
| 6 | DOM `.article-body p` 或 `[data-qa=article-body] p` | `dom` | 已渲染段落；会过滤广告、订阅引导等 boilerplate |

**Paywall 策略：** SSR 的 `__NEXT_DATA__` 对未订阅用户通常只含 1 段 + `subscribe-cta`（`isTeaserContent: true`）。adapter 会用 `canonical_url` 调 WaPo 前端同一套 `prism-content-api` 拉取完整正文。`paywallBypassed: true` 且 `source: "prismContentApi"` 表示已成功绕过。

**Paywall 检测（后备）：** 若 prism API 失败且正文含 “Subscribe to read”、“Already a subscriber?” 等短预览，返回错误而非成功结果。

**正文清洗：** adapter 会剥离 HTML 标签、广告段落、订阅引导语等，避免污染 `articleBody`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/..." --json --jq '{title, author, publishedAt, section, paywallBypassed, source, isTeaserContent}'

# 正文段落数（按双换行分段）
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site washingtonpost/get-article "https://www.washingtonpost.com/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not a Washington Post URL`

`url` 必须是 `washingtonpost.com` 或 `*.washingtonpost.com` 上的文章链接。

```bash
bun-browser open https://www.washingtonpost.com --tab current
```

### `HTTP 4xx` / `HTTP 5xx`

文章可能已下线、地区限制，或当前 session 无法访问。

```bash
bun-browser open "<同一 URL>" --tab current
# 在 Chrome 中确认能打开后重试
bun-browser site washingtonpost/get-article "<url>"
```

### `Could not extract full article body`

页面 HTML 中未找到可用的 `content_elements` 正文，JSON-LD 也无完整正文，DOM 只有 paywall 占位。

**建议：**

1. 在 Chrome 中打开该文章（订阅账号登录）
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）
3. 确认 URL 是标准文章页，而非首页或版块列表

### `Only paywall preview available`

提取到的正文被识别为 paywall teaser。返回中会附带 `preview`（前 500 字）以及 `title` / `publishedAt` / `author`（若已解析）。

订阅用户：先在 Chrome 打开文章并确认能读全文，再重试。

### `isTeaserContent: true`

WaPo 以 teaser 模式返回了部分正文（通常 1 段 + `subscribe-cta`）。adapter 会尝试 fetch 完整页，但若 session 未解锁，仍可能失败。请在 Chrome 中用订阅账号打开文章后重试。

### `paywallBypassed: false` 但返回了正文

正文来自 DOM（`source: "dom"`）或仅为 teaser 时，`paywallBypassed` 为 `false`，内容可能不完整。以 `paywallBypassed: true` 且 `source` 为 `nextData` / `openPage` 为准更可靠。

### 需要登录或订阅吗？

- **不强制登录**：部分公开文章在 `__NEXT_DATA__` 中可能包含全文。
- **订阅有帮助**：paywall 页面在已登录订阅 session 下，`content_elements` 更常包含完整正文。
- adapter **不会**代替你完成登录；请在 Chrome 中自行登录 WaPo。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/washingtonpost/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Paywall 策略** — 优先 `__NEXT_DATA__.props.pageProps.globalContent.content_elements`（Arc Publishing）；DOM 为后备。WaPo 前端结构变更可能导致需更新 adapter。
- **与 Agent 协作** — 用 `site info washingtonpost/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 WaPo 并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for The Washington Post via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `washingtonpost/get-article <url>` | Fetch title, author, dates, section, summary, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.washingtonpost.com/` and log in with a subscription, run `bun-browser site update`.

**Paywall:** Full text is fetched from WaPo's own Arc `prism-content-api` (`/arc/prism/api/prism-content-api?query={"canonical_url":...}`), not the teaser in `__NEXT_DATA__` or the subscribe modal. `paywallBypassed: true` when `source` is `prismContentApi`. If prism fails, open the article in Chrome and retry.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `washingtonpost/get-article <same-url>`.

**Errors:** `Could not extract full article body` or `Only paywall preview available` — open the article in a logged-in tab and retry.

**Per-command docs:** `bun-browser site info washingtonpost/get-article`
