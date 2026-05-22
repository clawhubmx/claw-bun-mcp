# Linux.do 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 [Linux.do](https://linux.do) 热门主题、最新帖与讨论内容。无需单独申请 API Key，复用浏览器 session 的 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开 Linux.do（建议登录，部分板块或接口可能要求已登录 session）

```bash
bun-browser open https://linux.do/ --tab current
# 若返回 HTTP 403，在 Chrome 中完成登录后重试
```

3. 安装/更新 site adapter（本仓库或上游 `bb-sites`）

```bash
bun-browser site update
bun-browser site list | grep linuxdo   # 应看到 3 个命令
```

> 所有 adapter 在 `linux.do` 域下执行。若当前没有对应标签页，bun-browser 会自动打开 Linux.do。请求使用 `credentials: 'include'`，与你在浏览器中的登录状态一致。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `linuxdo/hot` | 按周期拉取热门主题 | 每日扫榜、监控社区热点 |
| `linuxdo/latest` | 最新发布主题 | 跟进新帖、实时动态 |
| `linuxdo/topic` | 单帖详情 + 楼层回复 | 读讨论、抓正文与回复 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info linuxdo/hot
bun-browser site info linuxdo/latest
bun-browser site info linuxdo/topic
```

## 推荐工作流

### 从热门榜到深度阅读

```bash
# 1. 拉取今日热门 20 条
bun-browser site linuxdo/hot 20 --period daily

# 2. 从返回的 id 打开讨论（首帖 + 回复）
bun-browser site linuxdo/topic 1812710 --posts 30
```

### 跟进最新动态

```bash
# 最新 30 条主题
bun-browser site linuxdo/latest

# 只看标题、回复数、链接
bun-browser site linuxdo/latest 15 --json --jq '.topics[] | {rank, title, reply_count, url}'
```

### 按时间范围看热榜

```bash
bun-browser site linuxdo/hot 30 --period weekly
bun-browser site linuxdo/hot 20 --period monthly
bun-browser site linuxdo/hot 10 --period all
```

---

## linuxdo/hot — 热门主题

调用 Discourse 的 `/top.json` 接口，按周期返回热门主题列表。若 `top.json` 不可用，会自动回退到 `latest.json`。

```bash
bun-browser site linuxdo/hot [count] [--period PERIOD]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `30` | 返回条数，上限 **50** |
| `--period` | ❌ | `daily` | 统计周期：`daily`、`weekly`、`monthly`、`quarterly`、`yearly`、`all` |

**示例**

```bash
bun-browser site linuxdo/hot
bun-browser site linuxdo/hot 20 --period daily
bun-browser site linuxdo/hot 30 --period weekly
bun-browser site linuxdo/hot 10 --period all
```

**返回示例**

