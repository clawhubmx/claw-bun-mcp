# Twitter / X 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里调用 X（Twitter）内部 GraphQL API。无需 Twitter API Key、无需手动导出 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. **必须登录 X** — 所有 adapter 依赖浏览器 session 中的 `ct0` CSRF cookie

```bash
bun-browser open https://x.com/ --tab current
# 在 Chrome 中完成登录，确认首页能正常加载
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep twitter   # 应看到 8 个命令
```

> 所有 adapter 在 `x.com` 域下执行。若报错 `No ct0 cookie`，说明当前浏览器未登录 X，或 tab 不在 `x.com`。`twitter/search`  additionally 需要页面 webpack 已加载（用于生成 `X-Client-Transaction-Id`），建议在 `x.com` 首页或任意已加载页面执行。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `twitter/user` | 用户 profile | 查粉丝数、简介、认证状态 |
| `twitter/tweets` | 用户最近推文 | 监控 KOL、抓取时间线 |
| `twitter/search` | 搜索推文 | 话题监控、舆情检索 |
| `twitter/thread` | 推文对话线程 | 读回复链、抓讨论全文 |
| `twitter/following` | 首页 Following 时间线 | 只看关注的人的推文 |
| `twitter/for_you` | 首页 For You 时间线 | 浏览算法推荐 |
| `twitter/notifications` | 通知 | 点赞、转发、回复、提及 |
| `twitter/bookmarks` | 书签列表 | 导出已保存推文 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info twitter/search
bun-browser site info twitter/notifications
```

## 推荐工作流

### 研究一个账号（profile → 时间线 → 单条讨论）

```bash
# 1. 用户资料
bun-browser site twitter/user plantegg

# 2. 最近 20 条推文
bun-browser site twitter/tweets plantegg --count 20

# 3. 深入某条推文的回复线程（用返回的 id 或 url）
bun-browser site twitter/thread 2032478407146311850
bun-browser site twitter/thread "https://x.com/plantegg/status/2032478407146311850"
```

### 话题监控（搜索 → 线程）

```bash
# 最新推文（默认 Latest）
bun-browser site twitter/search "claude code" --count 30

# 热门推文
bun-browser site twitter/search "AI agent" --type top --count 20

# 对感兴趣的推文拉取完整讨论
bun-browser site twitter/thread <tweet_id>
```

### 每日信息流

```bash
bun-browser open https://x.com/home --tab current

# 关注时间线（不含广告）
bun-browser site twitter/following --count 30

# 或 For You 推荐
bun-browser site twitter/for_you --count 30

# 通知摘要
bun-browser site twitter/notifications --type mentions --count 20
bun-browser site twitter/bookmarks --count 10
```

### 翻页读更多推文

`tweets` 和 `notifications` 支持 cursor 分页：

```bash
# 第一页
bun-browser site twitter/tweets plantegg --count 50

# 用返回的 next_cursor 继续
bun-browser site twitter/tweets plantegg --count 50 --cursor "<next_cursor>"
```

---

## twitter/user — 用户 profile

```bash
bun-browser site twitter/user <screen_name>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `screen_name` | ✅ | Twitter handle，**不带** `@` |

**示例**

```bash
bun-browser site twitter/user plantegg
bun-browser site twitter/user elonmusk
```

**返回示例**

```json
{
  "id": "1234567890",
  "name": "Display Name",
  "screen_name": "plantegg",
  "bio": "Bio text...",
  "url": "https://x.com/plantegg",
  "followers": 12345,
  "following": 678,
  "tweets": 9012,
  "verified": true
}
```

| 字段 | 说明 |
|------|------|
| `id` | 用户 numeric ID |
| `name` | 显示名 |
| `screen_name` | @handle |
| `bio` | 个人简介 |
| `url` | 个人主页链接 |
| `followers` / `following` / `tweets` | 粉丝、关注、推文数 |
| `verified` | 是否蓝 V 认证 |

---

## twitter/tweets — 用户时间线

获取指定用户最近的推文（含原创、回复；转推会标注 `type: retweet`）。

