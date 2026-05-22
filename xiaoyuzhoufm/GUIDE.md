# 小宇宙使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里读取 [小宇宙](https://www.xiaoyuzhoufm.com) 播客与单集数据（订阅数、播放量、评论数、Shownotes、链接等），无需 API Key、无需抓 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开小宇宙（公开数据一般无需登录；若遇限流可先登录）

```bash
bun-browser open https://www.xiaoyuzhoufm.com/ --tab current
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep xiaoyuzhoufm   # 应看到 2 个命令
```

> 所有 adapter 在 `www.xiaoyuzhoufm.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。站点为 Next.js SSR，adapter 会解析页面 `__NEXT_DATA__` 并调用 `/_next/data/{buildId}/...` 接口。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `xiaoyuzhoufm/podcast` | 播客详情 + 近期单集列表 | 看节目概况、对比各集播放/评论 |
| `xiaoyuzhoufm/episode` | 单集完整详情 | 读 Shownotes、嘉宾、外链、时长与互动数据 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info xiaoyuzhoufm/podcast
bun-browser site info xiaoyuzhoufm/episode
```

## 如何获取 ID

小宇宙 URL 中的 ID 即命令参数：

| 类型 | URL 示例 | 参数名 | 格式 |
|------|----------|--------|------|
| 播客 | `https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962` | `pid` | 24 位十六进制 |
| 单集 | `https://www.xiaoyuzhoufm.com/episode/69ba2e32f8b8079bfaef73e5` | `eid` | 24 位十六进制 |

在浏览器打开对应页面后，从地址栏复制最后一段 ID 即可。

## 推荐工作流

### 从播客概览到单集深度

```bash
# 1. 拉取播客信息与最近最多 20 集（含播放/评论/收藏数）
bun-browser site xiaoyuzhoufm/podcast 626b46ea9cbbf0451cf5a962

# 2. 从返回的 episodes[].eid 选某一集继续
bun-browser site xiaoyuzhoufm/episode 69ba2e32f8b8079bfaef73e5
```

### 直接查某一集（已知 episode 链接）

```bash
bun-browser site xiaoyuzhoufm/episode 69ba2e32f8b8079bfaef73e5
```

### 用 jq 提取关键字段

```bash
# 播客名 + 订阅数
bun-browser site xiaoyuzhoufm/podcast 626b46ea9cbbf0451cf5a962 \
  --json --jq '{title, subscriptionCount, episodeCount, url}'

# 各集标题与播放量
bun-browser site xiaoyuzhoufm/podcast 626b46ea9cbbf0451cf5a962 \
  --json --jq '.episodes[] | {title, playCount, commentCount, eid}'

# 单集外链列表
bun-browser site xiaoyuzhoufm/episode 69ba2e32f8b8079bfaef73e5 \
  --json --jq '.links'
```

---

## xiaoyuzhoufm/podcast — 播客详情与近期单集

抓取播客页 HTML，解析 `__NEXT_DATA__` 与 schema.org 元数据，再对页面上出现的单集批量请求 `_next/data` API，补齐互动数据。

```bash
bun-browser site xiaoyuzhoufm/podcast <pid>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `pid` | ✅ | 播客 ID，来自 `/podcast/{pid}` URL |

**返回字段（顶层）**

| 字段 | 说明 |
|------|------|
| `pid` | 播客 ID |
| `title` | 节目名称 |
| `author` | 主播/作者 |
| `description` | 节目简介（截断至 500 字符） |
| `subscriptionCount` | 订阅数 |
| `episodeCount` | 总集数（站点统计） |
| `latestEpisodePubDate` | 最近一集发布日期 |
| `url` | 播客页链接 |
| `episodes` | 近期单集数组（最多 20 条，见下表） |

**`episodes[]` 每条字段**

| 字段 | 说明 |
|------|------|
| `eid` | 单集 ID，可用于 `xiaoyuzhoufm/episode` |
| `title` | 标题（来自 schema.org，可能为空） |
| `date` | 发布日期 `YYYY-MM-DD` |
| `description` | 简介预览（最多 200 字符） |
| `playCount` | 播放量 |
| `commentCount` | 评论数 |
| `favoriteCount` | 收藏数 |
| `shownotes` | Shownotes 纯文本预览（最多 2000 字符） |
| `links` | Shownotes 中的 HTTP 链接列表 |

**示例**

```json
{
  "pid": "626b46ea9cbbf0451cf5a962",
  "title": "某播客节目",
  "author": "主播名",
  "description": "...",
  "subscriptionCount": 120000,
  "episodeCount": 85,
  "latestEpisodePubDate": "2026-05-20T08:00:00.000Z",
  "url": "https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962",
  "episodes": [
    {
      "eid": "69ba2e32f8b8079bfaef73e5",
      "title": "第 42 期：话题标题",
      "date": "2026-05-18",
      "playCount": 45000,
      "commentCount": 128,
      "favoriteCount": 890,
      "shownotes": "...",
      "links": ["https://example.com/article"]
    }
  ]
}
```

> **限制：** 仅处理播客页 HTML 中能匹配到的单集 ID（正则 `episode/{24位hex}`），最多 enrich 前 20 集。更早的历史集需在小宇宙 App/Web 翻页后，用单集 URL 调用 `episode` 命令。

---

## xiaoyuzhoufm/episode — 单集详情

先请求首页拿到 Next.js `buildId`，再调用 `/_next/data/{buildId}/episode/{eid}.json` 获取完整单集对象。

```bash
bun-browser site xiaoyuzhoufm/episode <eid>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `eid` | ✅ | 单集 ID，来自 `/episode/{eid}` URL |