```json
{
  "count": 20,
  "period": "daily",
  "source": "https://linux.do/top.json?period=daily",
  "topics": [
    {
      "rank": 1,
      "id": 1812710,
      "title": "示例主题标题",
      "slug": "example-topic-slug",
      "url": "https://linux.do/t/example-topic-slug/1812710",
      "posts_count": 42,
      "reply_count": 41,
      "views": 5200,
      "like_count": 88,
      "created_at": "2026-05-20T08:00:00.000Z",
      "bumped_at": "2026-05-22T12:00:00.000Z",
      "last_posted_at": "2026-05-22T11:30:00.000Z",
      "pinned": false,
      "pinned_globally": false,
      "visible": true,
      "excerpt": "主题摘要预览…",
      "category_id": 4,
      "tags": ["tag-a", "tag-b"]
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `rank` | 当前列表内排名（1 起） |
| `id` | 主题 ID，供 `linuxdo/topic` 使用 |
| `slug` / `url` | Discourse slug 与完整链接 |
| `posts_count` | 总帖数（含首帖） |
| `reply_count` | 回复数（`posts_count - 1`） |
| `views` / `like_count` | 浏览量、点赞数 |
| `excerpt` | 主题摘要 |
| `category_id` / `tags` | 板块 ID 与标签 |
| `source` | 实际使用的 JSON 端点（含回退情况） |

---

## linuxdo/latest — 最新主题

拉取 `/latest.json`，按最近活动时间排序。

```bash
bun-browser site linuxdo/latest [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `30` | 返回条数，上限 **50** |

**示例**

```bash
bun-browser site linuxdo/latest
bun-browser site linuxdo/latest 20
bun-browser site linuxdo/latest 50
```

**返回示例**

```json
{
  "count": 20,
  "source": "https://linux.do/latest.json",
  "topics": [
    {
      "rank": 1,
      "id": 1812800,
      "title": "刚发布的新帖",
      "slug": "new-post-slug",
      "url": "https://linux.do/t/new-post-slug/1812800",
      "posts_count": 3,
      "reply_count": 2,
      "views": 120,
      "like_count": 5,
      "created_at": "2026-05-22T10:00:00.000Z",
      "bumped_at": "2026-05-22T10:15:00.000Z",
      "last_posted_at": "2026-05-22T10:15:00.000Z",
      "pinned": false,
      "pinned_globally": false,
      "visible": true,
      "excerpt": "",
      "category_id": 7,
      "tags": []
    }
  ]
}
```

> `latest` 与 `hot` 的 `topics[]` 字段结构相同，便于在 Agent 或脚本里统一处理。

---

## linuxdo/topic — 主题详情与回复

拉取单个主题的元信息与帖子流（首帖 + 回复）。会依次尝试 `/t/{id}.json` 与 `/t/topic/{id}.json`。

```bash
bun-browser site linuxdo/topic <id> [--posts N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `id` | ✅ | — | 主题 ID（数字，可从 `hot` / `latest` 的 `id` 获取） |
| `--posts` | ❌ | `20` | 返回帖子数，上限 **100** |

**示例**

```bash
bun-browser site linuxdo/topic 1812710
bun-browser site linuxdo/topic 1812710 --posts 10
bun-browser site linuxdo/topic 1812710 --posts 100
```

**返回示例**

```json
{
  "source": "https://linux.do/t/1812710.json",
  "topic": {
    "id": 1812710,
    "title": "示例主题标题",
    "slug": "example-topic-slug",
    "fancy_title": "示例主题标题",
    "url": "https://linux.do/t/example-topic-slug/1812710",
    "posts_count": 42,
    "reply_count": 41,
    "views": 5200,
    "like_count": 88,
    "created_at": "2026-05-20T08:00:00.000Z",
    "last_posted_at": "2026-05-22T11:30:00.000Z",
    "bumped_at": "2026-05-22T12:00:00.000Z",
    "archetype": "regular",
    "pinned": false,
    "pinned_globally": false,
    "visible": true,
    "category_id": 4,
    "tags": ["tag-a"]
  },
  "post_count": 10,
  "posts": [
    {
      "id": 12345678,
      "post_number": 1,
      "username": "author",
      "name": "作者昵称",
      "created_at": "2026-05-20T08:00:00.000Z",
      "updated_at": "2026-05-20T08:00:00.000Z",
      "reply_count": 0,
      "reads": 500,
      "score": 42.5,
      "can_edit": false,
      "can_delete": false,
      "url": "https://linux.do/t/example-topic-slug/1812710/1",
      "cooked": "<p>首帖 HTML 正文</p>",
      "text": "首帖 HTML 正文"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `topic` | 主题元信息（标题、统计、板块、标签） |
| `posts[].post_number` | 楼层号，1 为首帖 |
| `posts[].cooked` | Discourse 渲染后的 HTML 正文 |
| `posts[].text` | 从 `cooked` 提取的纯文本，便于 Agent 摘要 |
| `posts[].url` | 单楼 Permalink |
| `post_count` | 本次实际返回的帖子数（受 `--posts` 限制） |

### 帖子数量的限制（重要）

| 限制 | 值 |
|------|-----|
| 单次 `--posts` 上限 | **100** |
| 超长讨论 | 返回数可能少于 `topic.posts_count`；需要完整讨论请在浏览器打开 `topic.url` |

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 今日热门：标题 + 回复数 + 链接
bun-browser site linuxdo/hot 15 --period daily --json --jq '.topics[] | {rank, title, reply_count, views, url}'

# 最新帖：只要标题和 id
bun-browser site linuxdo/latest 20 --json --jq '.topics[] | {id, title, url}'

# 主题首帖纯文本
bun-browser site linuxdo/topic 1812710 --json --jq '.posts[] | select(.post_number==1) | {username, text}'

# 所有回复作者与摘要
bun-browser site linuxdo/topic 1812710 --posts 50 --json --jq '.posts[] | select(.post_number>1) | {post_number, username, text}'
```

---

## 常见问题

### `HTTP 403` — 无法访问 JSON 接口

浏览器未打开 Linux.do，或未登录导致 Discourse 拒绝 JSON 请求。

```bash
bun-browser open https://linux.do/ --tab current
# 在 Chrome 中登录后重试
bun-browser site linuxdo/hot 10
```

### `HTTP 404` — 主题不存在

- 确认 `id` 为有效数字（从 `hot` / `latest` 返回的 `id` 复制）
- 主题可能已删除或对你不可见（私密板块、权限不足）

### `missing required argument "id"`（linuxdo/topic）

未传入主题 ID：

```bash
bun-browser site linuxdo/topic 1812710
```

### 热榜与最新列表内容重叠

`hot` 在 `top.json` 失败时会回退到 `latest.json`，此时 `source` 字段会显示实际端点。若需严格按周期热榜，请检查登录状态并重试 `--period`。

### 回复比网页少

`linuxdo/topic` 单次最多返回 **100** 楼。超长帖请打开 `topic.url` 在浏览器阅读，或增大 `--posts` 至上限后仍不足时自行翻页（当前 adapter 未实现分页）。

### 需要登录吗？

| 命令 | 登录 |
|------|------|
| `linuxdo/hot` | 建议登录；匿名可能遇 403 |
| `linuxdo/latest` | 建议登录 |
| `linuxdo/topic` | 建议登录；私密主题需有访问权限 |

公开可见的主题在已登录 session 下通常可正常读取。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/linuxdo/`，同名文件会覆盖社区版（例如提高 `--posts` 上限、增加分页逻辑）。

---

## 技术说明

- **Discourse JSON API** — Linux.do 基于 Discourse，adapter 调用与网页相同的 `.json` 端点（`/top.json`、`/latest.json`、`/t/{id}.json`），通过 `credentials: 'include'` 携带 Cookie。
- **只读** — 三个命令均为 `readOnly: true`，不会发帖、回复或点赞。
- **capabilities** — 均声明 `network`，在 `linux.do` 标签页上下文中发起 `fetch`。
- **与 Agent 协作** — 用 `bun-browser site info linuxdo/<command>` 查看 `@meta` 中的 `args`、`example`、`domain`，便于 MCP / CLI 自动填参。

---

## English summary

Three read-only CLI commands for [Linux.do](https://linux.do) (Discourse forum) via bun-browser — no separate API key; uses browser session cookies:

| Command | Purpose |
|---------|---------|
| `linuxdo/hot [count] [--period daily\|weekly\|monthly\|quarterly\|yearly\|all]` | Hot topics by period (default 30, max 50; falls back to latest if top fails) |
| `linuxdo/latest [count]` | Latest topics (default 30, max 50) |
| `linuxdo/topic <id> [--posts N]` | Topic metadata + posts (default 20 posts, max 100) |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`. Open `https://linux.do/` and log in if you see HTTP 403.

**Typical flow:** `linuxdo/hot` or `linuxdo/latest` → pick `id` → `linuxdo/topic <id>`.

**Limits:** `topic` returns at most 100 posts per call; very long threads need the browser or a custom adapter with pagination.

**Per-command docs:** `bun-browser site info linuxdo/<command>`