```bash
bun-browser site twitter/tweets <screen_name> [--count N] [--cursor CURSOR]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `screen_name` | ✅ | — | handle，不带 `@` |
| `--count` | ❌ | `20` | 条数，上限 **100** |
| `--cursor` | ❌ | — | 上一页返回的 `next_cursor` |

**返回示例**

```json
{
  "screen_name": "plantegg",
  "user_id": "1234567890",
  "count": 20,
  "next_cursor": "DAABCgAB...",
  "tweets": [
    {
      "id": "2032478407146311850",
      "type": "tweet",
      "author": "plantegg",
      "url": "https://x.com/plantegg/status/2032478407146311850",
      "text": "Tweet content...",
      "likes": 42,
      "retweets": 5,
      "replies": 3,
      "created_at": "Fri May 22 10:00:00 +0000 2026"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `type` | `tweet`、`retweet` |
| `rt_author` | 转推时，原推作者 handle |
| `in_reply_to` | 回复的推文 ID（如有） |
| `next_cursor` | 有下一页时出现，用于 `--cursor` |

---

## twitter/search — 搜索推文

```bash
bun-browser site twitter/search "<query>" [--count N] [--type latest|top]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词（支持 X 搜索语法） |
| `--count` | ❌ | `20` | 条数，上限 **50** |
| `--type` | ❌ | `latest` | `latest` 最新，或 `top` 热门 |

**示例**

```bash
bun-browser site twitter/search "claude code"
bun-browser site twitter/search "from:plantegg bun" --count 30
bun-browser site twitter/search "#AI" --type top --count 15
```

**返回示例**

```json
{
  "query": "claude code",
  "product": "Latest",
  "count": 20,
  "tweets": [
    {
      "id": "1234567890123456789",
      "author": "someuser",
      "name": "Some User",
      "url": "https://x.com/someuser/status/1234567890123456789",
      "text": "...",
      "likes": 10,
      "retweets": 2,
      "created_at": "..."
    }
  ]
}
```

> **注意：** 此命令依赖页面 webpack 模块生成 `X-Client-Transaction-Id`。若报错 `Cannot find transaction-id generator`，先打开 `https://x.com/` 并等待页面完全加载后再试。

---

## twitter/thread — 推文对话线程

拉取 focal tweet 及其回复，最多翻 **5 页** cursor。

```bash
bun-browser site twitter/thread <tweet_id_or_url>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `tweet_id` | ✅ | 数字推文 ID，或含 `/status/<id>` 的完整 URL |

**示例**

```bash
bun-browser site twitter/thread 2032478407146311850
bun-browser site twitter/thread "https://x.com/plantegg/status/2032478407146311850"
```

**返回示例**

```json
{
  "tweet_id": "2032478407146311850",
  "count": 15,
  "tweets": [
    {
      "id": "2032478407146311850",
      "author": "plantegg",
      "text": "Original tweet...",
      "url": "https://x.com/plantegg/status/2032478407146311850",
      "likes": 100,
      "retweets": 20,
      "in_reply_to": null,
      "created_at": "..."
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `in_reply_to` | 若为回复，指向父推文 ID |
| `count` | 实际返回条数（含原文与回复） |

> 热门帖回复可能超过 5 页限制，返回的 `count` 会少于网页显示的总回复数。需要完整讨论请在浏览器打开 `url`。

---

## twitter/following — Following 时间线

首页「Following」tab：关注的人的最新推文，**已过滤广告**。

```bash
bun-browser site twitter/following [--count N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--count` | ❌ | `20` | 条数，上限 **50** |

**返回字段（每条 tweet）**

| 字段 | 说明 |
|------|------|
| `type` | `tweet`、`retweet`、`reply` |
| `author` / `name` | 作者 handle / 显示名 |
| `rt_author` | 转推时的原作者 |
| `source` | 社交上下文（如「某某 liked」），可能为空 |
| `url` | 推文链接 |

---

## twitter/for_you — For You 时间线

首页「For You」tab：算法推荐时间线，**已过滤广告**。参数与返回格式同 `twitter/following`。

```bash
bun-browser site twitter/for_you [--count N]
```

---

## twitter/notifications — 通知

读取当前登录账号的通知。`--type all` 会并行拉取 engagement（点赞/转发/关注）和 mentions 两路数据。

```bash
bun-browser site twitter/notifications [--type all|mentions|likes|retweets] [--count N] [--cursor CURSOR]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--type` | ❌ | `all` | `all`、`mentions`、`likes`、`retweets` |
| `--count` | ❌ | `20` | 条数，上限 **50** |
| `--cursor` | ❌ | — | 分页 cursor |

**示例**

```bash
bun-browser site twitter/notifications
bun-browser site twitter/notifications --type mentions --count 30
bun-browser site twitter/notifications --type likes
```

**`--type mentions` 返回示例**

```json
{
  "type": "mentions",
  "count": 10,
  "next_cursor": "...",
  "notifications": [
    {
      "type": "reply",
      "id": "1234567890",
      "author": "someuser",
      "text": "@you thanks!",
      "url": "https://x.com/someuser/status/1234567890",
      "in_reply_to": "9876543210",
      "created_at": "..."
    }
  ]
}
```

**`--type all` 返回结构**

```json
{
  "type": "all",
  "engagement": {
    "count": 15,
    "notifications": [
      {"type": "like", "users": ["user1", "user2"], "message": "...", "url": "...", "id": "..."}
    ]
  },
  "mentions": {
    "count": 5,
    "notifications": [...]
  },
  "total": 20,
  "engagement_cursor": "...",
  "mentions_cursor": "..."
}
```

| engagement `type` | 含义 |
|-------------------|------|
| `like` | 点赞 |
| `retweet` | 转发 |
| `follow` | 新关注 |
| `reply` | 回复（engagement 流中） |
| `mention` | 提及 |

> `--type all` 时分页 cursor 分为 `engagement_cursor` 和 `mentions_cursor`，需分别传入 `--cursor` 翻页（同一 `--type` 下使用）。

---

## twitter/bookmarks — 书签

读取当前登录账号的书签推文。

```bash
bun-browser site twitter/bookmarks [--count N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `--count` | ❌ | `20` | 条数，上限 **100** |

**返回示例**

```json
{
  "count": 10,
  "tweets": [
    {
      "id": "1234567890",
      "author": "someuser",
      "name": "Some User",
      "url": "https://x.com/someuser/status/1234567890",
      "text": "...",
      "likes": 50,
      "retweets": 10,
      "created_at": "..."
    }
  ]
}
```

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 搜索：只要作者、正文、链接
bun-browser site twitter/search "rust lang" --count 10 --json --jq '.tweets[] | {author, text, url}'

# 用户时间线：最近 5 条纯文本
bun-browser site twitter/tweets plantegg --json --jq '.tweets[:5] | .[].text'

# Following 流：转推来源
bun-browser site twitter/following --json --jq '.tweets[] | select(.type=="retweet") | {author, rt_author, url}'

# 通知：只看 mentions 正文
bun-browser site twitter/notifications --type mentions --json --jq '.notifications[] | {author, text, url}'
```

---

## 常见问题

### `No ct0 cookie`

浏览器未登录 X，或当前 tab 不在 `x.com`。

```bash
bun-browser open https://x.com/ --tab current
# 在 Chrome 中登录后重试
```

### `Cannot find transaction-id generator`（search）

X 页面 webpack 尚未加载。打开首页并等待 2–3 秒：

```bash
bun-browser open https://x.com/home --tab current
bun-browser site twitter/search "your query"
```

### `HTTP 403` / `HTTP 401`

- Session 过期 → 重新登录 X
- 账号被限流 → 降低调用频率，间隔几秒再试
- GraphQL queryId 过期 → adapter 需更新（见下方「queryId 变更」）

### `User not found`

- 确认 handle **不带** `@`：`plantegg` 而非 `@plantegg`
- 账号可能已改名、封禁或拼写错误

### `queryId may have changed`

X 经常轮换 GraphQL endpoint 的 query hash。若多个命令同时报 HTTP 4xx，需在 `x.com` 打开 DevTools → Network，找到对应 API 请求的新 queryId，更新 adapter 源码。

### 长推文（Note Tweet）显示不全？

adapter 优先读取 `note_tweet` 全文；若 X 响应结构变化，可能回退到截断的 `full_text`。可打开 `url` 在浏览器查看完整内容。

### 线程回复比网页少

`twitter/thread` 最多翻 **5 页** cursor。超长讨论需浏览器打开，或自行扩展 adapter 的 `maxPages`。

### 需要登录吗？

**是的。** 所有 8 个命令都需要已登录的 X session。公开 profile 理论上可匿名访问，但当前 adapter 统一要求 `ct0` cookie。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/twitter/`，同名文件会覆盖社区版（例如加深 thread 翻页、更新 queryId）。

---

## 技术说明

- **无需 Twitter API Key** — adapter 复用浏览器 session 内的 GraphQL API（`/i/api/graphql/*`），与网页端相同。
- **只读** — 所有命令 `readOnly: true`，不会发推、点赞、关注或改书签。
- **长推文** — 支持 Note Tweet / Articles 的 `note_tweet` 全文提取。
- **广告过滤** — `following` 和 `for_you` 跳过 `promotedMetadata` 条目。
- **速率** — 批量调用时建议串行执行，避免触发 X 限流。
- **域名** — 使用 `x.com`（`twitter.com` 会重定向，但 adapter 声明 domain 为 `x.com`）。

---

## English summary

Eight read-only CLI commands for Twitter/X via bun-browser (logged-in Chrome, no API key):

| Command | Purpose |
|---------|---------|
| `twitter/user <handle>` | User profile (followers, bio, verified) |
| `twitter/tweets <handle>` | User timeline (paginate with `--cursor`) |
| `twitter/search "<query>"` | Search tweets (`--type latest\|top`, max 50) |
| `twitter/thread <id_or_url>` | Conversation thread (up to 5 pages) |
| `twitter/following` | Home Following feed (ads filtered) |
| `twitter/for_you` | Home For You feed (ads filtered) |
| `twitter/notifications` | Likes, retweets, follows, mentions |
| `twitter/bookmarks` | Saved bookmarks |

**Prerequisites:** `bun-browser start`, log in at `https://x.com/`, run `bun-browser site update`.

**Typical flow:** `twitter/user` → `twitter/tweets` → `twitter/thread`; or `twitter/search` → `twitter/thread`.

**Login required** for all commands (`ct0` cookie). **`twitter/search`** additionally needs a fully loaded x.com page for transaction-id generation.

**Per-command docs:** `bun-browser site info twitter/<command>`
