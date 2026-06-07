# MarketWatch 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 **MarketWatch 文章全文与元数据**。优先从页面内嵌的 `__NEXT_DATA__`（`pageProps.article.body`）提取正文；无需 MarketWatch API Key。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 MarketWatch（订阅账号可提高成功率；非订阅有时只能拿到 preview）

```bash
bun-browser open https://www.marketwatch.com/ --tab current
# 如有订阅，在 Chrome 中完成登录
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep marketwatch   # 应看到 1 个命令
```

> adapter 在 `www.marketwatch.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若当前没有对应标签页，bun-browser 会自动打开 MarketWatch。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `marketwatch/get-article` | 读取文章标题、作者、日期、摘要、版块与正文 | 抓取全文、做摘要、Agent 读新闻 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info marketwatch/get-article
```

## 推荐工作流

### 单篇阅读

```bash
bun-browser site marketwatch/get-article "https://www.marketwatch.com/story/no-one-seems-to-wear-their-bling-is-it-safe-to-show-off-your-expensive-jewelry-a807bc55"
```

### 先打开再读（订阅文章更稳）

若直接 `fetch` 只能拿到 preview 或 paywall 占位，可先在 Chrome 打开该文，再在同一 tab 执行命令——adapter 会优先读取当前页内的 `__NEXT_DATA__` 与已渲染段落：

```bash
bun-browser open "https://www.marketwatch.com/story/no-one-seems-to-wear-their-bling-is-it-safe-to-show-off-your-expensive-jewelry-a807bc55" --tab current
# 等待页面加载完成
bun-browser site marketwatch/get-article "https://www.marketwatch.com/story/no-one-seems-to-wear-their-bling-is-it-safe-to-show-off-your-expensive-jewelry-a807bc55"
```

### 只取元数据或正文长度

```bash
bun-browser site marketwatch/get-article "https://www.marketwatch.com/story/..." --json --jq '{title, author, publishedAt, section, bodyCharacterCount, paywallBypassed, isUnlocked, source}'
```

### 正文前 500 字预览

```bash
bun-browser site marketwatch/get-article "https://www.marketwatch.com/story/..." --json --jq '.articleBody[:500]'
```

---

## marketwatch/get-article — 读取文章

从 MarketWatch 文章 URL 提取结构化内容与正文纯文本。

```bash
bun-browser site marketwatch/get-article "<url>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | MarketWatch 文章链接（`marketwatch.com` 或 `*.marketwatch.com`）；可省略 `https://` 前缀 |

**示例 URL：**

- `https://www.marketwatch.com/story/no-one-seems-to-wear-their-bling-is-it-safe-to-show-off-your-expensive-jewelry-a807bc55`
- `https://marketwatch.com/story/...`（自动规范化）

**成功返回示例：**

```json
{
  "url": "https://www.marketwatch.com/story/...",
  "title": "Article headline",
  "author": "Author Name",
  "publishedAt": "2026-06-03T10:15:00Z",
  "dateModified": "2026-06-06T23:16:00Z",
  "description": "Standfirst or summary",
  "section": "Personal Finance",
  "articleBody": "Full article text...",
  "bodyCharacterCount": 4200,
  "source": "nextData",
  "isUnlocked": true,
  "isFree": false,
  "paywallBypassed": true
}
```

| 字段 | 说明 |
|------|------|
| `source` | 正文来源：`nextData` / `openPage` / `dom` / `jsonLd` |
| `isUnlocked` | MarketWatch 是否标记文章已解锁 |
| `isFree` | 是否为免费文章 |
| `paywallBypassed` | 正文是否来自嵌入式数据且已解锁（非 DOM 预览） |

**Paywall 检测：** 若 `isUnlocked: false` 且正文块数不超过 `paywallIndex`，或正文含订阅提示语，视为预览而非全文，返回错误而非成功结果。

---

## 常见错误

### `Not a MarketWatch URL`

`url` 必须是 `marketwatch.com` 或 `*.marketwatch.com` 上的文章链接。

```bash
bun-browser open https://www.marketwatch.com --tab current
```

### `Bot challenge blocked fetch`

MarketWatch 使用 bot 防护。请先在 Chrome 打开文章并等待加载完成，再重试。

### `Only paywall preview available`

MarketWatch 以 preview 模式返回了部分正文。请在 Chrome 中用订阅账号打开文章后重试。

### `paywallBypassed: false` 但返回了正文

正文来自 DOM（`source: "dom"`）时，`paywallBypassed` 为 `false`，内容可能不完整。以 `paywallBypassed: true` 且 `source` 为 `nextData` / `openPage` 为准更可靠。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/marketwatch/`，同名文件会覆盖社区版。

---

## 技术说明

- **只读** — `readOnly: true`，不会发帖、评论或修改账号设置。
- **网络** — 声明 `capabilities: ["network"]`，会对文章 URL 发起 `fetch`（带浏览器 Cookie）。
- **Paywall 策略** — 优先 `__NEXT_DATA__.props.pageProps.article.body`；DOM 为后备。MarketWatch 前端结构变更可能导致需更新 adapter。
- **与 Agent 协作** — 用 `site info marketwatch/get-article` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。

适配器源码：`get-article.js`

---

## English summary

One read-only CLI command for MarketWatch via bun-browser (no API key):

| Command | Purpose |
|---------|---------|
| `marketwatch/get-article <url>` | Fetch title, author, dates, section, summary, and full article body |

**Prerequisites:** `bun-browser start`, optionally open `https://www.marketwatch.com/` and log in with a subscription, run `bun-browser site update`.

**Paywall:** Full text is extracted from embedded `__NEXT_DATA__` (`pageProps.article.body`), not the paywall DOM preview. If that fails, open the article in Chrome first, then retry. `paywallBypassed: true` when body came from `nextData` / `openPage` and the article is unlocked.

**Typical flow:** `bun-browser open <article-url>` → wait for load → `marketwatch/get-article <same-url>`.

**Errors:** `Could not extract full article body` or `Only paywall preview available` — open the article in a logged-in tab and retry.

**Per-command docs:** `bun-browser site info marketwatch/get-article`
