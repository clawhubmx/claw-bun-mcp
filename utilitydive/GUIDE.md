# Utility Dive 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Utility Dive 文章全文与元数据**。从 `.article-body` 提取正文，并过滤全屏 newsletter prestitial、广告位与页脚推荐模块；无需 API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 Utility Dive

```bash
bun-browser open https://www.utilitydive.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep utilitydive   # 应看到 1 个命令
```

> adapter 在 `www.utilitydive.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `utilitydive/get-article` | 读取文章标题、作者、日期、类型、标签与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info utilitydive/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site utilitydive/get-article "https://www.utilitydive.com/news/alex-fitzsimmons-energy-markets-ai-renewables/822095/"
```

### 先打开再读（全屏 signup 更稳）

Utility Dive 可能对首次访问弹出全屏 newsletter prestitial（**CONTINUE TO SITE**）。若正文被遮挡或提取失败，先在 Chrome 打开文章并点击 **CONTINUE TO SITE**，再执行命令——adapter 会尝试自动关闭 overlay，并优先读取已渲染的 `.article-body`：

```bash
bun-browser open "https://www.utilitydive.com/news/alex-fitzsimmons-energy-markets-ai-renewables/822095/" --tab current
# 如有全屏 signup，点击 CONTINUE TO SITE
bun-browser site utilitydive/get-article "https://www.utilitydive.com/news/alex-fitzsimmons-energy-markets-ai-renewables/822095/"
```

### 只取元数据或正文长度

```bash
bun-browser site utilitydive/get-article "https://www.utilitydive.com/news/..." --json --jq '{title, author, publishedAt, articleType, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site utilitydive/get-article "https://www.utilitydive.com/news/..." --json --jq '.articleBody[:500]'
```

---

## utilitydive/get-article — 读取文章

从 Utility Dive 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site utilitydive/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Utility Dive 文章链接（`utilitydive.com` 或 `www.utilitydive.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://www.utilitydive.com/news/alex-fitzsimmons-energy-markets-ai-renewables/822095/`
- `https://utilitydive.com/news/...`（自动规范化）

**返回示例（成功）**

```json
{
  "url": "https://www.utilitydive.com/news/alex-fitzsimmons-energy-markets-ai-renewables/822095/",
  "title": "DOE’s Alex Fitzsimmons on energy markets, AI, renewables and more",
  "author": "Meris Lutz",
  "publishedAt": "2026-06-05T07:39:20",
  "dateModified": null,
  "description": "Utility Dive caught up with the associate deputy secretary of energy at the Edison Electric Institute conference in Las Vegas...",
  "articleType": "Q&A",
  "tags": ["generation", "regs", "affordabilityrates", "federal policy", "large loads"],
  "articleBody": "U.S. Department of Energy Associate Deputy Secretary...\n\nUTILITY DIVE: DOE under this administration...",
  "bodyCharacterCount": 14200,
  "source": "dom"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `title` | 标题 |
| `author` | 作者 |
| `publishedAt` | 发布时间（ISO 8601 或页面日期） |
| `dateModified` | 最后修改时间（若有） |
| `description` | 摘要 / deck |
| `articleType` | 文章类型（如 Q&A、Deep Dive） |
| `tags` | 主题标签 |
| `articleBody` | 正文纯文本（段落以 `\n\n` 分隔） |
| `bodyCharacterCount` | 正文字符数 |
| `source` | 正文来源（`openPage` / `dom` / `jsonLd`） |

---

## 解析顺序

| 优先级 | 来源 | `source` 值 | 说明 |
|--------|------|---------------|------|
| 1 | 当前 tab 已打开同一篇文章 | `openPage` | 自动关闭 prestitial / signup modal，读取 `.article-body` |
| 2 | `fetch` 后 HTML 中的 `.article-body` | `dom` | 主要提取路径；过滤广告与 newsletter 模块 |
| 3 | `application/ld+json` | `jsonLd` | `NewsArticle` 元数据（Utility Dive 通常不含 `articleBody`） |
| 4 | Open Graph / sailthru meta | — | 补元数据 |

**正文清洗：** adapter 会跳过 `.hybrid-ad-wrapper`、`.text-to-speech`、`figure` 图片说明、Recommended Reading、Editors' picks、newsletter signup 等 boilerplate，避免污染 `articleBody`。

**Paywall / signup：** 全屏 newsletter prestitial 不是付费墙，但会遮挡页面。adapter 会检测 “Don't miss tomorrow's…”、“CONTINUE TO SITE” 等占位文本并返回错误，提示先关闭 overlay。

---

## 用 jq 过滤 JSON

```bash
# 元数据一览
bun-browser site utilitydive/get-article "https://www.utilitydive.com/news/..." --json --jq '{title, author, publishedAt, articleType, source, bodyCharacterCount}'

# 正文段落数
bun-browser site utilitydive/get-article "https://www.utilitydive.com/news/..." --json --jq '[.articleBody | split("\n\n")[] | select(length > 0)] | length'
```

---

## 常见问题

### `Not a Utility Dive URL`

`url` 必须是 `utilitydive.com` 或 `www.utilitydive.com` 上的文章链接。

### `Could not extract article body`

页面可能被全屏 signup 遮挡，或 URL 不是标准文章页。

**建议：** 在 Chrome 中打开该文，点击 **CONTINUE TO SITE**，再重试。

### `Only newsletter/paywall content available`

提取到的正文被识别为 newsletter prestitial 占位。返回中会附带 `preview` 以及已解析的元数据。

---

## 技术说明

- **只读** — `readOnly: true`
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）
- **Industry Dive 平台** — Utility Dive 与 Smart Cities Dive、Waste Dive 等同属 Industry Dive；本 adapter 仅覆盖 `utilitydive.com`
- **与 Agent 协作** — 用 `site info utilitydive/get-article` 查看 `@meta`

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for Utility Dive via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `utilitydive/get-article <url>` | Fetch title, author, dates, article type, tags, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.utilitydive.com/`, run `bun-browser site update`.

**Signup overlay:** Utility Dive may show a full-screen newsletter prestitial. The adapter strips ad slots and signup boilerplate from `.article-body`. If blocked, open the article in Chrome, click **CONTINUE TO SITE**, then retry.

**Typical flow:** `bun-browser open <article-url>` → dismiss overlay if shown → `utilitydive/get-article <same-url>`.

**Per-command docs:** `bun-browser site info utilitydive/get-article`
