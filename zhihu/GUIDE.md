# 知乎使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里调用知乎官方 API，无需 API Key、无需抓 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开知乎并登录（所有 adapter 依赖 session Cookie）

```bash
bun-browser open https://www.zhihu.com/ --tab current
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep zhihu   # 应看到 4 个命令
```

> 所有 adapter 在 `www.zhihu.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器登录态。若返回 `HTTP 401/403` 或 hint 提示未登录，请先在 Chrome 中登录知乎后重试。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `zhihu/me` | 当前登录用户信息 | 确认账号、查通知数、个人统计 |
| `zhihu/hot` | 知乎热榜 | 每日扫热点、选题、监控舆论 |
| `zhihu/search` | 搜索问题/回答/文章 | 按关键词检索内容 |
| `zhihu/question` | 问题详情 + 热门回答 | 读 Q&A、抓高赞观点 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info zhihu/me
bun-browser site info zhihu/hot
bun-browser site info zhihu/search
bun-browser site info zhihu/question
```

## 推荐工作流

### 从热榜到深度阅读

```bash
# 1. 拉取热榜前 10 条
bun-browser site zhihu/hot 10

# 2. 从返回的 id 或 url 读取问题与回答
bun-browser site zhihu/question 34816524
bun-browser site zhihu/question 34816524 10   # 拉 10 条回答
```

### 按主题搜索再展开

```bash
# 1. 搜索
bun-browser site zhihu/search "大语言模型" 15

# 2. 对问题类型结果，用 question_id 或 id 继续
bun-browser site zhihu/question 632345678 5

# 3. 对回答类型结果，直接用返回的 url 在浏览器打开
```

### 确认登录态与通知

```bash
bun-browser site zhihu/me
bun-browser site zhihu/me --json --jq '{name, url, answer_count, notifications}'
```

---

## zhihu/me — 当前用户信息

调用 `GET /api/v4/me`，返回已登录账号的资料与统计。

```bash
bun-browser site zhihu/me
```

无参数。

**返回字段**

| 字段 | 说明 |
|------|------|
| `id` / `uid` | 用户内部 ID |
| `name` | 昵称 |
| `url` | 个人主页链接 |
| `url_token` | 个人页 URL token |
| `headline` | 一句话简介 |
| `gender` | `male` / `female` / `unknown` |
| `ip_info` | IP 属地（如有） |
| `avatar_url` | 头像 URL |
| `is_vip` | 是否盐选会员 |
| `answer_count` | 回答数 |
| `question_count` | 提问数 |
| `articles_count` | 文章数 |
| `columns_count` | 专栏数 |
| `favorite_count` | 收藏数 |
| `voteup_count` | 获得赞同数 |
| `thanked_count` | 获得感谢数 |
| `creation_count` | 创作总数 |
| `notifications` | 通知计数：`default`、`follow`、`vote_thank`、`messages` |

**示例**

```json
{
  "name": "张三",
  "url": "https://www.zhihu.com/people/zhang-san",
  "answer_count": 42,
  "voteup_count": 1200,
  "notifications": {
    "default": 3,
    "follow": 1,
    "vote_thank": 0,
    "messages": 2
  }
}
```

---

## zhihu/hot — 热榜

调用 `GET /api/v3/feed/topstory/hot-lists/total`，返回知乎全站热榜。

```bash
bun-browser site zhihu/hot [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `20` | 返回条数，上限 **50** |

**示例**

```bash
bun-browser site zhihu/hot
bun-browser site zhihu/hot 10
bun-browser site zhihu/hot 30 --json --jq '.items[] | {rank, title, heat, url}'
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `count` | 实际返回条数 |
| `items[]` | 热榜条目 |
| `items[].rank` | 排名（从 1 开始） |
| `items[].id` | 问题 ID |
| `items[].title` | 问题标题 |
| `items[].url` | 问题链接 |
| `items[].excerpt` | 摘要 |
| `items[].answer_count` | 回答数 |
| `items[].follower_count` | 关注数 |
| `items[].heat` | 热度文案（如「1234 万热度」） |
| `items[].trend` | `up` / `down` / `stable` |
| `items[].is_new` | 是否新上榜 |

---

## zhihu/search — 搜索

调用 `GET /api/v4/search_v3`，综合搜索问题、回答、文章等。

```bash
bun-browser site zhihu/search <keyword> [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `keyword` | ✅ | — | 搜索关键词 |
| `count` | ❌ | `10` | 返回条数，上限 **20** |

**示例**

```bash
bun-browser site zhihu/search AI
bun-browser site zhihu/search "Rust 异步" 15
bun-browser site zhihu/search 机器学习 --json --jq '.results[] | {type, title, voteup_count, url}'
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `keyword` | 搜索词 |
| `count` | 结果条数 |
| `has_more` | 是否还有更多（API 分页未结束） |
| `results[]` | 结果列表 |
| `results[].rank` | 序号 |
| `results[].type` | 内容类型：`answer`、`article`、`question` 等 |
| `results[].id` | 内容 ID |
| `results[].title` | 标题（回答/文章）或问题名 |
| `results[].excerpt` | 摘要（已去除 HTML 标签） |
| `results[].url` | 直达链接（回答、专栏文章或问题） |
| `results[].author` | 作者昵称 |
| `results[].voteup_count` | 赞同数 |
| `results[].comment_count` | 评论数 |
| `results[].question_id` | 所属问题 ID（回答类型时有值） |
| `results[].question_title` | 所属问题标题 |
| `results[].created_time` / `updated_time` | Unix 时间戳 |

