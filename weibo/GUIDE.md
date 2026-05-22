# 微博使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里调用微博网页端 AJAX API，无需开放平台 API Key、无需手动导出 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. **必须登录微博** — 所有 adapter 依赖 `weibo.com` 域下的 session Cookie

```bash
bun-browser open https://weibo.com/ --tab current
# 在 Chrome 中完成登录，确认首页能正常加载
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep weibo   # 应看到 weibo/ 下 9 个命令
```

> 所有 adapter 在 `weibo.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器登录态。部分命令（`me`、`feed`、`likes`）会优先读取页面 Vuex store 中的 `uid`，因此建议在已打开的微博 tab 上执行，或先 `open https://weibo.com/` 再调用命令。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `weibo/me` | 当前登录用户信息 | 确认账号、查粉丝/微博数 |
| `weibo/hot` | 微博热搜榜 | 每日扫热点、选题、监控舆论 |
| `weibo/feed` | 首页关注时间线 | 浏览关注的人的微博 |
| `weibo/user` | 用户 profile | 查粉丝数、认证、简介 |
| `weibo/user_posts` | 用户微博列表 | 监控 KOL、抓取历史博文 |
| `weibo/post` | 单条微博详情 | 读全文、图片链接、转发链 |
| `weibo/comments` | 微博评论 | 读讨论、抓热门评论 |
| `weibo/likes` | 用户赞过的微博 | 导出点赞记录 |
| `weibo/favorites` | 当前用户收藏 | 导出书签，支持 Markdown |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info weibo/me
bun-browser site info weibo/post
bun-browser site info weibo/favorites
```

## 推荐工作流

### 从热搜到深度阅读

```bash
# 1. 拉取热搜前 20 条
bun-browser site weibo/hot 20

# 2. 在浏览器打开 items[].url 浏览话题页，或搜索目标用户

# 3. 查用户资料 → 最近微博 → 单条详情 → 评论
bun-browser site weibo/user 1654184992
bun-browser site weibo/user_posts 1654184992
bun-browser site weibo/post QvqcCrCyL
bun-browser site weibo/comments 5274888946583083
```

### 监控 KOL 时间线

```bash
# 1. 确认 uid（数字 ID，非昵称时更稳定）
bun-browser site weibo/user plantegg

# 2. 拉最近一页微博
bun-browser site weibo/user_posts 1654184992

# 3. 只看原创（feature=1）
bun-browser site weibo/user_posts 1654184992 1 1

# 4. 翻页
bun-browser site weibo/user_posts 1654184992 2
```

### 每日信息流

```bash
bun-browser open https://weibo.com/home --tab current

# 关注时间线
bun-browser site weibo/me
bun-browser site weibo/feed 20

# 热搜速览
bun-browser site weibo/hot 10 --json --jq '.items[] | {rank, word, hot_value, url}'
```

### 导出个人数据

```bash
# 赞过的微博（默认当前用户）
bun-browser site weibo/likes
bun-browser site weibo/likes 1654184992 2   # 指定 uid，第 2 页

