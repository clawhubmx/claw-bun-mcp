# YouTube 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里调用 YouTube InnerTube API，无需 API Key、无需抓 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开 YouTube（建议已登录，订阅 feed 等功能需要登录）

```bash
bun-browser open https://www.youtube.com/ --tab current
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep youtube   # 确认 6 个命令可用
```

> 所有 adapter 在 `www.youtube.com` 域下执行，依赖页面上的 `ytcfg`（InnerTube API key 与 context）。若报错 `YouTube config not found`，先 `bun-browser open https://www.youtube.com/` 再重试。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `youtube/search` | 搜索视频 | 按关键词找视频 |
| `youtube/video` | 视频详情 | 标题、播放量、点赞、频道、字幕语言列表 |
| `youtube/comments` | 视频评论 | 抓取评论列表 |
| `youtube/channel` | 频道信息 + 近期视频 | 查 UP 主资料与最新上传 |
| `youtube/feed` | 首页或订阅 feed | 浏览推荐 / 订阅更新 |
| `youtube/transcript` | 视频字幕/文稿 | 提取带时间戳的全文（须在视频页） |

查看单个命令的完整参数：

```bash
bun-browser site info youtube/search
bun-browser site info youtube/transcript
```

## 推荐工作流

### 研究一条视频（搜索 → 详情 → 评论 → 字幕）

```bash
# 1. 搜索
bun-browser site youtube/search "TypeScript tutorial" --max 5

# 2. 打开目标视频（字幕命令必须在视频页）
bun-browser open "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --tab current

# 3. 详情（可省略 id，自动读当前页）
bun-browser site youtube/video

# 4. 评论
bun-browser site youtube/comments --max 30

# 5. 字幕
bun-browser site youtube/transcript
bun-browser site youtube/transcript --lang en   # 指定语言
```

### 跟踪一个频道

```bash
bun-browser site youtube/channel "@programmingwithmosh" --max 15
bun-browser site youtube/channel UC_x5XG1OV2P6uZZ5FSM9Ttw --max 10   # 也可用 UC 开头的 channel ID
```

### 看今日订阅

```bash
bun-browser open https://www.youtube.com/ --tab current   # 确保已登录
bun-browser site youtube/feed subscriptions --max 30
```

---

## youtube/search — 搜索视频

```bash
bun-browser site youtube/search "<query>" [--max N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词 |
| `--max` | ❌ | `20` | 最多返回条数，上限 50 |

**返回示例**

```json
{
  "query": "TypeScript tutorial",
  "resultCount": 5,
  "videos": [
    {
      "videoId": "dQw4w9WgXcQ",
      "title": "...",
      "channel": "Channel Name",
      "channelId": "UCxxxx",
      "views": "1.2M views",
      "duration": "12:34",
      "publishedTime": "2 weeks ago",
      "description": "...",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    }
  ]
}
```

---

## youtube/video — 视频详情

支持两种方式：

1. **在视频页执行** — 读取 `ytInitialPlayerResponse` / `ytInitialData`，字段最全（描述、时长、分类、字幕语言等）
2. **只传 video ID** — 通过 InnerTube `next` API 获取基础信息

```bash
# 方式 A：先打开视频页
bun-browser open "https://www.youtube.com/watch?v=d56mG7DezGs" --tab current
bun-browser site youtube/video

# 方式 B：直接传 ID（须在 youtube.com 任意页）
bun-browser site youtube/video d56mG7DezGs
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `id` | ❌ | 11 位 video ID；省略时从当前页 URL 的 `?v=` 解析 |

**在视频页时的主要返回字段**

| 字段 | 说明 |
|------|------|
| `videoId` | 视频 ID |
| `title` | 标题 |
| `channel` / `channelId` / `channelUrl` | 频道名、ID、链接 |
| `subscriberCount` | 频道订阅数（格式化字符串） |
| `description` | 简介（截断至 1000 字符） |
| `duration` / `durationFormatted` | 时长（秒 / `H:MM:SS`） |
| `viewCount` / `viewCountFormatted` | 播放量 |
| `likes` | 点赞数（格式化字符串，如 `12K`） |
| `publishDate` | 发布日期 |
| `category` | 分类 |
| `isLive` | 是否直播 |
| `keywords` | 标签（最多 20 个） |
| `captionLanguages` | 可用字幕语言列表 |
| `url` | 视频链接 |

