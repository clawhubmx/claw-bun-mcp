# 雪球 (Xueqiu) 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在已登录的 Chrome 里调用雪球官方 API，查询 **A 股 / 港股 / 美股行情**、**热门动态**、**自选股** 与 **关注时间线**。无需 API Key、无需抓 Cookie。

[English summary](#english-summary) · 中文正文

---

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开雪球并登录（行情类命令通常只需打开站点；自选股与时间线 **必须登录**）

```bash
bun-browser open https://xueqiu.com/ --tab current
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep xueqiu   # 应看到 6 个命令
```

> 所有 adapter 在 `xueqiu.com` 域下执行，通过 `fetch(..., {credentials: 'include'})` 复用浏览器 session。若返回 `HTTP 401/403` 或 hint 提示未登录，请先在 Chrome 中登录雪球后重试。

> 若你使用旧版 CLI 名称，将下文中的 `bun-browser` 替换为 `bb-browser` 即可，命令参数相同。

---

## 命令一览

| 命令 | 说明 | 登录 |
|------|------|------|
| `xueqiu/stock` | 股票实时行情 (stock quote: price, change%, market cap, volume) | 建议 |
| `xueqiu/search` | 搜索股票 (stock search: symbol, name, price, change%) | 建议 |
| `xueqiu/hot-stock` | 热门股票榜 (hot stocks: rank, symbol, heat, change%) | 建议 |
| `xueqiu/hot` | 热门动态 (hot posts: author, text, likes, url) | 建议 |
| `xueqiu/watchlist` | 自选股 / 持仓 / 关注列表 (watchlist: symbol, price, change%) | **必须** |
| `xueqiu/feed` | 首页时间线 (home feed: followed users' posts) | **必须** |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info xueqiu/stock
bun-browser site info xueqiu/search
bun-browser site info xueqiu/hot-stock
bun-browser site info xueqiu/hot
bun-browser site info xueqiu/watchlist
bun-browser site info xueqiu/feed
```

---

## 推荐工作流

### 从名称到行情

```bash
# 1. 按中文名或关键词搜索
bun-browser site xueqiu/search 茅台

# 2. 用返回的 symbol 查完整行情
bun-browser site xueqiu/stock SH600519
```

### 每日扫盘

```bash
# 人气榜前 10
bun-browser site xueqiu/hot-stock 10

# 关注榜
bun-browser site xueqiu/hot-stock 10 12

# 自选股一览
bun-browser site xueqiu/watchlist

# 持仓
bun-browser site xueqiu/watchlist 2
```

### 从热榜到社区讨论

```bash
# 1. 热门股票
bun-browser site xueqiu/hot-stock 5

# 2. 全站热门动态
bun-browser site xueqiu/hot 10

# 3. 关注的人发了什么
bun-browser site xueqiu/feed
```

### 批量对比自选股（配合 jq）

```bash
bun-browser site xueqiu/watchlist --json --jq '.items[] | {name, symbol, price, changePercent, url}'
```

---

## `xueqiu/stock` — 股票实时行情

调用 `GET stock.xueqiu.com/v5/stock/batch/quote.json`，按 **雪球 symbol** 查询实时行情。支持 A 股、港股、美股。

```bash
bun-browser site xueqiu/stock <symbol>
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `symbol` | ✅ | 股票代码，如 `SH600519`、`SZ000858`、`AAPL`、`00700` |

代码会自动转为大写。A 股需带交易所前缀：`SH`（沪）、`SZ`（深）、`BJ`（北）。

### 示例

```bash
# A 股
bun-browser site xueqiu/stock SH600519    # 贵州茅台
bun-browser site xueqiu/stock SZ000858    # 五粮液

# 美股
bun-browser site xueqiu/stock AAPL
bun-browser site xueqiu/stock TSLA

# 港股
bun-browser site xueqiu/stock 00700       # 腾讯控股
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `name` | 股票名称 |
| `symbol` | 雪球 symbol |
| `exchange` | 交易所 |
| `currency` | 计价货币 |
| `price` | 最新价 |
| `change` | 涨跌额 |
| `changePercent` | 涨跌幅，如 `1.55%` |
| `open` / `high` / `low` / `prevClose` | 开、高、低、昨收 |
| `amplitude` | 振幅，如 `3.20%` |
| `volume` | 成交量 |
| `amount` | 成交额（已格式化：`万` / `亿` / `万亿`） |
| `turnover_rate` | 换手率，如 `0.85%` |
| `marketCap` | 总市值 |
| `floatMarketCap` | 流通市值 |
| `ytdPercent` | 年初至今涨跌幅 |
| `market_status` | 市场状态 |
| `time` | 行情时间（ISO 8601） |
| `url` | 雪球个股页链接 |

### 常见错误

| `error` | 含义 | 建议 |
|---------|------|------|
| `Missing argument: symbol` | 未传代码 | 补上 symbol，如 `SH600519` |
| `未找到股票: …` | 代码无效或不存在 | 先用 `xueqiu/search` 确认 symbol |
| `HTTP 401` / `Not logged in?` | session 失效 | 打开 xueqiu.com 并登录后重试 |

---

## `xueqiu/search` — 搜索股票

调用 `GET xueqiu.com/stock/search.json`，按 **代码或名称** 搜索股票。

```bash
bun-browser site xueqiu/search <query> [count]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `query` | ✅ | — | 搜索关键词，如 `茅台`、`AAPL`、`腾讯` |
| `count` | ❌ | `10` | 返回条数，上限 **20** |

### 示例

```bash
bun-browser site xueqiu/search 茅台
bun-browser site xueqiu/search AAPL 5
bun-browser site xueqiu/search 腾讯 --json --jq '.results[] | {symbol, name, price, changePercent, url}'
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `keyword` | 搜索词 |
| `count` | 结果条数 |
| `results[]` | 结果列表 |
| `results[].symbol` | 雪球 symbol（A 股已含 `SH`/`SZ`/`BJ` 前缀） |
| `results[].name` | 名称 |
| `results[].exchange` | 交易所 |
| `results[].price` | 最新价 |
| `results[].changePercent` | 涨跌幅 |
| `results[].url` | 个股页链接 |

---

## `xueqiu/hot-stock` — 热门股票榜

调用 `GET stock.xueqiu.com/v5/stock/hot_stock/list.json`，返回雪球 **人气榜** 或 **关注榜**。

```bash
bun-browser site xueqiu/hot-stock [count] [type]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `20` | 返回条数，上限 **50** |
| `type` | ❌ | `10` | 榜单类型：`10` = 人气榜，`12` = 关注榜 |

### 示例

```bash
bun-browser site xueqiu/hot-stock
bun-browser site xueqiu/hot-stock 10
bun-browser site xueqiu/hot-stock 20 12    # 关注榜
bun-browser site xueqiu/hot-stock 5 --json --jq '.items[] | {rank, name, symbol, changePercent, heat}'
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `type` | 榜单名称：`人气榜` 或 `关注榜` |
| `count` | 实际条数 |
| `items[]` | 榜单条目 |
| `items[].rank` | 排名 |
| `items[].symbol` | symbol |
| `items[].name` | 名称 |
| `items[].price` | 最新价 |
| `items[].changePercent` | 涨跌幅 |
| `items[].heat` | 热度值 |
| `items[].rank_change` | 排名变化 |
| `items[].url` | 个股页链接 |

---

## `xueqiu/hot` — 热门动态

调用 `GET xueqiu.com/statuses/hot/listV3.json`，返回全站 **热门帖子**（类似雪球 App 热门流）。

```bash
bun-browser site xueqiu/hot [count]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `20` | 返回条数，上限 **50** |

### 示例

```bash
bun-browser site xueqiu/hot
bun-browser site xueqiu/hot 10
bun-browser site xueqiu/hot 15 --json --jq '.items[] | {rank, author, text, likes, url}'
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `count` | 实际条数 |
| `items[]` | 动态列表 |
| `items[].rank` | 排名 |
| `items[].id` | 帖子 ID |
| `items[].text` | 正文摘要（纯文本，**最多 200 字符**） |
| `items[].url` | 帖子链接 |
| `items[].author` | 作者昵称 |
| `items[].author_id` | 作者 ID |
| `items[].likes` | 点赞数 |
| `items[].retweets` | 转发数 |
| `items[].replies` | 评论数 |
| `items[].created_at` | 发布时间（ISO 8601） |

---

## `xueqiu/watchlist` — 自选股 / 持仓 / 关注

调用 `GET stock.xueqiu.com/v5/stock/portfolio/stock/list.json`，读取当前账号的 **自选**、**持仓** 或 **关注** 列表。**必须登录**。

```bash
bun-browser site xueqiu/watchlist [category]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `category` | ❌ | `1` | `1` = 自选股，`2` = 持仓，`3` = 关注 |

### 示例

```bash
bun-browser site xueqiu/watchlist           # 自选股
bun-browser site xueqiu/watchlist 2         # 持仓
bun-browser site xueqiu/watchlist 3         # 关注
bun-browser site xueqiu/watchlist --json --jq '.items[] | {name, price, changePercent}'
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `category` | 分类名称：`自选股` / `持仓` / `关注` |
| `count` | 股票数量 |
| `items[]` | 列表 |
| `items[].symbol` | symbol |
| `items[].name` | 名称 |
| `items[].price` | 最新价 |
| `items[].change` | 涨跌额 |
| `items[].changePercent` | 涨跌幅 |
| `items[].volume` | 成交量 |
| `items[].url` | 个股页链接 |

---

## `xueqiu/feed` — 首页时间线

调用 `GET xueqiu.com/v4/statuses/home_timeline.json`，返回 **关注用户** 发布的动态。**必须登录**。

```bash
bun-browser site xueqiu/feed [page] [count]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `page` | ❌ | `1` | 页码 |
| `count` | ❌ | `20` | 每页条数，上限 **50** |

### 示例

```bash
bun-browser site xueqiu/feed
bun-browser site xueqiu/feed 1 10
bun-browser site xueqiu/feed 2 20          # 第 2 页
bun-browser site xueqiu/feed --json --jq '.items[] | {author, text, likes, url}'
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `page` | 当前页码 |
| `count` | 本页条数 |
| `items[]` | 动态列表 |
| `items[].id` | 帖子 ID |
| `items[].text` | 正文摘要（纯文本，**最多 200 字符**） |
| `items[].url` | 帖子链接 |
| `items[].author` | 作者昵称 |
| `items[].author_id` | 作者 ID |
| `items[].verified` | 认证说明（如有） |
| `items[].likes` / `retweets` / `replies` | 互动数 |
| `items[].created_at` | 发布时间（ISO 8601） |

---

## 股票代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 沪 A | `SH` + 6 位代码 | `SH600519` |
| 深 A | `SZ` + 6 位代码 | `SZ000858` |
| 北交所 | `BJ` + 代码 | `BJ430047` |
| 美股 | ticker | `AAPL`、`TSLA` |
| 港股 | 5 位代码 | `00700` |

不确定 symbol 时，先用 `xueqiu/search`：

```bash
bun-browser site xueqiu/search 贵州茅台
# 从 results[].symbol 取 SH600519，再查详情
bun-browser site xueqiu/stock SH600519
```

---

## 与其他财经适配器对比

| 场景 | 推荐命令 | 原因 |
|------|----------|------|
| A 股中文名 / 6 位代码 | `eastmoney/stock` | 直接支持「贵州茅台」「600519」 |
| A 股 / 港美 + 社区热度 | `xueqiu/*` | 行情 + 热榜 + 讨论，symbol 体系统一 |
| 全球 ticker（Yahoo 格式） | `yahoo-finance/quote` | 无需登录，支持 `0700.HK`、`^GSPC` |
| 自选股 / 关注流 | `xueqiu/watchlist`、`xueqiu/feed` | 仅雪球支持，需登录 |

```bash
# A 股：东方财富（中文名）
bun-browser site eastmoney/stock 贵州茅台

# 同一标的：雪球（完整 symbol + 社区链接）
bun-browser site xueqiu/stock SH600519

# 美股：Yahoo（无需登录）
bun-browser site yahoo-finance/quote AAPL
```

---

## 用 jq 过滤 JSON

```bash
# 自选股涨跌一览
bun-browser site xueqiu/watchlist --json --jq '.items[] | {name, changePercent, url}'

# 人气榜前 5
bun-browser site xueqiu/hot-stock 5 --json --jq '.items[] | {rank, name, heat, changePercent}'

# 热门讨论作者与摘要
bun-browser site xueqiu/hot 10 --json --jq '.items[] | {author, text, likes, url}'
```

---

## 常见问题

### `HTTP 401` / `Not logged in?` / `获取失败，可能未登录`

当前浏览器 session 未登录雪球，或 Cookie 已过期。

```bash
bun-browser open https://xueqiu.com/ --tab current
# 在 Chrome 中完成登录后重试
bun-browser site xueqiu/watchlist
```

`watchlist` 与 `feed` 必须登录；行情与热榜在多数情况下打开 xueqiu.com 即可，但登录后更稳定。

### `未找到股票: …`

- 确认 symbol 格式：A 股需 `SH`/`SZ`/`BJ` 前缀
- 用 `xueqiu/search` 先解析正确 symbol

### 自选股为空

- 确认已在雪球 Web/App 中添加自选股
- `category` 参数：`1` 自选、`2` 持仓、`3` 关注，不要传错

### 帖子正文被截断

`hot` 与 `feed` 将每条正文限制在 **200 字符**，便于 Agent 上下文控制。需要全文请在浏览器打开返回的 `url`。

### 请求过于频繁

批量查多只标的或连续翻页时建议**串行**执行，间隔 1–2 秒，避免触发限流。

---

## Agent / MCP 使用提示

- 查价任务关键词：`stock quote`、`price`、`changePercent`、`marketCap`。
- 搜股任务关键词：`stock search`、`symbol`、`name`。
- 社区任务关键词：`hot posts`、`feed`、`watchlist`、`likes`。
- 输入 A 股时优先 `search` 解析 symbol，再 `stock` 拉详情。
- 输出为 JSON，适合 `--json` 或 MCP 工具链解析。

```bash
# Agent 函数签名
bun-browser site info xueqiu/stock
bun-browser site info xueqiu/search
```

---

## 技术说明

- **无需雪球开放平台 API** — adapter 直接调用 xueqiu.com 网页端同款 JSON API，与已登录浏览器 session 一致。
- **只读** — 六个命令均为 `readOnly: true`，不会发帖、下单、改自选或修改账号。
- **HTML 清理** — `hot` 与 `feed` 会 strip HTML 标签与常见实体，输出纯文本。
- **大数格式化** — `stock` 的 `amount`、`marketCap` 等格式化为 `万` / `亿` / `万亿`。
- **Private adapter** — 可将修改版放到 `~/.bun-browser/sites/xueqiu/`，同名文件会覆盖社区版。

适配器源码：

| 文件 | 命令 |
|------|------|
| `stock.js` | `xueqiu/stock` |
| `search.js` | `xueqiu/search` |
| `hot-stock.js` | `xueqiu/hot-stock` |
| `hot.js` | `xueqiu/hot` |
| `watchlist.js` | `xueqiu/watchlist` |
| `feed.js` | `xueqiu/feed` |

---

## 相关链接

- [bb-sites 总览](../README.md)
- [东方财富 A 股适配器](../eastmoney/README.md)
- [Yahoo Finance 全球行情](../yahoo-finance/GUIDE.md)
- [雪球官网](https://xueqiu.com/)

---

## English summary

Six read-only CLI commands for Xueqiu (雪球) via bun-browser — logged-in Chrome, no API key:

| Command | Purpose |
|---------|---------|
| `xueqiu/stock <symbol>` | Real-time quote (A-shares, HK, US); symbols like `SH600519`, `AAPL`, `00700` |
| `xueqiu/search <query> [count]` | Search stocks by name or ticker (max 20) |
| `xueqiu/hot-stock [count] [type]` | Hot stock rankings: `10` = popularity (default), `12` = watchlist growth (max 50) |
| `xueqiu/hot [count]` | Site-wide hot posts (max 50) |
| `xueqiu/watchlist [category]` | Portfolio lists: `1` watchlist, `2` holdings, `3` following — **login required** |
| `xueqiu/feed [page] [count]` | Home timeline from followed users — **login required** |

**Prerequisites:** `bun-browser start`, open and log in at `https://xueqiu.com/`, run `bun-browser site update`.

**Typical flow:** `search 茅台` → `stock SH600519`; or `hot-stock` → `hot` for market + community pulse; `watchlist` for personal portfolio.

**vs other finance adapters:** `eastmoney/stock` accepts Chinese names / 6-digit codes without login; `yahoo-finance/quote` covers global tickers without login; Xueqiu adds **hot rankings, social feed, and personal watchlist**.

**Per-command docs:** `bun-browser site info xueqiu/<command>`
