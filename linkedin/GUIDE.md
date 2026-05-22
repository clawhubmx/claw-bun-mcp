# LinkedIn 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里调用 LinkedIn 内部 API 与搜索页。无需 LinkedIn API Key、无需手动导出 Cookie。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. **必须登录 LinkedIn** — 两个 adapter 都依赖浏览器 session 中的 `JSESSIONID` cookie（用作 CSRF token）

```bash
bun-browser open https://www.linkedin.com/ --tab current
# 在 Chrome 中完成登录，确认首页能正常加载
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep linkedin   # 应看到 2 个命令
```

> 所有 adapter 在 `www.linkedin.com` 域下执行。若报错 `Not logged in` 或 `No JSESSIONID cookie`，说明当前浏览器未登录 LinkedIn，或 tab 不在 `linkedin.com`。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `linkedin/profile` | 用户 profile | 查姓名、头衔、地区、行业 |
| `linkedin/search` | 搜索帖子 | 话题监控、行业动态、关键词检索 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info linkedin/profile
bun-browser site info linkedin/search
```

## 推荐工作流

### 研究一个人（profile → 搜其相关帖子）

```bash
# 1. 从 URL linkedin.com/in/<username> 取 username
bun-browser site linkedin/profile williamhgates

# 2. 搜该人相关话题或行业关键词
bun-browser site linkedin/search "AI agent" --count 15
bun-browser site linkedin/search "Microsoft philanthropy" --count 10
```

### 行业话题监控

```bash
# 默认返回 10 条
bun-browser site linkedin/search "generative AI hiring"

# 最多 30 条
bun-browser site linkedin/search "remote work trends" --count 30
```

### 批量查多个 profile

```bash
for user in williamhgates satyanadella; do
  bun-browser site linkedin/profile "$user" --json --jq '{firstName, lastName, headline, profileUrl}'
done
```

---

## linkedin/profile — 用户 profile

通过 LinkedIn Voyager API 获取公开 profile 卡片信息。

```bash
bun-browser site linkedin/profile <username>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `username` | ✅ | URL 中的 vanity name：`https://www.linkedin.com/in/<username>` |

**示例**

```bash
bun-browser site linkedin/profile williamhgates
bun-browser site linkedin/profile satyanadella
```

**如何取 username**

| URL | username |
|-----|----------|
| `https://www.linkedin.com/in/williamhgates/` | `williamhgates` |
| `https://www.linkedin.com/in/satyanadella` | `satyanadella` |

> 只传 path 最后一段，**不要**带 `/in/` 前缀或完整 URL。

**返回示例**

```json
{
  "firstName": "Bill",
  "lastName": "Gates",
  "headline": "Co-chair, Bill & Melinda Gates Foundation",
  "location": "Seattle, Washington, United States",
  "industry": "Philanthropy",
  "profileUrl": "https://www.linkedin.com/in/williamhgates"
}
```

| 字段 | 说明 |
|------|------|
| `firstName` / `lastName` | 名 / 姓（优先英文 locale） |
| `headline` | 职业头衔 / 简介一行 |
| `location` | 地区 |
| `industry` | 行业（可能为空） |
| `profileUrl` | 个人主页链接 |

> 当前 adapter 只返回 profile 卡片核心字段，不含工作经历、教育、技能等完整履历。需要详情请在浏览器打开 `profileUrl`。

---

## linkedin/search — 搜索帖子

搜索 LinkedIn **内容（Posts）** 结果。adapter 通过 `fetch` 拉取搜索页 HTML，解析 React Server Components (RSC) payload 提取作者、链接与正文。

