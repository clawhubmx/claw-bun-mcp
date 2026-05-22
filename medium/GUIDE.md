# Medium 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里搜索、读取和起草 Medium 文章。无需 Medium API Key、无需手动导出 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开 Medium（搜索与读文章建议登录；会员文章需要对应权限）

```bash
bun-browser open https://medium.com/ --tab current
# 在 Chrome 中完成登录
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep medium   # 应看到 3 个命令
```

> 所有 adapter 在 `medium.com` 或 `*.medium.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若返回 `HTTP 401/403` 或 hint 提示未登录，请先在 Chrome 中登录 Medium 后重试。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `medium/search` | 站内搜索 | 按关键词找文章 |
| `medium/get-article` | 读取文章正文与元数据 | 抓取全文、摘要、作者、发布时间 |
| `medium/publish-article` | 打开编辑器并写入标题/正文 | 半自动起草新文章（需手动发布） |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info medium/search
bun-browser site info medium/get-article
bun-browser site info medium/publish-article
```

## 推荐工作流

### 研究一个主题（搜索 → 读全文）

```bash
# 1. 搜索
bun-browser site medium/search "typescript graphql" --count 10

# 2. 从返回的 url 读取正文
bun-browser site medium/get-article "https://medium.com/@user/some-post-slug"
bun-browser site medium/get-article "https://towardsdatascience.com/some-article-slug-abc123"
```

### 批量抓取搜索结果

```bash
# 搜索并只取标题与链接
bun-browser site medium/search "machine learning" --count 15 --json --jq '.results[] | {title, url}'

# 对单篇取正文长度与作者
bun-browser site medium/get-article "https://medium.com/p/abc123def456" --json --jq '{title, author, bodyCharacterCount}'
```

### 起草并发布新文章

`medium/publish-article` 会打开 Medium 编辑器并尝试写入标题与正文。**标签、副标题、原创链接、存草稿与正式发布尚未自动化**，需在页面内手动完成。

```bash
# 1. 打开新建文章页（首次运行会自动跳转）
bun-browser open https://medium.com/new-story --tab current

# 2. 写入标题与正文（若刚跳转，需等页面加载后再运行一次）
bun-browser site medium/publish-article \
  --title "My First Post" \
  --content "# Hello\n\nThis is the body.\n\nSecond paragraph."

# 3. 在 Chrome 中手动添加标签、设置封面、点击 Publish
```

> **两阶段执行：** 若当前 tab 不在 `/new-story`，adapter 会先 `location.assign` 跳转并返回 `Redirecting to editor`。等编辑器加载完成后，**再次运行同一命令** 才会写入内容。

---

## medium/search — 站内搜索

