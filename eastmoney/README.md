# 东方财富 (Eastmoney)

基于 [bun-browser](https://github.com/epiral/bun-browser) 的东方财富网数据采集适配器，覆盖 **A 股实时行情** 与 **财经热点新闻**。

两个命令均调用东方财富公开 API，**无需登录**，也无需事先打开东方财富网页。

---

## 安装与更新

```bash
bun-browser site update          # 安装/更新社区 site 适配器
bun-browser site list | grep eastmoney
bun-browser site info eastmoney/stock
bun-browser site info eastmoney/news
```

适配器源码位于本目录：

- `stock.js` — `eastmoney/stock`
- `news.js` — `eastmoney/news`

---

## 命令一览

| 命令 | 说明 | 登录 |
|------|------|------|
| `eastmoney/stock` | A 股实时行情 (stock quote: price, change%, volume, market cap, PE/PB) | 否 |
| `eastmoney/news` | 财经热点新闻 (financial news: title, summary, source, time, url) | 否 |

---

## `eastmoney/stock` — 股票实时行情

按 **股票名称** 或 **6 位代码** 查询实时行情。内部先调用搜索 API 解析 `secid`，再拉取 push 行情接口。

```bash
bun-browser site eastmoney/stock <query>
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `query` | ✅ | 股票名称或代码，如 `贵州茅台`、`600519`、`平安银行` |

### 示例

```bash
# 按名称
bun-browser site eastmoney/stock 贵州茅台

# 按代码
bun-browser site eastmoney/stock 600519

# 其他标的
bun-browser site eastmoney/stock 宁德时代
bun-browser site eastmoney/stock 000001
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `name` | 股票名称 |
| `code` | 6 位代码 |
| `secid` | 行情 ID，如 `1.600519`（沪）或 `0.000001`（深） |
| `market` | 市场类型，如 `沪A`、`深A` |
| `price` | 最新价（元） |
| `change` | 涨跌额（元） |
| `changePercent` | 涨跌幅，如 `1.55%` |
| `open` / `high` / `low` / `prevClose` | 开、高、低、昨收（元） |
| `amplitude` | 振幅，如 `3.20%` |
| `volume` | 成交量，带单位，如 `12345手` |
| `amount` | 成交额，大数已格式化，如 `12.34亿` |
| `marketCap` | 总市值 |
| `floatMarketCap` | 流通市值 |
| `pe` | 市盈率（动） |
| `pb` | 市净率 |
| `url` | 东方财富行情页链接 |
| `otherMatches` | 搜索有多条匹配时，其余候选（`code`、`name`、`type`） |

### 常见错误

| `error` | 含义 | 建议 |
|---------|------|------|
| `Missing argument: query` | 未传查询词 | 补上名称或代码 |
| `未找到股票: …` | 搜索无结果 | 检查拼写，或换用 6 位代码 |
| `搜索失败: HTTP …` / `行情获取失败: HTTP …` | 网络或接口异常 | 稍后重试；检查本机能否访问 `eastmoney.com` |

搜索返回多条时，适配器 **默认使用第一条**；其余结果在 `otherMatches` 中列出，便于人工确认是否选对标的。

---

## `eastmoney/news` — 财经热点新闻

拉取东方财富 **财经要闻** 栏目（`column=350`）最新列表。

```bash
bun-browser site eastmoney/news
bun-browser site eastmoney/news --count 10
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `count` | ❌ | `20` | 返回条数，最大 `50` |

### 示例

```bash
# 默认 20 条
bun-browser site eastmoney/news

# 指定条数
bun-browser site eastmoney/news --count 5
bun-browser site eastmoney/news --count 50
```

### 返回字段

| 字段 | 说明 |
|------|------|
| `count` | 实际返回条数 |
| `fetchTime` | 抓取时间（ISO 8601） |
| `news[].rank` | 序号 |
| `news[].title` | 标题 |
| `news[].summary` | 摘要（最长约 200 字） |
| `news[].source` | 媒体来源 |
| `news[].time` | 展示时间 |
| `news[].url` | 原文链接 |

### 常见错误

| `error` | 含义 | 建议 |
|---------|------|------|
| `新闻获取失败: HTTP …` | 请求失败 | 检查网络后重试 |
| `接口返回错误: …` | API 业务错误 | 稍后重试 |
| `暂无新闻数据` | 列表为空 | 稍后重试 |

---

## Agent / MCP 使用提示

- 查价任务用 `eastmoney/stock`，关键词：`stock quote`、`price`、`changePercent`。
- 读资讯用 `eastmoney/news`，关键词：`financial news`、`title`、`url`。
- 输出为 JSON，适合 `--json` 或 MCP 工具链解析。
- 与 `yahoo-finance/quote` 不同：本适配器面向 **A 股**，支持中文名称与 6 位代码。

典型组合：

```bash
# 先看大盘相关新闻，再查个股
bun-browser site eastmoney/news --count 10
bun-browser site eastmoney/stock 贵州茅台
```

---

## 技术说明

| 命令 | 主要 API |
|------|----------|
| `stock` | `searchapi.eastmoney.com`（联想搜索）→ `push2.eastmoney.com`（实时行情） |
| `news` | `np-listapi.eastmoney.com`（栏目新闻） |

- `stock` 的 `domain` 为 `quote.eastmoney.com`；`news` 为 `www.eastmoney.com`。
- 价格字段在接口中以「分」存储，适配器已换算为「元」。
- 成交额、市值等大数会格式化为 `万` / `亿` / `万亿`。

---

## 故障排查

1. **确认适配器已安装**  
   `bun-browser site info eastmoney/stock` 应显示 `@meta` 中的 `args` 与 `example`。

2. **确认 daemon 与浏览器**  
   ```bash
   bun-browser status
   bun-browser start    # 如未运行
   ```

3. **JSON 调试**  
   ```bash
   bun-browser site eastmoney/stock 600519 --json
   bun-browser site eastmoney/news --count 3 --json
   ```

4. **私有覆盖**  
   可将自定义脚本放到 `~/.bun-browser/sites/eastmoney/`，同名命令会覆盖社区版本。

---

## 相关链接

- [bb-sites 总览](../README.md)
- [东方财富行情](https://quote.eastmoney.com/)
- [东方财富首页](https://www.eastmoney.com/)