---

## youtube/comments — 视频评论

```bash
bun-browser site youtube/comments [videoId] [--max N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `id` | ❌ | 当前页视频 | 11 位 video ID |
| `--max` | ❌ | `20` | 最多返回条数，上限 100 |

**返回示例**

```json
{
  "videoId": "d56mG7DezGs",
  "commentCountText": "1,234 Comments",
  "fetchedCount": 20,
  "comments": [
    {
      "rank": 1,
      "author": "User Name",
      "authorChannelId": "UCxxxx",
      "text": "Great video!",
      "publishedTime": "3 days ago",
      "likes": "42",
      "replyCount": "2",
      "isPinned": false
    }
  ]
}
```

> 仅返回首页评论（YouTube 默认排序）。若视频关闭评论，会返回 `No comment section found`。

---

## youtube/channel — 频道信息与近期视频

```bash
bun-browser site youtube/channel [id_or_handle] [--max N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `id` | ❌ | 当前页频道 | `UCxxxx` 频道 ID，或 `@handle` |
| `--max` | ❌ | `10` | 近期视频条数，上限 30 |

**示例**

```bash
bun-browser site youtube/channel "@mkbhd"
bun-browser site youtube/channel UCBJycsmduvYEL83R_U4JriQ

# 在频道页执行，自动识别当前频道
bun-browser open "https://www.youtube.com/@mkbhd" --tab current
bun-browser site youtube/channel
```

**返回字段**

| 字段 | 说明 |
|------|------|
| `channelId` | 频道 ID |
| `name` | 频道名称 |
| `handle` | `@handle` |
| `description` | 简介（截断至 500 字符） |
| `subscriberCount` | 订阅数 |
| `channelUrl` | 频道链接 |
| `tabs` | 频道页 tab 名称列表 |
| `recentVideos[]` | 近期视频：`videoId`, `title`, `duration`, `viewsAndTime`, `url` |

---

## youtube/feed — 首页 / 订阅 feed

```bash
bun-browser site youtube/feed [home|subscriptions] [--max N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `type` | ❌ | `home` | `home` 推荐页，或 `subscriptions` 订阅 |
| `--max` | ❌ | `20` | 视频条数，上限 50 |

**示例**

```bash
bun-browser site youtube/feed                    # 首页推荐
bun-browser site youtube/feed home --max 30
bun-browser site youtube/feed subscriptions        # 需要登录
```

**返回示例**

```json
{
  "feed": "subscriptions",
  "source": "api",
  "videoCount": 20,
  "videos": [
    {
      "videoId": "abc123",
      "title": "...",
      "channel": "Channel Name",
      "duration": "10:05",
      "viewsAndTime": "50K views | 2 hours ago",
      "url": "https://www.youtube.com/watch?v=abc123"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `source` | `page`（直接读首页 DOM 数据）或 `api`（InnerTube browse） |
| `feed` | `home` 或 `subscriptions` |

> **订阅 feed 必须登录。** 未登录时返回 `Not logged in for subscriptions`。首页 feed 在 `youtube.com/` 且页面已加载时，会优先读页面内嵌数据，速度更快。

---

## youtube/transcript — 视频字幕 / 文稿

**必须在视频播放页执行**（`youtube.com/watch?v=...`）。adapter 会展开页面上的 transcript 面板并从 DOM 读取分段字幕。

```bash
bun-browser open "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --tab current
bun-browser site youtube/transcript
bun-browser site youtube/transcript --lang ja
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--lang` | ❌ | 语言代码，如 `en`、`ja`、`zh-Hans`；省略则用第一个可用轨道 |

**返回示例**

```json
{
  "videoId": "dQw4w9WgXcQ",
  "language": "en",
  "languageName": "English",
  "kind": "asr",
  "segmentCount": 142,
  "totalDuration": 213,
  "availableTracks": [
    {"lang": "en", "name": "English", "kind": "asr"}
  ],
  "segments": [
    {"start": 0, "startFormatted": "0:00", "text": "..."},
    {"start": 5, "startFormatted": "0:05", "text": "..."}
  ],
  "fullText": "..."
}
```

| 字段 | 说明 |
|------|------|
| `kind` | `manual`（人工字幕）或 `asr`（自动生成） |
| `segments` | 带时间戳的分段列表 |
| `fullText` | 拼接全文（截断至 5000 字符） |
| `availableTracks` | 该视频所有可用字幕语言 |

> adapter 会临时展开 transcript 面板，读取完成后恢复隐藏状态，不会永久改变页面 UI。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# 搜索后只取前 3 个 videoId
bun-browser site youtube/search "rust tutorial" --max 3 --json --jq '.videos[].videoId'

# 只看评论作者和正文
bun-browser site youtube/comments d56mG7DezGs --json --jq '.comments[] | {author, text}'

# 频道最近 5 个视频标题
bun-browser site youtube/channel "@mkbhd" --json --jq '.recentVideos[:5][].title'
```

---

## 常见问题

### `YouTube config not found`

当前 tab 不在 `youtube.com`，或页面尚未加载完 InnerTube 配置。

```bash
bun-browser open https://www.youtube.com/ --tab current
# 等待 1–2 秒后重试
```

### `Not logged in for subscriptions`

订阅 feed 需要 Google 账号登录 YouTube。在 Chrome 中登录后重试：

```bash
bun-browser open https://www.youtube.com/ --tab current
bun-browser site youtube/feed subscriptions
```

### `Not on a video page`（transcript）

`youtube/transcript` 必须在 `watch?v=` 页面运行：

```bash
bun-browser open "https://www.youtube.com/watch?v=VIDEO_ID" --tab current
bun-browser site youtube/transcript
```

### `No transcript panel found`

该视频没有字幕/自动字幕，或 YouTube 未提供 transcript 面板。返回中的 `availableTracks` 会列出检测到的字幕轨道（可能为空）。

### `No comment section found`

评论已关闭，或该视频/Shorts 不支持评论 API。

### `Channel not found`

- 确认 handle 带 `@` 前缀：`"@mkbhd"` 而非 `mkbhd`
- 或改用 `UC` 开头的 channel ID

### 视频 ID 格式

YouTube video ID 固定 **11 位**字母数字（含 `-`、`_`）。可从 URL 提取：

- `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → `dQw4w9WgXcQ`
- `https://youtu.be/dQw4w9WgXcQ` → `dQw4w9WgXcQ`

---

## 技术说明

- **无需 YouTube Data API Key** — adapter 复用浏览器 session 内的 InnerTube API（`/youtubei/v1/*`），与网页端相同。
- **只读** — 所有 6 个命令 `readOnly: true`，不会点赞、订阅或发评论。
- **速率** — 批量调用时建议串行执行，避免触发 YouTube 限流。
- **Private adapter** — 可将修改版放到 `~/.bun-browser/sites/youtube/`，同名文件会覆盖社区版。

---

## English summary

Six read-only CLI commands for YouTube via bun-browser (logged-in Chrome, no API key):

| Command | Purpose |
|---------|---------|
| `youtube/search <query>` | Search videos (max 50) |
| `youtube/video [id]` | Video metadata; richest on watch page |
| `youtube/comments [id]` | Top comments (max 100) |
| `youtube/channel [id\|@handle]` | Channel profile + recent uploads |
| `youtube/feed [home\|subscriptions]` | Home or subscriptions feed (subs needs login) |
| `youtube/transcript [--lang]` | Captions from DOM (**must** be on watch page) |

**Prerequisites:** `bun-browser start`, open `https://www.youtube.com/`, run `bun-browser site update`.

**Typical flow:** search → `open` watch URL → `video` / `comments` / `transcript`.

**Docs per command:** `bun-browser site info youtube/<command>`