# 收藏 — JSON 或 Markdown
bun-browser site weibo/favorites
bun-browser site weibo/favorites all md      # 全部收藏，Markdown 格式
```

---

## weibo/me — 当前用户信息

优先从页面 Vuex store 读取当前用户，再调用 `/ajax/profile/detail` 补充详情。

```bash
bun-browser site weibo/me
```

无参数。

**返回字段**

| 字段 | 说明 |
|------|------|
| `id` | 用户 uid（数字） |
| `screen_name` | 昵称 |
| `description` | 个人简介 |
| `location` | 地区 |
| `gender` | `male` / `female` / `unknown` |
| `followers_count` | 粉丝数 |
| `following_count` | 关注数 |
| `statuses_count` | 微博数 |
| `verified` | 是否认证 |
| `domain` | 个性域名（如有） |
| `url` | 个人网站 |
| `avatar` | 头像 URL（高清） |
| `profile_url` | 主页链接 |
| `birthday` | 生日（如有） |
| `created_at` | 注册时间 |
| `ip_location` | IP 属地 |
| `company` | 公司 |
| `credit` | 阳光信用等级 |

---

## weibo/hot — 热搜榜

调用 `/ajax/statuses/hot_band`，返回微博全站热搜。

```bash
bun-browser site weibo/hot [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `30` | 返回条数，上限 **50** |

**示例**

```bash
bun-browser site weibo/hot
bun-browser site weibo/hot 20
bun-browser site weibo/hot 10 --json --jq '.items[] | {rank, word, hot_value, url}'
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `count` | 实际返回条数 |
| `top` | 置顶政务/公告条目（如有）：`word`、`url` |
| `items[]` | 热搜条目 |
| `items[].rank` | 排名 |
| `items[].word` | 热搜词 |
| `items[].hot_value` | 热度值 |
| `items[].raw_hot` | 原始热度 |
| `items[].category` | 分类 |
| `items[].label` | 标签（如「新」「沸」） |
| `items[].is_new` | 是否新上榜 |
| `items[].url` | 搜索页链接 |

---

## weibo/feed — 首页关注时间线

调用 `/ajax/feed/unreadfriendstimeline`，返回关注用户的微博。

```bash
bun-browser site weibo/feed [count]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `15` | 微博条数，上限 **50** |

**返回字段**

| 字段 | 说明 |
|------|------|
| `count` | 实际返回条数 |
| `statuses[]` | 微博列表 |
| `statuses[].id` | 微博 idstr（数字字符串） |
| `statuses[].mblogid` | 短 ID（URL 中的字母数字段） |
| `statuses[].text` | 正文（纯文本） |
| `statuses[].created_at` | 发布时间 |
| `statuses[].source` | 发布来源（如「iPhone客户端」） |
| `statuses[].reposts_count` | 转发数 |
| `statuses[].comments_count` | 评论数 |
| `statuses[].likes_count` | 点赞数 |
| `statuses[].is_long_text` | 是否长微博 |
| `statuses[].pic_count` | 图片数量 |
| `statuses[].user` | 作者：`id`、`screen_name`、`verified` |
| `statuses[].url` | 微博直达链接 |
| `statuses[].retweeted` | 被转发的原博（如有） |

---

## weibo/user — 用户 profile

调用 `/ajax/profile/info` + `/ajax/profile/detail`。`id` 支持数字 uid 或昵称（screen_name）。

```bash
bun-browser site weibo/user <id>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 数字 uid 或 screen_name |

**示例**

```bash
bun-browser site weibo/user 1654184992
bun-browser site weibo/user plantegg
```

**返回字段**

除 `weibo/me` 中的字段外，还包括：

| 字段 | 说明 |
|------|------|
| `verified_type` | 认证类型 |
| `verified_reason` | 认证说明 |
| `following` | 当前账号是否已关注该用户 |
| `follow_me` | 该用户是否关注了当前账号 |
| `mbrank` | 会员等级 |
| `svip` | 是否 SVIP |

---

## weibo/user_posts — 用户微博列表

调用 `/ajax/statuses/mymblog`，按页返回指定用户的微博。

```bash
bun-browser site weibo/user_posts <uid> [page] [feature]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `uid` | ✅ | — | 用户数字 uid |
| `page` | ❌ | `1` | 页码 |
| `feature` | ❌ | `0` | 内容筛选：`0`=全部，`1`=原创，`2`=图片，`3`=视频，`4`=音乐 |

**示例**

```bash
bun-browser site weibo/user_posts 1654184992
bun-browser site weibo/user_posts 1654184992 2        # 第 2 页
bun-browser site weibo/user_posts 1654184992 1 1        # 只看原创
bun-browser site weibo/user_posts 1654184992 --json --jq '.posts[] | {text, likes_count, url}'
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `uid` | 用户 uid |
| `page` | 当前页码 |
| `total` | 微博总数 |
| `count` | 本页条数 |
| `posts[]` | 微博列表（字段同 `feed` 中的 `statuses[]`） |

---

## weibo/post — 单条微博详情

调用 `/ajax/statuses/show`，长微博会自动再请求 `/ajax/statuses/longtext` 获取全文。

```bash
bun-browser site weibo/post <id>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 微博 idstr（数字）或 mblogid（URL 中的短 ID） |

**示例**

```bash
# 从 URL https://weibo.com/1654184992/QvqcCrCyL 提取 mblogid
bun-browser site weibo/post QvqcCrCyL

# 或用数字 idstr
bun-browser site weibo/post 5274888946583083
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `id` / `mblogid` | 微博 ID |
| `text` | 完整正文（长微博已展开） |
| `created_at` / `source` | 时间、来源 |
| `reposts_count` / `comments_count` / `likes_count` | 互动数据 |
| `is_long_text` | 是否长微博 |
| `pic_count` | 图片数量 |
| `pics[]` | 图片 URL 列表（大图） |
| `user` | 作者详情（含 `followers_count`） |
| `url` | 微博链接 |
| `retweeted` | 被转发的原博（含完整 `user`、`url`、互动数） |

---

## weibo/comments — 微博评论

调用 `/ajax/statuses/buildComments`，支持 cursor 分页。

```bash
bun-browser site weibo/comments <id> [count] [max_id]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `id` | ✅ | — | 微博 idstr（数字） |
| `count` | ❌ | `20` | 评论条数，上限 **50** |
| `max_id` | ❌ | — | 分页游标（来自上次响应的 `max_id`） |

**示例**

```bash
# 第一页
bun-browser site weibo/comments 5274888946583083 30

# 翻页（用上一条返回的 max_id）
bun-browser site weibo/comments 5274888946583083 30 1234567890123456
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `post_id` | 微博 id |
| `count` | 本批评论数 |
| `max_id` | 下一页游标（无更多时为 `null`） |
| `has_more` | 是否还有更多 |
| `comments[]` | 评论列表 |
| `comments[].id` | 评论 id |
| `comments[].text` | 评论正文 |
| `comments[].created_at` | 时间 |
| `comments[].likes_count` | 点赞数 |
| `comments[].reply_count` | 子回复数 |
| `comments[].user` | 评论者 |
| `comments[].reply_to` | 回复对象（楼中楼时有值） |

> 评论分页用 `max_id`，不是页码。`has_more: false` 时停止翻页。

---

## weibo/likes — 赞过的微博

调用 `/ajax/statuses/likelist`，默认拉取当前登录用户的点赞列表。

```bash
bun-browser site weibo/likes [uid] [page]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `uid` | ❌ | 当前用户 | 目标用户 uid |
| `page` | ❌ | `1` | 页码 |

**示例**

```bash
bun-browser site weibo/likes
bun-browser site weibo/likes 1654184992 2
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `uid` | 用户 uid |
| `page` | 当前页码 |
| `count` | 本页条数 |
| `posts[]` | 微博列表（含 `user`、`retweeted` 等） |

> 仅能查看**公开可见**的点赞列表；部分用户关闭了点赞可见性时会返回空或报错。

---

## weibo/favorites — 收藏的微博

调用 `/ajax/favorites/all_fav`，仅当前登录用户可用。

```bash
bun-browser site weibo/favorites [page] [format]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `page` | ❌ | `1` | 页码；传 `all` 自动翻页拉取全部 |
| `format` | ❌ | `json` | 输出格式：`json` 或 `md`（Markdown） |

**示例**

```bash
bun-browser site weibo/favorites
bun-browser site weibo/favorites 2
bun-browser site weibo/favorites all
bun-browser site weibo/favorites all md    # 导出为 Markdown 文档
```

**JSON 返回字段**

| 字段 | 说明 |
|------|------|
| `page` | 页码或 `"all"` |
| `total` | 收藏总数（`page=all` 时有值） |
| `count` | 实际拉取条数 |
| `posts[]` | 收藏的微博列表 |

**Markdown 格式**

`format=md` 时返回纯 Markdown 文本（非 JSON），每条收藏包含作者、正文、互动数据、链接，适合直接保存为 `.md` 文件：

```bash
bun-browser site weibo/favorites all md > weibo-favorites.md
```

> `page=all` 会连续请求多页（每页约 16 条），大量收藏时耗时较长；内置安全上限 1000 页。

---

## 微博 ID 说明

微博 URL 有两种常见 ID，adapter 会自动识别：

| 类型 | 示例 | 用于 |
|------|------|------|
| **mblogid** | `QvqcCrCyL` | `weibo/post`（推荐，来自 URL 路径） |
| **idstr** | `5274888946583083` | `weibo/post`、`weibo/comments` |
| **uid** | `1654184992` | `weibo/user_posts`、`weibo/likes` |

从 URL 提取：

- `https://weibo.com/1654184992/QvqcCrCyL` → uid=`1654184992`，mblogid=`QvqcCrCyL`
- `https://weibo.com/u/1654184992` → uid=`1654184992`

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 热搜标题与链接
bun-browser site weibo/hot 15 --json --jq '.items[] | {rank, word, hot_value, url}'

# 时间线高互动微博
bun-browser site weibo/feed 20 --json --jq '.statuses[] | select(.likes_count > 100) | {user: .user.screen_name, text, likes_count, url}'

# 用户最近 5 条原创
bun-browser site weibo/user_posts 1654184992 1 1 --json --jq '.posts[:5] | .[] | {text, url}'

# 评论点赞 Top 5
bun-browser site weibo/comments 5274888946583083 50 --json --jq '[.comments[] | {user: .user.screen_name, text, likes_count}] | sort_by(-.likes_count) | .[:5]'
```

---

## 常见问题

### `Not logged in` / `HTTP 401`

当前浏览器 session 未登录微博，或 Cookie 已过期。

```bash
bun-browser open https://weibo.com/ --tab current
# 在 Chrome 中完成登录后重试
bun-browser site weibo/me
```

### `User data not available from config`

页面 Vuex store 未初始化。先打开微博首页让页面完全加载：

```bash
bun-browser open https://weibo.com/home --tab current
# 等待页面加载完成后重试
bun-browser site weibo/me
bun-browser site weibo/feed
```

### `User not found`

- `weibo/user`：确认 uid 为纯数字，或 screen_name 拼写正确
- `weibo/user_posts`：仅支持数字 uid，不支持昵称

### `Post not found` / `HTTP 404`

- 微博可能已删除或仅自己可见
- `weibo/comments` 需要数字 **idstr**，不能传 mblogid；先用 `weibo/post` 获取 `id` 字段

### 长微博正文不完整

`weibo/feed` 和 `weibo/user_posts` 可能截断长微博正文（`is_long_text: true`）。需要全文请调用：

```bash
bun-browser site weibo/post <mblogid_or_idstr>
```

### 热搜与 App 不一致

热搜来自 `/ajax/statuses/hot_band`，与微博 App/Web 可能存在 slight 时差或排序差异，属正常现象。

### 请求过于频繁

批量拉取用户微博或评论时建议**串行**执行，间隔 1–2 秒，避免触发微博限流。

---

## 手机版 adapter（m_weibo）

若桌面版 API 不稳定，可尝试手机版 adapter（`m_weibo/`），使用移动端 JSON API，额外提供 `m_weibo/search`：

```bash
bun-browser open https://m.weibo.cn/ --tab current
bun-browser site m_weibo/hot
bun-browser site m_weibo/search "关键词"
bun-browser site m_weibo/user 1654184992
```

命令与桌面版大致对应：`me`、`hot`、`feed`、`user`、`user_posts`、`comments`，详见 `bun-browser site list | grep m_weibo`。

---

## 技术说明

- **无需微博开放平台 API** — adapter 直接调用 weibo.com 网页端同款 AJAX 接口，与已登录浏览器 session 一致。
- **只读** — 九个命令均为 `readOnly: true`，不会发微博、点赞、关注或修改账号。
- **HTML 清理** — 正文与来源字段会 strip HTML 标签与常见实体，输出纯文本。
- **Private adapter** — 可将修改版放到 `~/.bun-browser/sites/weibo/`，同名文件会覆盖社区版。

---

## English summary

Nine read-only CLI commands for Weibo (微博) via bun-browser — logged-in Chrome, no API key:

| Command | Purpose |
|---------|---------|
| `weibo/me` | Current user profile and stats |
| `weibo/hot [count]` | Hot search / trending (max 50) |
| `weibo/feed [count]` | Home timeline from followed users (max 50) |
| `weibo/user <id>` | User profile by uid or screen_name |
| `weibo/user_posts <uid> [page] [feature]` | User's posts with optional content filter |
| `weibo/post <id>` | Single post detail (idstr or mblogid; fetches long text) |
| `weibo/comments <id> [count] [max_id]` | Comments with cursor pagination |
| `weibo/likes [uid] [page]` | Posts liked by user (default: current user) |
| `weibo/favorites [page] [format]` | Bookmarked posts; `page=all`, `format=md` supported |

**Prerequisites:** `bun-browser start`, open and log in at `https://weibo.com/`, run `bun-browser site update`.

**Typical flow:** `hot` → `user` → `user_posts` → `post` → `comments`.

**Post IDs:** URL path segment = `mblogid` (e.g. `QvqcCrCyL`); numeric `idstr` works for `post` and `comments`.

**Per-command docs:** `bun-browser site info weibo/<command>`

**Mobile fallback:** `m_weibo/*` adapters on `m.weibo.cn`, includes `m_weibo/search`.
