# Google News 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，将 **Google News RSS 跳转链接** 解析为原始.publisher URL。Google News 的 `news.google.com/rss/articles/...` 链接不会通过普通 HTTP 302 跳到原文，需要调用 Google 内部的 `garturlreq` batchexecute 协议（或离线解码旧格式）。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 建议在 Chrome 中打开 Google News（复用 Cookie / session）

```bash
bun-browser open https://news.google.com/ --tab current
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep googlenews   # 应看到 1 个命令
```

> adapter 在 `news.google.com` 域下执行，通过同源 `fetch` 调用 `/_/DotsSplashUi/data/batchexecute`。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `googlenews/resolve-url` | 将 Google News 跳转 URL 解析为原始文章链接 | RSS 订阅、Agent 读新闻前先拿真实 URL |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info googlenews/resolve-url
```

## 推荐工作流

### 解析 RSS 跳转链接

```bash
bun-browser site googlenews/resolve-url "https://news.google.com/rss/articles/CBMi0wFBVV95cUxPWmFZb0lkemZkR29IdHh5MWJBZm9HRXp3SEEtS1VqcS1NWEFfZVlrdHJnNTA5anRzX2VBWUdXVkRWZmxmUzUwaHFSODVQZ1VBV2gtZ29BT09PWm9WeU5ORmllMnJtQk94eXQ2bHRnRzhOWTBpSWhYUHVhRW9RR0FwdmxzUmJjN1YwWGtpUVcxM21kLXNSRVpQbGJNeV9xM2JRU055aDBsUlRCOUg0Q3hHUzNNelZsQWV0YUF5QWw4WjRDcVpxQnZNcmRxTVJpektKX284?oc=5"
```

示例输出：

```json
{
  "googleNewsUrl": "https://news.google.com/rss/articles/CBMi...?oc=5",
  "articleId": "CBMi...",
  "url": "https://balkangreenenergynews.com/clean-energy-transition-as-european-transformative-strategy-importance-of-fairness-cohesion-governance/",
  "method": "batchexecute"
}
```

### 只取原始 URL

```bash
bun-browser site googlenews/resolve-url "https://news.google.com/rss/articles/CBMi...?oc=5" --json --jq '.url'
```

### 解析后再读全文

拿到 `url` 后，用对应来源的 `get-article` adapter（如 `reuters/get-article`、`axios/get-article`）读取正文：

```bash
RESOLVED=$(bun-browser site googlenews/resolve-url "https://news.google.com/rss/articles/CBMi...?oc=5" --json --jq -r '.url')
bun-browser site reuters/get-article "$RESOLVED"
```

---

## googlenews/resolve-url — 解析跳转链接

从 Google News RSS / articles URL 提取 publisher 原始链接。

```bash
bun-browser site googlenews/resolve-url <google-news-url>
```

**支持的 URL 格式：**

- `https://news.google.com/rss/articles/CBMi...?oc=5`
- `https://news.google.com/articles/CBMi...`
- `https://news.google.com/read/...`

**返回字段：**

| 字段 | 说明 |
|------|------|
| `googleNewsUrl` | 输入的 Google News 链接 |
| `articleId` | URL 中的 base64 文章 ID |
| `url` | 解析出的原始 publisher URL |
| `method` | `offline`（旧格式内嵌 URL）或 `batchexecute`（2024+ 新格式） |

---

## 解析流程

| 步骤 | 方法 | 说明 |
|------|------|------|
| 1 | `offline` | 对旧版 base64 内嵌 URL 直接 `atob` 解码 |
| 2 | `batchexecute` | 抓取 `/articles/{id}` 页上的 `data-n-a-sg` / `data-n-a-ts`，POST 到 `/_/DotsSplashUi/data/batchexecute` |

**注意：** 不能用 `curl -L` 或 `fetch(..., redirect: "follow")` 直接跟跳——Google News 返回 200 + JavaScript 跳转页，真实 URL 必须通过 batchexecute 获取。

---

## 常见问题

### `Not a Google News URL`

`url` 必须是 `news.google.com` 上的 `/rss/articles/`、`/articles/` 或 `/read/` 链接。

### `Missing decoding params`

未能从 `/articles/{id}` 页面读取签名参数。先在 Chrome 打开 `https://news.google.com/`，再重试。

### `batchexecute returned no payload`

Google 可能更新了协议或 session 失效。刷新 news.google.com tab 后重试。

---

## 技术说明

- **只读** — `readOnly: true`
- **网络** — 声明 `capabilities: ["network"]`
- **域名** — `@meta.domain` 为 `news.google.com`（batchexecute 必须同源）
- **与 Agent 协作** — 用 `site info googlenews/resolve-url` 查看 `@meta`

适配器源码：`resolve-url.js`

---

## English summary

One read-only CLI command to resolve Google News RSS redirect URLs to the original publisher link:

| Command | Purpose |
|---------|---------|
| `googlenews/resolve-url <url>` | Decode `news.google.com/rss/articles/...` to the real article URL |

**Prerequisites:** `bun-browser start`, optionally open `https://news.google.com/`, run `bun-browser site update`.

**Why not HTTP redirects?** Google News wraps publisher links in encoded IDs. Standard redirect following stays on `news.google.com`; this adapter uses Google's internal `garturlreq` batchexecute API (with offline decode for legacy encodings).

**Typical flow:** `googlenews/resolve-url <google-news-url>` → use the returned `url` with a site-specific `get-article` command.

**Per-command docs:** `bun-browser site info googlenews/resolve-url`