> 搜索结果的 `type` 决定 `url` 格式：回答链到 `/question/{qid}/answer/{aid}`，专栏文章链到 `zhuanlan.zhihu.com/p/{id}`，问题链到 `/question/{id}`。

---

## zhihu/question — 问题与回答

并行请求问题详情与默认排序下的热门回答。

```bash
bun-browser site zhihu/question <id> [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `id` | ✅ | — | 问题 ID（纯数字） |
| `count` | ❌ | `5` | 回答条数，上限 **20** |

**示例**

```bash
bun-browser site zhihu/question 34816524
bun-browser site zhihu/question 34816524 10

# 从 URL 提取 ID：https://www.zhihu.com/question/34816524 → 34816524
bun-browser site zhihu/question 632345678 3 --json --jq '.answers[] | {rank, author, voteup_count, content}'
```

**问题字段**

| 字段 | 说明 |
|------|------|
| `id` | 问题 ID |
| `title` | 标题 |
| `url` | 问题链接 |
| `detail` | 问题描述（纯文本，已去 HTML） |
| `excerpt` | 摘要 |
| `answer_count` | 总回答数 |
| `follower_count` | 关注数 |
| `visit_count` | 浏览量 |
| `comment_count` | 问题评论数 |
| `topics[]` | 话题标签名称列表 |
| `answers_total` | API 报告的回答总数 |
| `answers[]` | 热门回答列表 |

**回答字段（`answers[]`）**

| 字段 | 说明 |
|------|------|
| `rank` | 在本批结果中的序号 |
| `id` | 回答 ID |
| `author` | 作者昵称 |
| `author_headline` | 作者简介 |
| `voteup_count` | 赞同数 |
| `comment_count` | 评论数 |
| `content` | 正文（纯文本，**最多 800 字符**） |
| `created_time` / `updated_time` | Unix 时间戳 |

> 回答按知乎默认排序（非「时间排序」或「只看作者」）。需要更多回答时增大 `count`，或多次调用配合浏览器阅读。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 热榜标题与链接
bun-browser site zhihu/hot 15 --json --jq '.items[] | {rank, title, heat, url}'

# 搜索后只看高赞回答
bun-browser site zhihu/search "ChatGPT" --json --jq '.results[] | select(.type=="answer") | {title, voteup_count, url}'

# 问题下赞同最高的回答作者
bun-browser site zhihu/question 34816524 --json --jq '.answers[0] | {author, voteup_count, content}'
```

---

## 常见问题

### `HTTP 401` / `Not logged in?`

当前浏览器 session 未登录知乎，或 Cookie 已过期。

```bash
bun-browser open https://www.zhihu.com/ --tab current
# 在 Chrome 中完成登录后重试
bun-browser site zhihu/me
```

### `HTTP 404 fetching question` / `Question not found`

- 确认 `id` 为纯数字问题 ID，不是回答 ID 或专栏文章 ID
- 问题可能已删除或仅自己可见

从 URL 提取问题 ID：

- `https://www.zhihu.com/question/34816524` → `34816524`
- `https://www.zhihu.com/question/34816524/answer/1234567890` → 问题 ID 仍是 `34816524`（回答 ID 用于 `url`，不能传给 `zhihu/question`）

### 搜索无结果或结果很少

- 换更具体或更宽泛的关键词
- `count` 最大 20；`has_more: true` 表示 API 侧还有更多，当前 adapter 只取第一页

### 回答正文被截断

`zhihu/question` 将每条回答正文限制在 **800 字符**，便于 Agent 上下文控制。需要全文请在浏览器打开返回的 `url`，或使用 `bun-browser snapshot` / `bun-browser get` 读取页面。

### 热榜与网页不一致

热榜数据来自 `/api/v3/feed/topstory/hot-lists/total`，与 App/Web 热榜可能存在 slight 时差或排序差异，属正常现象。

### 请求过于频繁

批量搜索或连续拉多个问题时建议**串行**执行，间隔 1–2 秒，避免触发知乎限流。

---

## 技术说明

- **无需知乎开放平台 API** — adapter 直接调用 zhihu.com 网页端同款 JSON API，与已登录浏览器 session 一致。
- **只读** — 四个命令均为 `readOnly: true`，不会发帖、点赞、关注或修改账号。
- **HTML 清理** — `search` 与 `question` 会 strip HTML 标签与常见实体，输出纯文本。
- **Private adapter** — 可将修改版放到 `~/.bun-browser/sites/zhihu/`，同名文件会覆盖社区版。

---

## English summary

Four read-only CLI commands for Zhihu (知乎) via bun-browser — logged-in Chrome, no API key:

| Command | Purpose |
|---------|---------|
| `zhihu/me` | Current user profile, stats, notification counts |
| `zhihu/hot [count]` | Hot list / trending questions (max 50) |
| `zhihu/search <keyword> [count]` | Search answers, articles, questions (max 20) |
| `zhihu/question <id> [count]` | Question detail + top answers (max 20 answers, content truncated to 800 chars) |

**Prerequisites:** `bun-browser start`, open and log in at `https://www.zhihu.com/`, run `bun-browser site update`.

**Typical flow:** `hot` or `search` → pick question `id` → `question` for answers.

**Per-command docs:** `bun-browser site info zhihu/<command>`
