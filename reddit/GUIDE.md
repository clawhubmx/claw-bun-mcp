# Reddit 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里调用 Reddit 公开 JSON API。无需 Reddit API Key、无需手动导出 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开 Reddit（部分命令需要登录，见下方说明）

```bash
bun-browser open https://www.reddit.com/ --tab current
# 需要 reddit/me 或 reddit/posts（无 username）时，在 Chrome 中完成登录
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep reddit   # 应看到 6 个命令
```

> 所有 adapter 在 `www.reddit.com` 域下执行。若当前没有对应标签页，bun-browser 会自动打开 Reddit。**公开帖子和搜索无需登录**；`reddit/me` 以及不带 `username` 的 `reddit/posts` 需要已登录 session。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `reddit/hot` | subreddit 或首页热门帖 | 扫榜、监控社区动态 |
| `reddit/search` | 搜索帖子 | 话题检索、限定 subreddit 搜索 |
| `reddit/thread` | 帖子 + 完整讨论树 | 读评论、抓讨论全文 |
| `reddit/context` | 单条评论的祖先链 | 从深层回复回溯上下文 |
| `reddit/me` | 当前登录用户信息 | 确认账号、karma |
| `reddit/posts` | 用户发帖列表（自动翻页） | 导出某用户历史帖子 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info reddit/search
bun-browser site info reddit/thread
```

## 推荐工作流

### 浏览一个社区（热门 → 讨论）

```bash
# 1. 拉取 r/LocalLLaMA 热门 25 条
bun-browser site reddit/hot LocalLLaMA

# 2. 从返回的 permalink 打开完整讨论
bun-browser site reddit/thread "https://www.reddit.com/r/LocalLLaMA/comments/1rrisqn/..."
```

### 话题研究（搜索 → 线程）

```bash
# 全站搜索，按本周热门排序
bun-browser site reddit/search "claude code" --sort top --time week

# 限定 subreddit
bun-browser site reddit/search "fine tuning" --subreddit LocalLLaMA --sort top --time month

# 深入某帖讨论
bun-browser site reddit/thread "<permalink>"
```

### 从深层评论还原上下文

在 Reddit 网页上复制某条评论的链接（含 `/comment/<id>/`），用 `context` 拉从根帖到该评论的完整路径：

```bash
bun-browser site reddit/context "https://www.reddit.com/r/LocalLLaMA/comments/1rso48p/comment/oa8domi/"
```

### 研究一个用户

```bash
# 当前登录用户（需登录）
bun-browser site reddit/me
bun-browser site reddit/posts

# 任意公开用户（无需登录）
bun-browser site reddit/posts spez
```

---

## reddit/hot — 热门帖子

获取 subreddit 的 `/hot` 列表，或省略 subreddit 时拉 Reddit 首页热门。

```bash
bun-browser site reddit/hot [subreddit] [--count N] [--after FULLNAME]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `subreddit` | ❌ | — | 不带 `r/` 前缀；省略则为首页 |
| `--count` | ❌ | `25` | 条数，上限 **100** |
| `--after` | ❌ | — | 分页 cursor，值为上页最后一条的 `id`（如 `t3_abc123`） |

**示例**

```bash
bun-browser site reddit/hot
bun-browser site reddit/hot ClaudeAI --count 50
bun-browser site reddit/hot programming --after t3_abc123
```

**返回示例**

