# Gizmodo 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **Gizmodo 文章全文与元数据**。从 Yoast JSON-LD 与 WordPress `.entry-content` 提取正文；无需 Gizmodo API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中先打开 Gizmodo（站点有 Cloudflare 保护，浏览器 session 更稳）

```bash
bun-browser open https://gizmodo.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep gizmodo   # 应看到 1 个命令
```

> adapter 在 `gizmodo.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 Cookie。若 `fetch` 被 Cloudflare 拦截，请先在 Chrome 中打开文章并等待加载完成。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `gizmodo/get-article` | 读取文章标题、作者、日期、摘要、分类、标签与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info gizmodo/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site gizmodo/get-article "https://gizmodo.com/supposedly-the-unveiling-of-a-hovering-tesla-has-not-been-canceled-just-postponed-until-august-2000768416"
```

### 先打开再读（Cloudflare 更稳）

若直接 `fetch` 返回 Cloudflare 挑战页，可先在 Chrome 打开该文，等页面完全加载后再执行命令——adapter 会优先读取当前 tab 内已渲染的 `.entry-content`：

```bash
bun-browser open "https://gizmodo.com/supposedly-the-unveiling-of-a-hovering-tesla-has-not-been-canceled-just-postponed-until-august-2000768416" --tab current
# 等待 Cloudflare 校验通过、文章加载完成
bun-browser site gizmodo/get-article "https://gizmodo.com/supposedly-the-unveiling-of-a-hovering-tesla-has-not-been-canceled-just-postponed-until-august-2000768416"
```

### 只取元数据或正文长度

```bash
bun-browser site gizmodo/get-article "https://gizmodo.com/..." --json --jq '{title, author, publishedAt, section, tags, bodyCharacterCount, source}'
```

### 正文前 500 字预览

```bash
bun-browser site gizmodo/get-article "https://gizmodo.com/..." --json --jq '.articleBody[:500]'
```

---

## gizmodo/get-article — 读取文章

从 Gizmodo 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site gizmodo/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Gizmodo 文章链接（`gizmodo.com` 或 `*.gizmodo.com`）；可省略 `https://` 前缀 |

**示例 URL：**

- `https://gizmodo.com/supposedly-the-unveiling-of-a-hovering-tesla-has-not-been-canceled-just-postponed-until-august-2000768416`
- `https://www.gizmodo.com/...`（自动规范化）

**成功返回示例：**

```json
{
  "url": "https://gizmodo.com/supposedly-the-unveiling-of-a-hovering-tesla-has-not-been-canceled-just-postponed-until-august-2000768416",
  "title": "Supposedly, the Unveiling of a Hovering Tesla Has Not Been Canceled. Just Postponed Until August",
  "author": "Mike Pearl",
  "publishedAt": "2026-06-06T21:05:06+00:00",
  "dateModified": "2026-06-06T21:05:06+00:00",
  "description": "Elon Musk says a lot of things are coming soon. One of those things is a thruster-powered, hovering car.",
  "section": "Tech News",
  "categories": ["Tech News", "Transportation"],
  "tags": ["flying cars", "SPACEX", "TESLA", "Tesla Roadster"],
  "wordCount": 387,
  "articleBody": "For about nine years Elon Musk has claimed...",
  "bodyCharacterCount": 2400,
  "source": "dom"
}
```

| 字段 | 说明 |
|------|------|
| `source` | 正文来源：`openPage` / `dom` / `jsonLd` |
| `section` | 主分类（页眉 eyebrow） |
| `categories` | Yoast JSON-LD `articleSection` |
| `tags` | Yoast JSON-LD `keywords` 或页面 tag 链接 |
| `wordCount` | Yoast 标注的字数（若有） |

**正文提取：** 优先从已打开文章的 `.entry-content` 读取段落、列表与推文引用；`fetch` 路径解析同结构 HTML。广告位（`od-wrapper`、`cnx-player`）与脚本块会被跳过。

---

## 常见错误

### `Not a Gizmodo URL`

`url` 必须是 `gizmodo.com` 或 `*.gizmodo.com` 上的文章链接。

```bash
bun-browser open https://gizmodo.com --tab current
```

### `Cloudflare challenge blocked fetch`

Gizmodo 使用 Cloudflare 保护。无浏览器 Cookie 的 `fetch` 可能返回 “Just a moment...” 挑战页。

```bash
bun-browser open "<article-url>"
# 等待页面加载完成
bun-browser site gizmodo/get-article "<article-url>"
```

### `Could not extract article body`

页面 HTML 中未找到 `.entry-content`，或 Cloudflare 尚未放行。请在 Chrome 中打开文章后重试。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/gizmodo/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Cloudflare** — 检测 “Just a moment...” 与挑战页文案；已打开 tab 的 DOM 路径更可靠。
- **与 Agent 协作** — 用 `site info gizmodo/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for Gizmodo via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `gizmodo/get-article <url>` | Fetch title, author, dates, section, tags, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://gizmodo.com/` in Chrome, run `bun-browser site update`.

**Cloudflare:** Gizmodo is behind Cloudflare. `fetch` reuses browser cookies; if blocked, open the article in Chrome first, wait for the challenge to clear, then retry. Body is extracted from `.entry-content` (paragraphs, lists, blockquotes).

**Typical flow:** `bun-browser open <article-url>` → wait for load → `gizmodo/get-article <same-url>`.

**Errors:** `Cloudflare challenge blocked fetch` or `Could not extract article body` — open the article in Chrome and retry.

**Per-command docs:** `bun-browser site info gizmodo/get-article`
