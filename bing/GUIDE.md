# Bing 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里执行 **Bing 网页搜索**并返回结构化结果（标题、链接、摘要）。无需登录、无需 API Key。

[English summary](#english-summary) · 中文正文

---

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep bing   # 应看到 1 个命令
bun-browser site info bing/search
```

> adapter 在 `www.bing.com` 域下执行。若当前没有对应标签页，bun-browser 会自动打开 Bing。**不需要登录 Microsoft 账号。**

---

## 命令一览

| 命令 | 说明 | 登录 |
|------|------|------|
| `bing/search` | Bing 网页搜索 (web search: title, url, snippet) | 否 |

适配器源码：`search.js`

---

## 推荐工作流

### 快速搜索

```bash
bun-browser site bing/search "Claude Code"
bun-browser site bing/search "bun-browser CLI"
```

### 指定结果条数

第二个位置参数或 `--count` 控制返回条数（默认 10）：

```bash
bun-browser site bing/search "TypeScript tutorial" 20
bun-browser site bing/search "TypeScript tutorial" --count 20
```

### 与其他搜索引擎对比

| 命令 | 适用场景 |
|------|----------|
| `bing/search` | 微软 Bing 索引，英文与部分中文结果 |
| `google/search` | Google 索引，DOM 结构更复杂、更新更频繁 |
| `duckduckgo/search` | DuckDuckGo HTML lite，无 JS，隐私向 |
| `baidu/search` | 中文与国内内容优先 |

```bash
bun-browser site bing/search "large language model"
bun-browser site google/search "large language model"
bun-browser site duckduckgo/search "large language model"
```

### 配合 jq 提取链接

```bash
bun-browser site bing/search "React 19" --json --jq '.results[] | {title, url}'
```

---

## `bing/search` — 网页搜索

在浏览器上下文中请求 Bing 搜索结果页 HTML，解析 `li.b_algo` 条目，返回标题、URL 与摘要。

```bash
bun-browser site bing/search "<query>" [count]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词 |
| `count` | ❌ | `10` | 期望结果条数（通过 URL `count` 参数传给 Bing） |

### 示例

```bash
bun-browser site bing/search "Claude Code"
bun-browser site bing/search "OpenAI API pricing" 20
bun-browser site bing/search "上海天气" --count 15
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `query` | 本次搜索词 |
| `count` | 实际解析到的结果条数（可能小于请求的 `count`） |
| `results` | 结果数组 |
| `results[].title` | 结果标题 |
| `results[].url` | 目标链接 |
| `results[].snippet` | 摘要文本（来自结果块内 `<p>`） |

**返回示例**

```json
{
  "query": "Claude Code",
  "count": 10,
  "results": [
    {
      "title": "Claude Code overview",
      "url": "https://example.com/claude-code",
      "snippet": "Claude Code is a command-line tool for..."
    }
  ]
}
```

### 常见错误

| `error` | 含义 | 建议 |
|---------|------|------|
| `query is required` | 未传搜索词 | 补上 `query`，如 `"Claude Code"` |
| `HTTP 4xx/5xx` | Bing 返回非 2xx | 检查网络；确认 `www.bing.com` 可访问 |

若页面结构变化导致 `count: 0`，见下方 [故障排查](#故障排查)。

---

## Agent / MCP 使用提示

- 任务关键词：`web search`、`Bing search`、`title`、`url`、`snippet`。
- 输入为 **搜索字符串**，支持中英文及引号包裹的多词查询。
- 输出为 JSON，适合 `--json` 或 MCP 工具链解析。
- 只读命令（`readOnly: true`），不会修改 Bing 账号或设置。

```bash
# Agent 函数签名（含 args、example、domain）
bun-browser site info bing/search
```

---

## 用 jq 过滤 JSON

```bash
# 只要标题和链接
bun-browser site bing/search "Rust async" --json --jq '.results[] | {title, url}'

# 结果数量
bun-browser site bing/search "Kubernetes" --json --jq '{query, count}'

# 第一条摘要
bun-browser site bing/search "LLM benchmark" --json --jq '.results[0].snippet'
```

---

## 技术说明

- **数据源** — `GET https://www.bing.com/search?q=...&count=...`，在 `www.bing.com` 标签页上下文中 `fetch`（`credentials: 'include'`）。
- **解析** — `DOMParser` + 选择器 `li.b_algo`；每条结果取 `h2 > a` 的标题与链接，以及块内 `<p>` 作为 `snippet`。
- **只读** — 不提交表单、不点击广告、不登录。
- **与 Google adapter 对比** — Bing 结构相对稳定（`b_algo`）；Google 使用多策略 DOM 解析且 fetch 与导航 HTML 可能不一致。

---

## 故障排查

1. **确认适配器已安装**

   ```bash
   bun-browser site info bing/search
   ```

   应显示 `@meta` 中的 `args.query`、`args.count` 与 `example`。

2. **确认 daemon 与浏览器**

   ```bash
   bun-browser status
   bun-browser start
   bun-browser open https://www.bing.com/ --tab current
   ```

3. **返回 `count: 0` 或空 `results`**

   - Bing 可能更新了 HTML 结构（`li.b_algo` 变更）
   - 可能触发验证码或地区限制 — 在浏览器中手动打开 Bing 搜索同一关键词，确认页面正常
   - 尝试缩短或改写 `query`

4. **JSON 调试**

   ```bash
   bun-browser site bing/search "test query" --json
   ```

5. **私有覆盖**

   可将自定义脚本放到 `~/.bun-browser/sites/bing/search.js`，同名命令会覆盖社区版本（例如更换选择器或增加 `market`/`setlang` 参数）。

---

## 相关链接

- [bb-sites 总览](../README.md)
- [Google 搜索适配器](../google/search.js)
- [DuckDuckGo 搜索适配器](../duckduckgo/search.js)
- [Bing](https://www.bing.com/)

---

## English summary

One read-only CLI command for Bing web search via bun-browser (Chrome context, no login, no API key):

| Command | Purpose |
|---------|---------|
| `bing/search <query> [count]` | Bing web search (default 10 results) |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`. A tab on `www.bing.com` is opened automatically if needed.

**Examples:**

```bash
bun-browser site bing/search "Claude Code"
bun-browser site bing/search "TypeScript tutorial"
```

**Key fields:** `query`, `count`, `results[].title`, `results[].url`, `results[].snippet`.

**Related:** `google/search`, `duckduckgo/search`, `baidu/search` for other search engines.

**Docs:** `bun-browser site info bing/search`
