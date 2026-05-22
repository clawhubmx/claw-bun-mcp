# 36氪使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里拉取 [36氪快讯](https://36kr.com/newsflashes) — 科技、创投、商业领域的实时短讯。无需 API Key，**通常无需登录**。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep 36kr   # 应看到 1 个命令
```

> adapter 优先调用 36氪 gateway API；若 API 不可用，会回退到解析 `36kr.com/newsflashes` 页面 SSR 数据。回退路径依赖浏览器 session，若失败请先打开 36氪：

```bash
bun-browser open https://36kr.com/ --tab current
```

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `36kr/newsflash` | 36氪快讯列表 (newsflash: title, description, timestamp, url) | 每日扫创投热点、监控行业动态、Agent 资讯摘要 |

查看完整参数（Agent 函数签名）：

```bash
bun-browser site info 36kr/newsflash
```

## 推荐工作流

### 快速浏览最新快讯

```bash
# 默认 20 条
bun-browser site 36kr/newsflash

# 只要 10 条标题与时间
bun-browser site 36kr/newsflash 10 --json --jq '.items[] | {rank, title, timestamp, url}'
```

### 拉更多条做日报 / 摘要

```bash
bun-browser site 36kr/newsflash 50 --json
```

### 从快讯链接深入阅读

返回的每条 `url` 指向 `https://36kr.com/newsflashes/{id}`，可在浏览器中打开全文：

```bash
bun-browser open "https://36kr.com/newsflashes/1234567890123456" --tab current
bun-browser snapshot
```

---

## 36kr/newsflash — 快讯列表

调用 `POST https://gateway.36kr.com/api/mis/nav/newsflash/flow`，返回最新快讯流；失败时解析快讯页 `window.initialState`。

```bash
bun-browser site 36kr/newsflash [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `20` | 返回条数，上限 **50** |

**示例**

```bash
bun-browser site 36kr/newsflash
bun-browser site 36kr/newsflash 10
bun-browser site 36kr/newsflash 50 --json --jq '.items[] | {rank, title, description, url}'
```

**返回示例**

```json
{
  "count": 20,
  "items": [
    {
      "rank": 1,
      "id": "1234567890123456",
      "title": "某科技公司完成 B 轮融资",
      "description": "36氪获悉，该公司本轮融资由…",
      "timestamp": "2026-05-22T08:30:00.000Z",
      "url": "https://36kr.com/newsflashes/1234567890123456"
    }
  ]
}
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `count` | 实际返回条数 |
| `items[]` | 快讯列表，按时间倒序（最新在前） |
| `items[].rank` | 序号（从 1 开始） |
| `items[].id` | 快讯 ID |
| `items[].title` | 标题 |
| `items[].description` | 正文摘要（**最多 500 字符**） |
| `items[].timestamp` | 发布时间（ISO 8601）；缺失时为 `null` |
| `items[].url` | 快讯详情页链接 |
| `source` | 仅 SSR 回退成功时出现，值为 `ssr_fallback` |

> `description` 为 adapter 截断后的摘要，便于 Agent 上下文控制。需要全文请用返回的 `url` 在浏览器打开，或使用 `bun-browser snapshot` / `bun-browser get`。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 标题 + 链接
bun-browser site 36kr/newsflash 15 --json --jq '.items[] | {rank, title, url}'

# 只看今天（需 jq 支持 date 比较，或人工筛选 timestamp）
bun-browser site 36kr/newsflash 30 --json --jq '.items[] | select(.timestamp != null) | {title, timestamp}'

# 导出纯 URL 列表
bun-browser site 36kr/newsflash 20 --json --jq '.items[].url' -r
```

---

## Agent / MCP 使用提示

- 任务关键词：`newsflash`、`36kr`、`创投快讯`、`科技资讯`
- 只读命令（`readOnly: true`），不会发帖或修改账号
- 适合与 `eastmoney/news`、`toutiao/hot` 等资讯类 adapter 组合做「创投 + 财经」早报
- 输出 JSON 结构化，适合 `--json` 或 MCP 工具链解析

典型组合：

```bash
# 创投快讯 + A 股财经新闻
bun-browser site 36kr/newsflash 15
bun-browser site eastmoney/news --count 10
```

---

## 常见问题

### `HTTP 4xx/5xx` / `Navigate to 36kr.com first`

Gateway API 与 SSR 回退均失败。先在 Chrome 中打开 36氪，再重试：

```bash
bun-browser open https://36kr.com/newsflashes --tab current
bun-browser site 36kr/newsflash
```

### `API error: …`

Gateway 返回业务错误（`code !== 0`）。稍后重试；若持续失败，adapter 会自动尝试 SSR 回退（需能访问 `36kr.com/newsflashes`）。

### `Failed to parse page data` / `JSON parse failed`

SSR 回退时页面结构变更或数据未嵌入 `window.initialState`。可先在浏览器打开快讯页确认能正常加载，然后 `bun-browser site update` 获取最新 adapter。

### 快讯条数少于请求的 `count`

API 或页面当前可用数据不足；返回的 `count` 为实际条数。

### 与网页/App 顺序略有差异

数据来自 gateway 快讯流接口，与 36氪 Web/App 可能存在 slight 时差或排序差异，属正常现象。

### 请求过于频繁

批量定时拉取时建议间隔 **30 秒以上**，避免触发限流。

---

## 技术说明

| 路径 | 说明 |
|------|------|
| **主路径** | `POST gateway.36kr.com/api/mis/nav/newsflash/flow`（`partner_id: web`，`pageSize: count`） |
| **回退** | `GET 36kr.com/newsflashes`，解析 `window.initialState` 中的 `newsflashList` |

- **domain:** `36kr.com`
- **capabilities:** `network`
- **只读** — 不会修改 36氪账号或内容
- **Private adapter** — 可将修改版放到 `~/.bun-browser/sites/36kr/`，同名文件会覆盖社区版

---

## English summary

One read-only CLI command for **36Kr (36氪) news flashes** via bun-browser:

| Command | Purpose |
|---------|---------|
| `36kr/newsflash [count]` | Latest breaking news flashes (title, description, timestamp, url; max 50) |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`. Login is usually **not** required; if the API fails, open `https://36kr.com/` in Chrome and retry.

**Typical flow:** `36kr/newsflash` → pick `url` → open in browser or `snapshot` for full text.

**Per-command docs:** `bun-browser site info 36kr/newsflash`