```bash
bun-browser site linkedin/search "<query>" [--count N]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词 |
| `--count` | ❌ | `10` | 最多返回条数，上限 **30** |

**示例**

```bash
bun-browser site linkedin/search "AI agent"
bun-browser site linkedin/search "product management" --count 20
bun-browser site linkedin/search "\"large language model\"" --count 15
```

**返回示例**

```json
{
  "query": "AI agent",
  "count": 10,
  "posts": [
    {
      "author": "Jane Doe",
      "url": "https://www.linkedin.com/posts/janedoe_activity-7123456789012345678-abcd",
      "text": "Excited to share our latest work on AI agents...\n\nKey takeaways:\n1. ..."
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `query` | 本次搜索关键词 |
| `count` | 实际返回帖子数 |
| `posts[].author` | 发帖人显示名 |
| `posts[].url` | 帖子 permalink（`postSlugUrl`） |
| `posts[].text` | 正文，**最多 800 字符** |

**限制与说明**

- **只搜帖子内容**，不搜人、公司或职位（LinkedIn 网页搜索有多种 tab，adapter 固定走 `/search/results/content/`）。
- **纯图片帖**可能无法提取正文，此时 `text` 为 `(text extraction failed)`，但仍有 `author` 和 `url`。
- 作者与正文按 HTML 文档顺序配对；若 LinkedIn 改版 RSC 格式，可能出现配对错位或 `No posts found`。
- 此命令声明 `capabilities: ["network"]`，会发起网络请求；其余 profile 命令同样走 fetch，但无额外 capability 标记。

---

## 用 jq 过滤 JSON

安装 [jq](https://jqlang.org/) 后可用 `--json --jq`：

```bash
# profile：只要姓名和头衔
bun-browser site linkedin/profile williamhgates --json --jq '{firstName, lastName, headline}'

# 搜索：只要作者、链接、正文前 120 字
bun-browser site linkedin/search "startup funding" --count 5 --json --jq '.posts[] | {author, url, preview: .text[:120]}'

# 列出所有帖子 URL
bun-browser site linkedin/search "machine learning" --json --jq '.posts[].url'
```

---

## 常见问题

### `Not logged in` / `No JSESSIONID cookie`

浏览器未登录 LinkedIn，或当前 tab 不在 `linkedin.com`。

```bash
bun-browser open https://www.linkedin.com/ --tab current
# 在 Chrome 中登录后重试
```

### `HTTP 404` / `Profile not found`（profile）

- 确认 username 拼写正确（URL 中 `/in/` 后面那一段）
- 账号可能已改名、设为私密或不存在
- 不要传完整 URL，只传 username：`williamhgates` 而非 `https://www.linkedin.com/in/williamhgates`

### `HTTP 403` / `HTTP 401`

- Session 过期 → 重新登录 LinkedIn
- 账号被限流 → 降低调用频率，间隔几秒再试
- LinkedIn 风控 → 在浏览器中正常浏览几分钟后再试

### `No posts found`

- 关键词确实无结果
- 未登录或 session 无效
- LinkedIn 搜索页 HTML / RSC 格式变更，导致解析失败（adapter 需更新）

若错误信息含 `Fetched N bytes but could not extract posts`，说明页面已返回但解析逻辑未匹配当前格式。

### 正文显示 `(text extraction failed)`

该帖可能是纯图片、视频或 carousel，RSC payload 中没有可解析的文本块。可打开返回的 `url` 在浏览器查看完整内容。

### 正文被截断

`linkedin/search` 有意将 `text` 限制在 **800 字符**。需要全文请打开 `url`。

### 能搜到人或公司吗？

当前只有 `linkedin/search`（内容搜索）和 `linkedin/profile`（已知 username 的 profile）。搜人、搜公司、搜职位需用 LinkedIn 网页或未来扩展 adapter。

### 需要登录吗？

**是的。** 两个命令都需要已登录的 LinkedIn session（`JSESSIONID` cookie）。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/linkedin/`，同名文件会覆盖社区版（例如增强 search 解析、扩展 profile 字段）。

---

## 技术说明

- **无需 LinkedIn API Key** — `profile` 使用 Voyager REST API（`/voyager/api/identity/dash/profiles`）；`search` 拉取与网页相同的搜索页 HTML。
- **只读** — 两个命令均为 `readOnly: true`，不会发帖、点赞、连接或改 profile。
- **CSRF** — 从 `JSESSIONID` cookie 提取 token，请求头带 `csrf-token` 与 `x-restli-protocol-version: 2.0.0`（profile）。
- **search 解析** — 针对 LinkedIn RSC payload 中的 `\"actorName\"`、`\"postSlugUrl\"`、`\"textProps\"` 等字段做正则提取；LinkedIn 前端改版时可能需更新 adapter。
- **速率** — 批量调用时建议串行执行，避免触发 LinkedIn 限流。

---

## English summary

Two read-only CLI commands for LinkedIn via bun-browser (logged-in Chrome, no API key):

| Command | Purpose |
|---------|---------|
| `linkedin/profile <username>` | User profile card (name, headline, location, industry) |
| `linkedin/search "<query>"` | Search **posts** by keyword (max 30, text truncated to 800 chars) |

**Prerequisites:** `bun-browser start`, log in at `https://www.linkedin.com/`, run `bun-browser site update`.

**Username:** from `https://www.linkedin.com/in/<username>` — pass only the last segment, not the full URL.

**Typical flow:** `linkedin/profile` → `linkedin/search` for related topics; or monitor keywords with `linkedin/search`.

**Login required** for both commands (`JSESSIONID` cookie as CSRF).

**Per-command docs:** `bun-browser site info linkedin/<command>`