**返回字段**

| 字段 | 说明 |
|------|------|
| `eid` | 单集 ID |
| `title` | 单集标题 |
| `podcastTitle` | 所属播客名称 |
| `podcastPid` | 所属播客 ID |
| `playCount` | 播放量 |
| `commentCount` | 评论数 |
| `favoriteCount` | 收藏数 |
| `duration` | 时长（秒） |
| `durationMin` | 时长（分钟，四舍五入） |
| `pubDate` | 发布时间 |
| `guests` | 从 Shownotes 解析的嘉宾行（启发式，最多 5 条） |
| `links` | `{text, url}` 链接列表 |
| `shownotes` | Shownotes 纯文本（最多 3000 字符） |
| `url` | 单集页链接 |

**示例**

```json
{
  "eid": "69ba2e32f8b8079bfaef73e5",
  "title": "第 42 期：话题标题",
  "podcastTitle": "某播客节目",
  "podcastPid": "626b46ea9cbbf0451cf5a962",
  "playCount": 45000,
  "commentCount": 128,
  "favoriteCount": 890,
  "duration": 3720,
  "durationMin": 62,
  "pubDate": "2026-05-18T02:00:00.000Z",
  "guests": ["嘉宾 A", "嘉宾 B"],
  "links": [
    {"text": "相关文章", "url": "https://example.com/article"}
  ],
  "shownotes": "本期嘉宾：...\n时间线：...",
  "url": "https://www.xiaoyuzhoufm.com/episode/69ba2e32f8b8079bfaef73e5"
}
```

> **嘉宾字段：** 通过 Shownotes 中「嘉宾：」等常见格式启发式提取，非结构化节目可能为空或不准确。

---

## 常见问题

### `No __NEXT_DATA__ found` 或 `No podcast data`

播客页结构变更、网络异常，或返回了非预期 HTML（如验证码页）。

```bash
bun-browser open "https://www.xiaoyuzhoufm.com/podcast/<pid>" --tab current
# 确认页面正常显示后重试
bun-browser site xiaoyuzhoufm/podcast <pid>
```

### `Cannot find buildId`（episode）

首页无法解析 Next.js `buildId`，多为站点升级或访问被拦截。

```bash
bun-browser open https://www.xiaoyuzhoufm.com/ --tab current
bun-browser site xiaoyuzhoufm/episode <eid>
```

### `API HTTP 404` / `No episode data`

- 检查 `eid` 是否为 24 位十六进制、是否与 URL 一致
- `buildId` 会随站点部署变化；adapter 每次从首页实时读取，一般无需手动维护

### 部分单集 `playCount` 为 `null`（podcast 命令）

批量请求 `_next/data` 时个别请求失败或超时，该集仅保留 schema.org 中的标题/日期。对重要单集请单独运行 `xiaoyuzhoufm/episode`。

### 需要评论正文或音频

当前 adapter **只读**，不提供评论列表抓取或音频下载。评论数、播放量等为元数据；深度内容以 Shownotes 与 `links` 为主。

### HTTP 403 / 限流

小宇宙可能对高频请求限流。降低并发、间隔重试，或在浏览器中登录后再执行。

---

## 技术说明

- **数据源：** 播客页 SSR（`#__NEXT_DATA__`）+ Next.js Data Routes（`/_next/data/{buildId}/episode/{eid}.json`）。
- **只读：** 两个命令均为 `readOnly: true`，不会订阅、评论或播放。
- **无需登录：** 公开播客/单集元数据通常可直接访问；`credentials: 'include'` 用于与正常浏览一致的 session。
- **Private adapter：** 可将修改版放到 `~/.bun-browser/sites/xiaoyuzhoufm/`，同名文件会覆盖社区版。

---

## English summary

Two read-only CLI commands for **Xiaoyuzhou FM** (小宇宙) podcasts via bun-browser:

| Command | Purpose |
|---------|---------|
| `xiaoyuzhoufm/podcast <pid>` | Podcast profile + up to 20 recent episodes with play/comment/favorite counts and Shownotes preview |
| `xiaoyuzhoufm/episode <eid>` | Full episode metadata, Shownotes text, guest hints, and link list |

**IDs:** 24-char hex from URLs — `/podcast/{pid}`, `/episode/{eid}`.

**Prerequisites:** `bun-browser start`, open `https://www.xiaoyuzhoufm.com/`, run `bun-browser site update`.

**Typical flow:** `podcast <pid>` → pick `eid` from `episodes[]` → `episode <eid>` for full Shownotes and links.

**Per-command docs:** `bun-browser site info xiaoyuzhoufm/<command>`
