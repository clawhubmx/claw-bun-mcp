# Hacker News 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 Hacker News 热门帖与评论树。无需登录、无需 API Key。

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
bun-browser site list | grep hackernews   # 应看到 2 个命令
```

> adapter 在 `news.ycombinator.com` 域下执行。若当前没有对应标签页，bun-browser 会自动打开 `https://news.ycombinator.com/`。**不需要登录 HN。**

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `hackernews/top` | 首页热门帖子列表 | 每日扫榜、选题、监控技术热点 |
| `hackernews/thread` | 单帖详情 + 评论树 | 读讨论、抓观点、跟进某条 story |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info hackernews/top
bun-browser site info hackernews/thread
```

## 推荐工作流

### 从热门榜到深度阅读

```bash
# 1. 拉取前 10 条热门
bun-browser site hackernews/top 10

# 2. 从返回的 id 或 hn_url 打开讨论
bun-browser site hackernews/thread 42123456

# 也可用完整链接（自动解析 id=）
bun-browser site hackernews/thread "https://news.ycombinator.com/item?id=42123456"
```

### 快速浏览标题与外链

```bash
bun-browser site hackernews/top 30 --json --jq '.posts[] | {rank, title, score, comments, url}'
```

### 只看帖子元信息（不拉评论）

`thread` 会同时请求 Firebase API 拉评论；若你只需要标题、分数、正文，可用 `top` 里的 `hn_url` 在浏览器打开，或对已知 ID 看返回里的 `post` 字段（评论请求仍会执行，见下方限制说明）。

---

## hackernews/top — 热门帖子

解析 [HN 首页](https://news.ycombinator.com/) HTML，返回当前 front page 条目（与网页排序一致）。

```bash
bun-browser site hackernews/top [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `20` | 返回条数，上限 **50** |

**示例**

```bash
bun-browser site hackernews/top
bun-browser site hackernews/top 10
bun-browser site hackernews/top 50
```

**返回示例**

```json
{
  "count": 10,
  "posts": [
    {
      "rank": 1,
      "id": 42123456,
      "title": "Show HN: Example project",
      "url": "https://example.com/article",
      "hn_url": "https://news.ycombinator.com/item?id=42123456",
      "author": "username",
      "score": 142,
      "comments": 38
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `rank` | 当前首页排名（1 起） |
| `id` | HN item ID，供 `hackernews/thread` 使用 |
| `title` | 标题 |
| `url` | 外链（Ask HN / Show HN 等可能指向 HN 自身） |
| `hn_url` | HN 讨论页链接 |
| `author` | 发帖用户（`by`） |
| `score` | 得分（points） |
| `comments` | 评论数；无评论时可能为 `0` 或页面显示 `discuss` |

**实现说明：** 直接抓取首页 HTML 并解析 DOM（`tr.athing`），避免跨域调用 Firebase API，与网页展示一致。

---

## hackernews/thread — 帖子与评论树

通过 [HN Firebase API](https://github.com/HackerNews/API) 获取单条 item，并递归拉取评论（有深度与数量限制）。

```bash
bun-browser site hackernews/thread <id_or_url>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 数字 item ID，或含 `id=123` 的 HN URL |

**示例**

```bash
bun-browser site hackernews/thread 42123456
bun-browser site hackernews/thread "https://news.ycombinator.com/item?id=42123456"
```

**返回示例**

```json
{
  "post": {
    "id": 42123456,
    "title": "Show HN: Example",
    "url": "https://example.com",
    "hn_url": "https://news.ycombinator.com/item?id=42123456",
    "author": "username",
    "score": 142,
    "comments_count": 38,
    "time": 1710000000,
    "text": null
  },
  "comments": [
    {
      "id": 42123457,
      "author": "commenter",
      "text": "Great work!",
      "time": 1710000100,
      "depth": 0,
      "replies": [
        {
          "id": 42123458,
          "author": "reply_user",
          "text": "Thanks!",
          "time": 1710000200,
          "depth": 1,
          "replies": []
        }
      ]
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `post.title` / `post.url` | 故事标题与外链；纯文本帖 `url` 可能为 `null` |
| `post.text` | Ask HN / 自建帖的正文（HTML 片段）；普通链接帖常为 `null` |
| `post.time` | Unix 时间戳（秒） |
| `post.comments_count` | `descendants` 总评论数（含深层） |
| `comments[].depth` | 嵌套深度，0 为顶层 |
| `comments[].replies` | 子评论数组 |
| `comments[].text` | 评论 HTML（HN 格式，含 `<p>` 等） |

### 评论树的限制（重要）

为保证性能和 API 负载，`thread` adapter 有意做了裁剪：

| 限制 | 值 |
|------|-----|
| 最大嵌套深度 | **2** 层（depth 0 → 1 → 2，更深不再展开） |
| 每层最多拉取子评论数 | **30** 条（`kids` 切片） |
| 已删除/死亡评论 | 跳过（`deleted` / `dead`） |

因此 `comments` 数组**不等于**页面上全部讨论。热门帖深层回复需人工在浏览器打开 `hn_url`，或自行调用 Firebase API 补全。

该命令声明了 `capabilities: ["network"]`，会对外发起 `hacker-news.firebaseio.com` 请求。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 热门榜：标题 + 分数 + 讨论链接
bun-browser site hackernews/top 15 --json --jq '.posts[] | {rank, title, score, hn_url}'

# 只要外链 URL（过滤纯讨论帖）
bun-browser site hackernews/top 20 --json --jq '.posts[] | select(.url | startswith("http")) | .url'

# 帖子元信息
bun-browser site hackernews/thread 42123456 --json --jq '.post | {title, score, comments_count, hn_url}'

# 顶层评论作者与正文（HTML 需自行处理）
bun-browser site hackernews/thread 42123456 --json --jq '.comments[] | {author, text, reply_count: (.replies | length)}'
```

---

## 常见问题

### `HTTP 4xx` / 首页拉取失败

检查网络与 `news.ycombinator.com` 是否可访问：

```bash
bun-browser open https://news.ycombinator.com/ --tab current
bun-browser site hackernews/top 5
```

### `Item not found`

- 确认 ID 为有效数字（可从 `top` 的 `id` 或讨论页 URL 的 `?id=` 获取）
- 极旧或已移除的 item 在 API 中可能返回 `null`

### 评论比网页少很多

这是预期行为：adapter 只拉 **2 层**、每层最多 **30** 条子评论。需要完整树请打开 `post.hn_url` 或扩展 adapter。

### `top` 与 `thread` 的 score 不一致

`top` 解析的是**首页实时 HTML**；`thread` 的 `post.score` 来自 **Firebase API**，可能有短暂延迟。一般以你使用的命令来源为准即可。

### 需要登录吗？

不需要。Hacker News 公开内容均可匿名读取。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/hackernews/`，同名文件会覆盖社区版（例如加深评论层级）。

---

## 技术说明

- **只读** — `hackernews/top` 与 `hackernews/thread` 均为 `readOnly: true`，不会发帖、投票或回复。
- **数据源** — `top`：首页 HTML；`thread`：官方 Firebase JSON API（与 HN 移动/第三方客户端相同数据源）。
- **速率** — 批量 `thread` 时建议串行，避免对 `firebaseio.com` 并发过高。
- **与 Agent 协作** — 用 `site info hackernews/<command>` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。

---

## English summary

Two read-only CLI commands for Hacker News via bun-browser (no login, no API key):

| Command | Purpose |
|---------|---------|
| `hackernews/top [count]` | Front-page hot stories (default 20, max 50) |
| `hackernews/thread <id_or_url>` | Post metadata + comment tree (2 levels deep, 30 replies per level) |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`. A tab on `news.ycombinator.com` is opened automatically if needed.

**Typical flow:** `hackernews/top 10` → pick `id` → `hackernews/thread <id>`.

**Limits:** `thread` does not fetch the full comment tree; deep threads need the browser or a custom adapter.

**Per-command docs:** `bun-browser site info hackernews/<command>`