```bash
bun-browser site medium/search "<query>" [--count N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词 |
| `--count` | ❌ | `15` | 最多返回条数，上限 30 |

**返回示例**

```json
{
  "query": "typescript graphql",
  "count": 10,
  "results": [
    {
      "title": "Building GraphQL APIs with TypeScript",
      "url": "https://medium.com/@author/building-graphql-apis-with-typescript-abc123",
      "excerpt": "A practical guide to..."
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `query` | 本次搜索关键词 |
| `count` | 实际返回条数 |
| `results[].title` | 文章标题 |
| `results[].url` | 完整文章 URL（`medium.com` 或 publication 子域） |
| `results[].excerpt` | 摘要；若页面无摘要字段可能为空字符串 |

**实现说明：** adapter 请求 `https://medium.com/search?q=...`，优先从 `__NEXT_DATA__` 解析结构化结果；若 Next 数据不可用，则回退到页面内 `<a>` 链接提取。

---

## medium/get-article — 读取文章

```bash
bun-browser site medium/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Medium 文章链接（`medium.com` 或 `*.medium.com`）；可省略 `https://` 前缀 |

**支持的 URL 形式**

- `https://medium.com/@username/post-slug`
- `https://medium.com/p/abc123def456`
- `https://towardsdatascience.com/post-slug-abc123`（publication 子域）

**返回示例**

```json
{
  "url": "https://medium.com/@author/post-slug-abc123",
  "title": "Article Title",
  "author": "Author Name",
  "publishedAt": "2026-03-15T01:40:31.000Z",
  "description": "Short description from meta or JSON-LD",
  "articleBody": "Full article text...",
  "bodyCharacterCount": 4523
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终 URL（跟随重定向后） |
| `title` | 标题；解析失败时为 `null` |
| `author` | 作者名；解析失败时为 `null` |
| `publishedAt` | ISO 8601 发布时间 |
| `description` | 摘要 / og:description |
| `articleBody` | 正文纯文本 |
| `bodyCharacterCount` | 正文字符数 |

**解析顺序：**

1. 页面内 `application/ld+json`（`BlogPosting` / `Article` / `NewsArticle`）
2. Open Graph meta（`og:title`、`og:description`）
3. `<article>` 元素的 `innerText` 回退

> **会员文章：** 若当前 session 无阅读权限，可能返回 `HTTP 403` 或正文为空。请先在 Chrome 中确认能正常打开该文章。

---

## medium/publish-article — 起草新文章

```bash
bun-browser site medium/publish-article \
  --title "<title>" \
  --content "<body>" \
  [--tags "tag1,tag2"] \
  [--subtitle "..."] \
  [--canonicalUrl "..."] \
  [--isDraft true]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--title` | ✅ | 文章标题 |
| `--content` | ✅ | 正文（纯文本；双换行 `\n\n` 分段；**不支持完整 Markdown 渲染**） |
| `--tags` | ❌ | 逗号分隔标签，最多 5 个 — **尚未写入编辑器** |
| `--subtitle` | ❌ | 副标题 — **尚未写入** |
| `--canonicalUrl` | ❌ | 原创链接 — **尚未写入** |
| `--isDraft` | ❌ | 草稿标志 — **尚未接入 API** |

**返回示例（成功写入标题/正文）**

```json
{
  "partialSuccess": true,
  "title": "My First Post",
  "tagsRequested": ["tech", "ai"],
  "editorUrl": "https://medium.com/new-story",
  "hint": "已尝试写入标题与正文。标签、副标题、原创链接、存草稿与正式发布未自动化；请在页面内手动完成，或抓包后用 GraphQL/fetch 替换本 adapter。"
}
```

| 字段 | 说明 |
|------|------|
| `partialSuccess` | 标题/正文已尝试写入，但发布流程未完成 |
| `editorUrl` | 当前编辑器页面 URL |
| `tagsRequested` | 传入的标签（仅记录，未应用） |
| `hint` | 后续需手动完成的步骤说明 |

**执行要求：**

- 当前 tab 必须在 `medium.com` 或 `*.medium.com`
- 必须在 `/new-story` 或 `/p/<id>/edit` 页面（否则先跳转，需二次执行）
- adapter 等待约 2.5 秒让编辑器渲染，再通过 DOM `execCommand('insertText')` 写入

**content 格式提示**

```bash
# 段落之间用 \n\n 分隔
bun-browser site medium/publish-article \
  --title "Three Tips for Agents" \
  --content "Intro paragraph.\n\n## Section one\n\nDetail here.\n\n## Section two\n\nMore detail."
```

> `#` 等 Markdown 语法会作为**字面文本**插入，不会渲染为标题。如需富文本格式，请在编辑器内手动调整。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 搜索后只取标题
bun-browser site medium/search "rust async" --count 5 --json --jq '.results[].title'

# 读文章时只看元数据
bun-browser site medium/get-article "https://medium.com/@user/post" --json --jq '{title, author, publishedAt, bodyCharacterCount}'

# 正文前 200 字预览
bun-browser site medium/get-article "https://medium.com/p/abc123" --json --jq '.articleBody[:200]'
```

---

## 常见问题

### `HTTP 401` / `HTTP 403`（search 或 get-article）

当前浏览器未登录 Medium，或 session 已过期。

```bash
bun-browser open https://medium.com/ --tab current
# 在 Chrome 中登录后重试
```

### `Could not parse search results`

Medium 搜索页或 `__NEXT_DATA__` 结构可能已变更。

```bash
# 在浏览器中手动打开搜索页确认
bun-browser open "https://medium.com/search?q=test"

# 抓包排查（高级）
bun-browser network requests --with-body
```

### `Not a Medium URL`

`get-article` 只接受 `medium.com` 或 `*.medium.com` 域名。第三方转载链接请先在 Medium 上找到原文 URL。

### `HTTP 403` / 正文为空（get-article）

文章可能已删除、需要 Medium 会员，或当前账号无权限。在 Chrome 中直接打开同一 URL 确认。

### `Redirecting to editor`（publish-article）

正常现象。adapter 正在跳转到 `/new-story`。等编辑器加载完成后**再次运行同一命令**。

```bash
bun-browser open https://medium.com/new-story --tab current
# 等待 3–5 秒
bun-browser site medium/publish-article --title "..." --content "..."
```

### `Title field not found`

Medium 编辑器 DOM 已更新，现有选择器失效。可：

1. 在 `/new-story` 页用 DevTools 检查标题节点
2. 更新 `medium/publish-article.js` 中的选择器
3. 或抓包后用 GraphQL/fetch 直接调用发布 API（长期方案）

### 标签 / 副标题 / 发布未生效

当前 adapter 仅自动化**标题与正文**。`--tags`、`--subtitle`、`--canonicalUrl`、`--isDraft` 参数已预留但未接入 UI 或 API。请在 Chrome 编辑器内手动完成，或参考 `bun-browser network requests --with-body` 抓到的 GraphQL 请求扩展 adapter。

### Publication 子域文章

`get-article` 支持 `towardsdatascience.com`、`betterprogramming.pub` 等 Medium publication 子域。`search` 返回的 URL 可能指向子域，可直接传给 `get-article`。

---

## 技术说明

- **无需 Medium API** — 读操作通过 `fetch` + 页面 HTML/JSON-LD；写操作通过浏览器内 DOM 交互。
- **只读 vs 写入** — `medium/search` 与 `medium/get-article` 为 `readOnly: true`；`medium/publish-article` 为 `readOnly: false`，会修改编辑器内容但不会自动点击 Publish。
- **速率** — 批量抓取时建议串行执行，避免触发 Medium 限流。
- **Private adapter** — 可将修改版放到 `~/.bun-browser/sites/medium/`，同名文件会覆盖社区版。

---

## English summary

Three CLI commands for Medium via bun-browser (logged-in Chrome, no API key):

| Command | Purpose |
|---------|---------|
| `medium/search <query>` | Search Medium (max 30 results) |
| `medium/get-article <url>` | Fetch title, author, date, and full article body |
| `medium/publish-article --title ... --content ...` | Open editor and insert title/body (**partial** — tags/publish not automated) |

**Prerequisites:** `bun-browser start`, open `https://medium.com/` and log in, run `bun-browser site update`.

**Typical flow:** `search` → pick a URL → `get-article` for full text.

**Publishing:** Run on `/new-story` (may need two runs after redirect). Manually add tags and click Publish in Chrome.

**Docs per command:** `bun-browser site info medium/<command>`
