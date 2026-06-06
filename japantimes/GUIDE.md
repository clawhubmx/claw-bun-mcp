# Japan Times 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **The Japan Times 文章全文与元数据**。通过站点自有的 `/ajax/getArticleContent/` 接口（配合 Piano `jt_pn` token）绕过 paywall 预览；无需 Japan Times API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中先打开 Japan Times（有助于通过 Cloudflare 校验）

```bash
bun-browser open https://www.japantimes.co.jp/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `claw-bun-mcp`）

```bash
bun-browser site update
bun-browser site list | grep japantimes   # 应看到 1 个命令
```

> adapter 在 `www.japantimes.co.jp` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。Japan Times 使用 Cloudflare + Piano paywall；若 `fetch` 被拦截，请先在 Chrome 中打开文章再重试。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `japantimes/get-article` | 读取文章标题、作者、日期、标签与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info japantimes/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site japantimes/get-article "https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/"
```

### 先打开再读（Cloudflare / Piano 场景更稳）

若直接 `fetch` 返回 Cloudflare 挑战页，或只能拿到 3 段预览，可先在 Chrome 打开该文，等 Piano 加载完成（约 10–15 秒），再执行命令：

```bash
bun-browser open "https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/" --tab current
# 等待页面加载完成
bun-browser site japantimes/get-article "https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/"
```

### 只取元数据或正文长度

```bash
bun-browser site japantimes/get-article "https://www.japantimes.co.jp/news/..." --json --jq '{title, author, publishedAt, section, tags, bodyCharacterCount, source, paywallBypassed}'
```

### 正文前 500 字预览

```bash
bun-browser site japantimes/get-article "https://www.japantimes.co.jp/news/..." --json --jq '.articleBody'
```

---

## japantimes/get-article — 读取文章

从 Japan Times 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site japantimes/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Japan Times 文章链接（`japantimes.co.jp` 或 `*.japantimes.co.jp`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/`
- `https://japantimes.co.jp/...`（自动规范化）
- 子域如 `*.japantimes.co.jp` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/",
  "canonicalUrl": "https://www.japantimes.co.jp/news/2026/06/06/japan/politics/takaichi-campaign-video-scandal/",
  "title": "Takaichi faces heat over defamatory campaign video scandal",
  "author": "The Japan Times",
  "publishedAt": "2026-06-06T18:23:57+09:00",
  "dateModified": "2026-06-06T18:40:18+09:00",
  "description": "A report claims that her campaign posted defamatory videos of her rivals on social media during election time.",
  "section": "JAPAN",
  "tags": ["Sanae Takaichi", "LDP", "CRA", "social media", "2026 lower house election"],
  "cmsArticleId": "642360",
  "articleBody": "First paragraph...\n\nSecond paragraph...",
  "bodyCharacterCount": 3105,
  "source": "ajaxContent",
  "displayFullText": 1,
  "paywallBypassed": true
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `canonicalUrl` | 文章 canonical 链接 |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者或出品方 |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要 |
| `section` | 版块（如 JAPAN、WORLD） |
| `tags` | 关键词 / 标签数组 |
| `cmsArticleId` | CMS 文章 ID（用于站内 API） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |
| `displayFullText` | `/ajax/getArticleContent/` 是否返回全文（`1` 表示已解锁） |
| `paywallBypassed` | 是否绕过了 paywall 预览 |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `dom` | 读取已渲染的 `.article-body` 段落，最多轮询约 12 秒 |
| 2 | `/ajax/getArticleContent/` | `ajaxContent` | 使用 Piano `jt_pn`（`sessionStorage._pc_jt_pn` 或 `tp.customVariables.jt_pn`）请求全文 HTML，**主要 bypass 路径** |
| 3 | `fetch` 后 HTML 中的 `.article-body` | `domPreview` | SSR 预览段落（通常只有前 3 段 + 订阅引导） |
| 4 | `application/ld+json` | `jsonLd` | `NewsArticle.articleBody`（通常被截断） |
| 5 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |

**Paywall 机制：** Japan Times 在 HTML 中只渲染 `blurred-text` 预览，完整正文由 Piano 触发后通过 `/ajax/getArticleContent/` 注入。adapter 复用同一 API 与 double-base64 编码逻辑（与 `piano_jt.js` 一致）。

**Cloudflare 检测：** 若页面标题为 “Just a moment...” 或含 “Enable JavaScript and cookies to continue”，返回 `Cloudflare challenge blocked fetch`，建议在 Chrome 中打开文章后重试。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site japantimes/get-article "https://www.japantimes.co.jp/news/..." --json --jq '{title, author, publishedAt, section, tags, source, paywallBypassed, bodyCharacterCount}'

# 正文段落数（按双换行分段）
bun-browser site japantimes/get-article "https://www.japantimes.co.jp/news/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'
```

---

## 常见问题

### `Not a Japan Times URL`

`url` 必须是 `japantimes.co.jp` 或 `*.japantimes.co.jp` 上的文章链接。

### `Cloudflare challenge blocked fetch`

Japan Times 的 Cloudflare 校验拦截了无头 `fetch`。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再执行 `get-article`

### `Could not extract full article body` / `Only paywall preview available`

Piano 尚未写入 `jt_pn`，或 `/ajax/getArticleContent/` 未返回正文。

**建议：**

1. 在 Chrome 中打开该文章
2. 等待约 10–15 秒让 Piano 完成加载
3. 再执行 `get-article`

### 需要登录吗？

- **不强制登录**：匿名用户可通过 Piano meter 解锁全文（`displayFullText: 1`）。
- adapter **不会**代替你完成登录；若账号权限不足导致截断，请在 Chrome 中自行登录后重试。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/japantimes/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 与 `/ajax/getArticleContent/` 发起 `fetch`（带浏览器 Cookie）。
- **Piano bypass** — 从 `sessionStorage._pc_jt_pn` 或 `tp.customVariables.jt_pn` 读取 token，调用站点自有 AJAX 接口获取 `articleBody` HTML。
- **与 Agent 协作** — 用 `site info japantimes/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 Japan Times 并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for The Japan Times via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `japantimes/get-article <url>` | Fetch title, author, dates, section, tags, summary, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.japantimes.co.jp/` in Chrome, run `bun-browser site update`.

**Paywall bypass:** Japan Times uses Piano + `/ajax/getArticleContent/`. The adapter reuses the Piano `jt_pn` token from the browser session to fetch full `articleBody` HTML, bypassing the blurred preview in the initial HTML.

**Typical flow:** `bun-browser open <article-url>` → wait for Piano (~15s) → `japantimes/get-article <same-url>`.

**Errors:** `Cloudflare challenge blocked fetch` or `Only paywall preview available` — open the article in Chrome, wait for load, and retry.

**Per-command docs:** `bun-browser site info japantimes/get-article`