```json
{
  "subreddit": "ClaudeAI",
  "count": 25,
  "after": "t3_xyz789",
  "posts": [
    {
      "rank": 1,
      "id": "t3_abc123",
      "title": "Example post title",
      "author": "someuser",
      "subreddit": "r/ClaudeAI",
      "score": 142,
      "upvote_ratio": 0.95,
      "num_comments": 38,
      "created_utc": 1710000000,
      "url": "https://example.com/article",
      "permalink": "https://www.reddit.com/r/ClaudeAI/comments/abc123/...",
      "selftext_preview": "Post body preview...",
      "is_self": false,
      "link_flair_text": "Discussion"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `rank` | 当前页内排名（1 起） |
| `id` | Reddit fullname（`t3_` 前缀） |
| `url` | 外链；纯文本帖可能指向 Reddit 自身 |
| `permalink` | Reddit 讨论页链接，供 `reddit/thread` 使用 |
| `is_self` | `true` 为文本帖，`false` 为链接帖 |
| `after` | 有下一页时出现，传给 `--after` 翻页 |

---

## reddit/search — 搜索帖子

```bash
bun-browser site reddit/search "<query>" [--subreddit NAME] [--sort ORDER] [--time FILTER] [--count N] [--after FULLNAME]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词 |
| `--subreddit` | ❌ | — | 限定 subreddit，**不带** `r/` |
| `--sort` | ❌ | `relevance` | `relevance`、`hot`、`top`、`new`、`comments` |
| `--time` | ❌ | `all` | `all`、`hour`、`day`、`week`、`month`、`year`（配合 `top` 等） |
| `--count` | ❌ | `25` | 条数，上限 **100** |
| `--after` | ❌ | — | 分页 cursor |

**示例**

```bash
bun-browser site reddit/search "claude code"
bun-browser site reddit/search "fine tuning" --subreddit LocalLLaMA --sort top --time week
bun-browser site reddit/search "rust async" --sort new --count 50
```

**返回示例**

```json
{
  "query": "claude code",
  "subreddit": null,
  "sort": "relevance",
  "time": "all",
  "count": 25,
  "after": "t3_xyz789",
  "posts": [
    {
      "id": "t3_abc123",
      "title": "...",
      "author": "someuser",
      "subreddit": "r/programming",
      "score": 200,
      "num_comments": 45,
      "created_utc": 1710000000,
      "url": "https://...",
      "permalink": "https://www.reddit.com/r/programming/comments/...",
      "selftext_preview": "...",
      "is_self": true,
      "link_flair_text": null
    }
  ]
}
```

---

## reddit/thread — 帖子与讨论树

拉取单帖元信息及评论树。评论以**扁平列表**返回，用 `parent_id` 和 `depth` 还原层级。

