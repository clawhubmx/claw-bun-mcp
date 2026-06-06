# Politico 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Politico 文章全文与元数据**。优先从页面内嵌的 Nuxt 数据（`__NUXT__.data.article` 或 HTML 中的 `__NUXT_DATA__`）提取正文；无需 Politico API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中先打开 Politico（有助于通过 Cloudflare 校验）

```bash
bun-browser open https://www.politico.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep politico   # 应看到 1 个命令
```

> adapter 在 `www.politico.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。Politico 使用 Cloudflare；若 `fetch` 被拦截，请先在 Chrome 中打开文章再重试。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `politico/get-article` | 读取文章标题、作者、日期、摘要、标签与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info politico/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site politico/get-article "https://www.politico.com/news/2026/06/05/trump-strategic-petroleum-reserve-california-00952083"
```

### 先打开再读（Cloudflare 场景更稳）

若直接 `fetch` 返回 Cloudflare 挑战页，可先在 Chrome 打开该文，再执行命令——adapter 会优先读取当前页内的 `window.__NUXT__.data.article`：

```bash
bun-browser open "https://www.politico.com/news/2026/06/05/hochul-climate-affordability-democrats-00950868" --tab current
# 等待页面加载完成
bun-browser site politico/get-article "https://www.politico.com/news/2026/06/05/hochul-climate-affordability-democrats-00950868"
```

### 只取元数据或正文长度

```bash
bun-browser site politico/get-article "https://www.politico.com/news/..." --json --jq '{title, author, publishedAt, section, tags, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site politico/get-article "https://www.politico.com/news/..." --json --jq '.articleBody[:500]'
```

---

## politico/get-article — 读取文章

从 Politico 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site politico/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Politico 文章链接（`politico.com` 或 `*.politico.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.politico.com/news/2026/06/05/trump-strategic-petroleum-reserve-california-00952083`
- `https://politico.com/...`（自动规范化）
- 子域如 `*.politico.com` 上的文章页

**返回示例（成功）**

```json
{
  "url": "https://www.politico.com/news/2026/06/05/trump-strategic-petroleum-reserve-california-00952083",
  "canonicalUrl": "https://www.politico.com/news/2026/06/05/trump-strategic-petroleum-reserve-california-00952083",
  "title": "Trump administration in 'active dialogue' on strategic petroleum reserve in California",
  "author": "Noah Baustin, Ben Lefebvre",
  "publishedAt": "2026-06-05T21:43:53.060+00:00",
  "dateModified": "2026-06-05T21:43:53.060+00:00",
  "description": "The plan would almost certainly run into opposition from Democratic Gov. Gavin Newsom.",
  "section": "News",
  "tags": ["Energy", "California", "Donald Trump"],
  "articleBody": "First paragraph...\n\nSecond paragraph...",
  "bodyCharacterCount": 4562,
  "source": "nuxtData"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `canonicalUrl` | 文章 canonical 链接 |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者（多个以逗号分隔） |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要 / dek |
| `section` | 版块或子品牌 |
| `tags` | 文章标签数组 |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` | 读取 `window.__NUXT__.data.article`，最多轮询约 3.6 秒 |
| 2 | `fetch` 后 HTML 中的 `__NUXT_DATA__` | `nuxtData` | 解析 Nuxt payload 中的 `article.body` 文本块，**主要全文路径** |
| 3 | `application/ld+json` | `jsonLd` | `NewsArticle` / `Article` 的 `articleBody`（Politico 通常为空） |
| 4 | Open Graph / `<h1>` / `<time>` | — | 仅补元数据 |
| 5 | DOM `main .lead-box p` | `dom` | SSR 渲染段落；通常只有前几段，作后备 |

**Cloudflare 检测：** 若页面标题为 “Just a moment...” 或含 “Enable JavaScript and cookies to continue”，返回 `Cloudflare challenge blocked fetch`，建议在 Chrome 中打开文章后重试。

**正文清洗：** adapter 会剥离 HTML 标签、广告段落、newsletter 引导语等，避免污染 `articleBody`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site politico/get-article "https://www.politico.com/news/..." --json --jq '{title, author, publishedAt, section, tags, source, bodyCharacterCount}'

# 正文段落数（按双换行分段）
bun-browser site politico/get-article "https://www.politico.com/news/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site politico/get-article "https://www.politico.com/news/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not a Politico URL`

`url` 必须是 `politico.com` 或 `*.politico.com` 上的文章链接。

```bash
bun-browser open https://www.politico.com --tab current
```

### `Cloudflare challenge blocked fetch`

Politico 的 Cloudflare 校验拦截了无头 `fetch`。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）

### `Could not extract full article body`

页面 HTML 中未找到可用的 Nuxt 正文，DOM 也只有少量段落。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再重试
3. 确认 URL 是标准文章页，而非首页或版块列表

### 需要登录吗？

- **不强制登录**：Politico 大部分新闻文章在 Nuxt payload 中包含全文。
- adapter **不会**代替你完成登录；付费/会员内容若被截断，请在 Chrome 中自行登录后重试。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/politico/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Nuxt payload** — Politico 使用 Nuxt 3；adapter 实现了 `__NUXT_DATA__` devalue 反序列化以提取 `article.body`。
- **与 Agent 协作** — 用 `site info politico/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对 Politico 并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for Politico via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `politico/get-article <url>` | Fetch title, author, dates, section, tags, summary, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.politico.com/` in Chrome, run `bun-browser site update`.

**Cloudflare:** Politico sits behind Cloudflare. If fetch is blocked, open the article in Chrome first, then retry. Full text is extracted from embedded Nuxt data (`__NUXT__.data.article` or `__NUXT_DATA__`).

**Typical flow:** `bun-browser open <article-url>` → wait for load → `politico/get-article <same-url>`.

**Errors:** `Cloudflare challenge blocked fetch` or `Could not extract full article body` — open the article in Chrome and retry.

**Per-command docs:** `bun-browser site info politico/get-article`
