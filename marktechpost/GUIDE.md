# MarkTechPost 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **MarkTechPost 文章全文与元数据**。从 WordPress Newspaper 主题的 `.td-post-content` 提取正文，并解析 Yoast SEO JSON-LD 元数据；无需 API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep marktechpost   # 应看到 1 个命令
```

> adapter 在 `www.marktechpost.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 MarkTechPost。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `marktechpost/get-article` | 读取文章标题、作者、日期、分类与正文 | 抓取 AI 新闻、做摘要、Agent 读文章 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info marktechpost/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site marktechpost/get-article "https://www.marktechpost.com/2026/06/06/nvidia-releases-nemotron-3-5-asr-a-600m-parameter-cache-aware-streaming-model-transcribing-40-language-locales-in-real-time/"
```

### 先打开再读（动态内容更稳）

若直接 `fetch` 拿不到完整正文，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内已渲染的 `.td-post-content`：

```bash
bun-browser open "https://www.marktechpost.com/2026/06/06/nvidia-releases-nemotron-3-5-asr-a-600m-parameter-cache-aware-streaming-model-transcribing-40-language-locales-in-real-time/" --tab current
# 等待页面加载完成
bun-browser site marktechpost/get-article "https://www.marktechpost.com/2026/06/06/nvidia-releases-nemotron-3-5-asr-a-600m-parameter-cache-aware-streaming-model-transcribing-40-language-locales-in-real-time/"
```

### 只取元数据或正文长度

```bash
bun-browser site marktechpost/get-article "https://www.marktechpost.com/..." --json --jq '{title, author, publishedAt, categories, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site marktechpost/get-article "https://www.marktechpost.com/..." --json --jq '.articleBody[:500]'
```

---

## marktechpost/get-article — 读取文章

从 MarkTechPost 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site marktechpost/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | MarkTechPost 文章链接（`marktechpost.com` 或 `www.marktechpost.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.marktechpost.com/2026/06/06/nvidia-releases-nemotron-3-5-asr-.../`
- `https://marktechpost.com/...`（自动规范化）
- 教程、新闻、榜单类文章（如 vibe coding tools 对比文）

**返回示例（成功）**

```json
{
  "url": "https://www.marktechpost.com/2026/06/06/nvidia-releases-nemotron-3-5-asr-.../",
  "title": "NVIDIA Releases Nemotron 3.5 ASR: A 600M-Parameter Cache-Aware Streaming Model...",
  "author": "Asif Razzaq",
  "publishedAt": "2026-06-06T07:55:40+00:00",
  "dateModified": "2026-06-06T07:55:44+00:00",
  "description": "NVIDIA Nemotron 3.5 ASR is an open-weights 600M streaming speech model...",
  "categories": ["Editors Pick", "Agentic AI", "Voice AI"],
  "wordCount": 1467,
  "articleBody": "NVIDIA's Nemotron Speech team has released Nemotron 3.5 ASR...\n\nWhat is Nemotron 3.5 ASR\n\n...",
  "bodyCharacterCount": 8420,
  "source": "dom"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者；解析失败时为 `null` |
| `publishedAt` | 首次发布时间（ISO 8601） |
| `dateModified` | 最后修改时间 |
| `description` | 摘要（og:description / meta description） |
| `categories` | 文章分类标签数组 |
| `wordCount` | Yoast JSON-LD 中的字数（若有） |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔；列表项以 `- ` 或 `1.` 前缀） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（见下方 [解析顺序](#解析顺序)） |

---

## 解析顺序

adapter 按以下优先级合并元数据与正文（正文取**最长**的版本）：

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|-------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` | 读取 live DOM 中的 `.td-post-content`，最多轮询约 2 秒 |
| 2 | `fetch` 后 HTML 中的 Yoast JSON-LD | — | 仅补元数据（标题、作者、日期、分类、wordCount）；MarkTechPost 通常不含 `articleBody` |
| 3 | Open Graph / `<meta>` / `<h1>` | — | 补元数据 |
| 4 | DOM `.td-post-content` | `dom` | 从段落、标题、列表、引用块提取正文；过滤广告与 newsletter 占位 |

**正文清洗：** adapter 会跳过内嵌广告（`ai-viewports`）、Beehiiv 表单、figure 图片说明占位，以及 newsletter / affiliate 引导语等 boilerplate。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 元数据一览
bun-browser site marktechpost/get-article "https://www.marktechpost.com/..." --json --jq '{title, author, publishedAt, categories, source}'

# 正文段落数（按双换行分段）
bun-browser site marktechpost/get-article "https://www.marktechpost.com/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'

# 标题 + 前 200 字
bun-browser site marktechpost/get-article "https://www.marktechpost.com/..." --json --jq '{title, preview: .articleBody[:200]}'
```

---

## 常见问题

### `Not a MarkTechPost URL`

`url` 必须是 `marktechpost.com` 或 `www.marktechpost.com` 上的文章链接。

```bash
bun-browser open https://www.marktechpost.com --tab current
```

### `HTTP 4xx` / `HTTP 5xx`

文章可能已下线或当前 session 无法访问。

```bash
bun-browser open "<同一 URL>" --tab current
# 在 Chrome 中确认能打开后重试
bun-browser site marktechpost/get-article "<url>"
```

### `Could not extract article body`

页面 HTML 中未找到 `.td-post-content`，或正文被识别为空。

**建议：**

1. 在 Chrome 中打开该文章
2. 等页面完全加载后再执行 `get-article`（会走 `openPage` 路径）
3. 确认 URL 是标准文章页，而非首页或分类列表

### 需要登录吗？

MarkTechPost 文章通常公开可读，**不强制登录**。adapter 不会代替你完成登录。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/marktechpost/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **主题** — MarkTechPost 使用 WordPress Newspaper 主题；前端结构变更可能导致需更新 adapter。
- **与 Agent 协作** — 用 `site info marktechpost/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。
- **速率** — 批量抓取时建议串行，避免对站点并发过高。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for MarkTechPost via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `marktechpost/get-article <url>` | Fetch title, author, dates, categories, summary, and full article body |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`.

**Extraction:** Metadata from Yoast JSON-LD and Open Graph; body from `.td-post-content` (paragraphs, headings, lists). If fetch fails, open the article in Chrome first, then retry (`openPage` path).

**Typical flow:** `bun-browser site marktechpost/get-article <article-url>`

**Errors:** `Could not extract article body` — open the article in a loaded tab and retry.

**Per-command docs:** `bun-browser site info marktechpost/get-article`