```bash
bun-browser site reddit/thread <url>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | Reddit 帖子 URL（支持带 slug、带 comment 后缀的链接，会自动规范化） |

**示例**

```bash
bun-browser site reddit/thread "https://www.reddit.com/r/LocalLLaMA/comments/1rrisqn/example_title/"
bun-browser site reddit/thread "https://old.reddit.com/r/programming/comments/abc123/slug/"
```

**返回示例**

```json
{
  "post": {
    "id": "t3_abc123",
    "title": "Example title",
    "author": "poster",
    "subreddit": "r/LocalLLaMA",
    "score": 500,
    "num_comments": 120,
    "selftext": "Post body...",
    "url": "https://...",
    "created_utc": 1710000000
  },
  "comments_total": 85,
  "comments": [
    {
      "id": "t1_def456",
      "parent_id": "t3_abc123",
      "author": "commenter",
      "score": 42,
      "body": "Great post!",
      "depth": 0
    },
    {
      "id": "t1_ghi789",
      "parent_id": "t1_def456",
      "author": "replier",
      "score": 10,
      "body": "Agreed.",
      "depth": 1
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `post.selftext` | 文本帖正文；链接帖可能为空 |
| `comments[].parent_id` | 父节点 fullname（`t3_` 为帖，`t1_` 为评论） |
| `comments[].depth` | 嵌套深度，0 为顶层回复 |
| `comments_total` | 实际返回评论数（可能少于 `num_comments`） |

### 评论树的限制（重要）

| 限制 | 值 |
|------|-----|
| API `limit` | **500** 条评论 |
| API `depth` | **10** 层嵌套 |

超长讨论或极深嵌套时，返回数会少于网页显示的总评论数。需要完整讨论请在浏览器打开 `permalink`，或自行扩展 adapter 参数。

---

## reddit/context — 评论祖先链

给定**评论 URL**，返回目标评论及其从根帖到该评论的完整 ancestor chain。适合在 Reddit 深链到某条回复、需要理解上下文的场景。

```bash
bun-browser site reddit/context <comment_url>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | 评论链接；支持新格式 `.../comment/<id>/` 和旧格式 `.../slug/<id>/`；UTM 参数会自动剥离 |

**示例**

```bash
bun-browser site reddit/context "https://www.reddit.com/r/LocalLLaMA/comments/1rso48p/comment/oa8domi/"
```

**返回示例**

```json
{
  "post": {
    "id": "t3_abc123",
    "title": "Original post title",
    "author": "poster",
    "url": "https://www.reddit.com/r/LocalLLaMA/comments/1rso48p/..."
  },
  "target_comment": {
    "id": "t1_oa8domi",
    "parent_id": "t1_parent",
    "author": "deep_replier",
    "score": 15,
    "body": "The actual reply you linked to.",
    "depth": 3
  },
  "ancestor_chain": [
    {"id": "t1_root", "author": "...", "body": "...", "depth": 0},
    {"id": "t1_parent", "author": "...", "body": "...", "depth": 2},
    {"id": "t1_oa8domi", "author": "deep_replier", "body": "...", "depth": 3}
  ]
}
```

| 字段 | 说明 |
|------|------|
| `target_comment` | URL 指向的目标评论 |
| `ancestor_chain` | 从顶层到目标的完整路径（含目标本身） |

> 2025 年起 Reddit 评论 context API 仅支持 `/r/sub/comments/POST_ID/COMMENT_ID/.json` 格式；adapter 已自动从各类 URL 提取 `comment_id` 并构造正确请求。

---

## reddit/me — 当前登录用户

获取当前浏览器 session 对应的 Reddit 账号信息。

```bash
bun-browser site reddit/me
```

**需要登录。** 2025 年起 `/api/me.json` 不再返回用户信息；adapter 从页面 markup 提取 `current-user-id`，再经 `user_data_by_account_ids` 解析 username，最后拉 `/user/USERNAME/about.json`。

**返回示例**

```json
{
  "name": "your_username",
  "id": "abc123",
  "url": "https://www.reddit.com/user/your_username",
  "comment_karma": 1234,
  "link_karma": 567,
  "total_karma": 1801,
  "created_utc": 1600000000
}
```

| 字段 | 说明 |
|------|------|
| `comment_karma` / `link_karma` | 评论 karma / 发帖 karma |
| `total_karma` | 总 karma |
| `created_utc` | 账号创建时间（Unix 秒） |

---

## reddit/posts — 用户发帖列表

拉取指定用户的 `/submitted` 列表，**自动翻页**（每页 100 条，最多 20 页，即最多约 2000 条）。

```bash
bun-browser site reddit/posts [username]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `username` | ❌ | 当前登录用户 | 任意公开用户名 |

**示例**

```bash
bun-browser site reddit/posts              # 当前用户，需登录
bun-browser site reddit/posts spez         # 任意用户，无需登录
bun-browser site reddit/posts MorroHsu
```

**返回示例**

```json
{
  "total": 42,
  "posts": [
    {
      "id": "t3_abc123",
      "title": "My post title",
      "subreddit": "r/programming",
      "score": 88,
      "num_comments": 12,
      "created_utc": 1710000000,
      "permalink": "https://www.reddit.com/r/programming/comments/...",
      "selftext_preview": "First 200 chars of body..."
    }
  ]
}
```

> 翻页间隔 500ms，避免触发 Reddit 限流。用户帖子极多时会停在 20 页上限。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 热门榜：标题 + 分数 + 讨论链接
bun-browser site reddit/hot LocalLLaMA --count 10 --json --jq '.posts[] | {rank, title, score, permalink}'

# 搜索：只要 subreddit 和标题
bun-browser site reddit/search "claude" --sort top --time week --json --jq '.posts[] | {subreddit, title, score, permalink}'

# 讨论树：顶层评论
bun-browser site reddit/thread "<url>" --json --jq '.comments[] | select(.depth==0) | {author, score, body}'

# 评论链：按深度输出
bun-browser site reddit/context "<comment_url>" --json --jq '.ancestor_chain[] | {depth, author, body}'
```

---

## 常见问题

### `Not logged in`（reddit/me）

浏览器未登录 Reddit，或当前 tab 页面 markup 中没有 `current-user-id`。

```bash
bun-browser open https://www.reddit.com/ --tab current
# 在 Chrome 中登录后重试
bun-browser site reddit/me
```

### `Cannot determine username`（reddit/posts 无参数）

未登录且未提供 `username`。显式传入用户名，或先登录：

```bash
bun-browser site reddit/posts some_username
```

### `HTTP 404` — User / Subreddit not found

- 用户名或 subreddit 拼写错误
- 账号已删除或 subreddit 为 private / banned

### `HTTP 429` / `Unexpected response`

Reddit 限流或返回登录页 HTML。降低调用频率（尤其 `reddit/posts` 自动翻页），间隔几秒再试。已登录 session 通常比匿名更稳定。

### `Comment t1_xxx not found`（reddit/context）

- 评论已删除或 URL 中的 comment ID 不正确
- 确认 URL 指向具体评论（含 `/comment/<id>/`），而非仅帖子链接

### 评论比网页少很多

`reddit/thread` 受 API `limit=500`、`depth=10` 约束。热门帖需浏览器打开 `permalink` 查看完整讨论。

### `created_utc` 是什么格式？

Unix 时间戳（**秒**）。转 ISO 8601：`date -r 1710000000`（macOS）或 `date -d @1710000000`（Linux）。

### 需要登录吗？

| 命令 | 登录 |
|------|------|
| `reddit/hot` | ❌ 公开内容即可 |
| `reddit/search` | ❌ |
| `reddit/thread` | ❌ |
| `reddit/context` | ❌ |
| `reddit/me` | ✅ 必须 |
| `reddit/posts` | 无 username 时需登录；指定 username 时 ❌ |

NSFW 或 private subreddit 可能需要已登录且账号有访问权限。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/reddit/`，同名文件会覆盖社区版（例如提高 thread 的 limit/depth、加深 posts 翻页）。

---

## 技术说明

- **无需 Reddit API Key** — adapter 调用 Reddit 公开 JSON API（`*.json` 端点），与网页端相同，复用浏览器 session 的 `credentials: 'include'`。
- **只读** — 所有 6 个命令 `readOnly: true`，不会发帖、投票或回复。
- **2025 API 变更** — `/api/me.json` 已失效；`me` 和 `posts`（默认用户）改从页面 markup / cookie 解析 user ID。`context` 使用 `/comments/POST_ID/COMMENT_ID/.json` 格式。
- **速率** — 批量调用时建议串行；`reddit/posts` 翻页自带 500ms 间隔。
- **域名** — `www.reddit.com`；`old.reddit.com` URL 传入后会被规范化处理。

---

## English summary

Six read-only CLI commands for Reddit via bun-browser (no API key; uses browser session cookies):

| Command | Purpose |
|---------|---------|
| `reddit/hot [subreddit]` | Hot posts (subreddit or front page; paginate with `--after`) |
| `reddit/search "<query>"` | Search posts (`--subreddit`, `--sort`, `--time`, max 100) |
| `reddit/thread <url>` | Post + flattened comment tree (limit 500, depth 10) |
| `reddit/context <comment_url>` | Target comment + ancestor chain to root |
| `reddit/me` | Logged-in user profile and karma |
| `reddit/posts [username]` | User submissions with auto-pagination (max ~2000) |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`. Open `https://www.reddit.com/`; login required for `reddit/me` and `reddit/posts` without username.

**Typical flow:** `reddit/hot` or `reddit/search` → `reddit/thread`; deep links → `reddit/context`.

**Limits:** `thread` may return fewer comments than the web UI on very large discussions.

**Per-command docs:** `bun-browser site info reddit/<command>`
