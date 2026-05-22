# Yahoo Finance 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里查询 **全球股票实时行情**（美股、港股、指数、ETF 等）。调用 Yahoo Finance 公开接口，**无需登录**，也无需 API Key。

[English summary](#english-summary) · 中文正文

---

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep yahoo-finance   # 应看到 1 个命令
bun-browser site info yahoo-finance/quote
```

> adapter 在 `finance.yahoo.com` 域下执行。若当前没有对应标签页，bun-browser 会自动打开 Yahoo Finance。**不需要登录 Yahoo 账号。**

> 若你使用旧版 CLI 名称，将下文中的 `bun-browser` 替换为 `bb-browser` 即可，命令参数相同。

---

## 命令一览

| 命令 | 说明 | 登录 |
|------|------|------|
| `yahoo-finance/quote` | 股票实时行情 (stock quote: price, change%, volume, market cap, PE) | 否 |

适配器源码：`quote.js`

---

## 推荐工作流

### 查单只股票

```bash
bun-browser site yahoo-finance/quote AAPL
bun-browser site yahoo-finance/quote TSLA
bun-browser site yahoo-finance/quote MSFT
```

### 批量对比（配合 jq）

```bash
for sym in AAPL MSFT GOOGL NVDA; do
  bun-browser site yahoo-finance/quote "$sym" --json --jq '{symbol, price, changePercent, marketCap}'
done
```

### 与 A 股适配器配合

Yahoo Finance 适合 **美股 / 港股 / 全球 ticker**；查 A 股中文名称请用 `eastmoney/stock`：

```bash
# 美股
bun-browser site yahoo-finance/quote AAPL

# A 股（中文名或 6 位代码）
bun-browser site eastmoney/stock 贵州茅台
```

---

## `yahoo-finance/quote` — 股票实时行情

按 **股票代码（ticker symbol）** 查询实时行情。符号会自动转为大写（`aapl` → `AAPL`）。

```bash
bun-browser site yahoo-finance/quote <symbol>
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `symbol` | ✅ | 股票代码，如 `AAPL`、`TSLA`、`0700.HK`、`^GSPC` |

### 示例

```bash
# 美股
bun-browser site yahoo-finance/quote AAPL
bun-browser site yahoo-finance/quote NVDA

# 港股（带交易所后缀）
bun-browser site yahoo-finance/quote 0700.HK

# 指数
bun-browser site yahoo-finance/quote ^GSPC    # S&P 500
bun-browser site yahoo-finance/quote ^IXIC    # Nasdaq

# ETF
bun-browser site yahoo-finance/quote SPY
bun-browser site yahoo-finance/quote QQQ
```

### 返回字段

适配器按 **三层 fallback** 获取数据，字段完整度取决于命中的数据源（见 [技术说明](#技术说明)）。

#### 完整字段（v7 Quote API 成功时）

| 字段 | 说明 |
|------|------|
| `symbol` | 股票代码 |
| `name` | 简称或全称 |
| `price` | 最新价 |
| `change` | 涨跌额 |
| `changePercent` | 涨跌幅，如 `1.55%` |
| `open` / `high` / `low` / `prevClose` | 开、高、低、昨收 |
| `volume` | 成交量 |
| `marketCap` | 市值（格式化：`T` / `B` / `M` / `K`） |
| `pe` | 市盈率（TTM） |
| `eps` | 每股收益（TTM） |
| `week52High` / `week52Low` | 52 周高 / 低 |
| `avgVolume` | 3 个月日均成交量 |
| `currency` | 计价货币，如 `USD`、`HKD` |
| `exchange` | 交易所名称 |
| `marketState` | 市场状态，如 `REGULAR`、`PRE`、`POST`、`CLOSED` |
| `quoteType` | 标的类型，如 `EQUITY`、`ETF`、`INDEX` |
| `url` | Yahoo Finance 行情页链接 |

#### 精简字段（v8 Chart API 或页面抓取 fallback）

仍包含 `symbol`、`name`、`price`、`change`、`changePercent`、`url` 等核心字段；部分估值字段可能缺失。

| 额外字段 | 说明 |
|----------|------|
| `source` | `chart-api` 或 `page-scrape`，表示非 v7 数据源 |

**返回示例（v7）**

```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "price": 198.45,
  "change": "2.31",
  "changePercent": "1.18%",
  "open": 196.2,
  "high": 199.1,
  "low": 195.8,
  "prevClose": 196.14,
  "volume": 52341234,
  "marketCap": "3.05T",
  "pe": "32.15",
  "eps": "6.42",
  "week52High": 220.5,
  "week52Low": 164.08,
  "avgVolume": 58123456,
  "currency": "USD",
  "exchange": "NasdaqGS",
  "marketState": "REGULAR",
  "quoteType": "EQUITY",
  "url": "https://finance.yahoo.com/quote/AAPL/"
}
```

### 常见错误

| `error` | 含义 | 建议 |
|---------|------|------|
| `Missing argument: symbol` | 未传股票代码 | 补上 ticker，如 `AAPL` |
| `Could not parse quote data from page` | 页面结构变化，解析失败 | 确认代码有效；稍后重试 |
| `Failed to fetch quote for …` | 三层数据源均失败 | 检查代码拼写；确认网络可访问 `finance.yahoo.com` |

错误对象可能附带 `hint` 字段，Agent 应原样转达给用户。

---

## Agent / MCP 使用提示

- 查价任务关键词：`stock quote`、`price`、`changePercent`、`marketCap`。
- 输入为 **ticker symbol**，不是公司中文名（查「苹果」应传 `AAPL`，不是「苹果」）。
- 输出为 JSON，适合 `--json` 或 MCP 工具链解析。
- 与 `eastmoney/stock` 互补：Yahoo 偏 **全球市场**；东方财富偏 **A 股中文名 / 6 位代码**。

```bash
# Agent 函数签名
bun-browser site info yahoo-finance/quote
```

---

## 用 jq 过滤 JSON

```bash
# 只看价格与涨跌幅
bun-browser site yahoo-finance/quote AAPL --json --jq '{symbol, name, price, changePercent, url}'

# 对比多只标的
bun-browser site yahoo-finance/quote MSFT --json --jq '{price, pe, marketCap}'
```

---

## 技术说明

适配器按顺序尝试三种数据源，任一成功即返回：

| 优先级 | 数据源 | 说明 |
|--------|--------|------|
| 1 | v7 Quote API | `query1.finance.yahoo.com/v7/finance/quote` — 字段最全 |
| 2 | v8 Chart API | `query1.finance.yahoo.com/v8/finance/chart/{symbol}` — 返回 `source: "chart-api"` |
| 3 | 页面抓取 | 拉取 `finance.yahoo.com/quote/{symbol}/` HTML，解析内嵌 JSON 或 DOM — 返回 `source: "page-scrape"` |

- `domain` 为 `finance.yahoo.com`；请求在浏览器上下文中发起，可绕过部分直连 CORS 限制。
- `readOnly: true` — 只读查询，不会下单或修改账户。
- 市值等大数格式化为 `T`（万亿）、`B`（十亿）、`M`（百万）、`K`（千）。

---

## 故障排查

1. **确认适配器已安装**

   ```bash
   bun-browser site info yahoo-finance/quote
   ```

   应显示 `@meta` 中的 `args.symbol` 与 `example`。

2. **确认 daemon 与浏览器**

   ```bash
   bun-browser status
   bun-browser start
   ```

3. **JSON 调试**

   ```bash
   bun-browser site yahoo-finance/quote AAPL --json
   ```

4. **代码格式**

   - 美股：1–5 位字母，如 `AAPL`、`BRK.B`
   - 港股：代码 + `.HK`，如 `0700.HK`、`9988.HK`
   - 指数：以 `^` 开头，如 `^GSPC`、`^DJI`
   - 若不确定 symbol，先在 [Yahoo Finance](https://finance.yahoo.com/) 搜索确认

5. **私有覆盖**

   可将自定义脚本放到 `~/.bun-browser/sites/yahoo-finance/`，同名命令会覆盖社区版本。

---

## 相关链接

- [bb-sites 总览](../README.md)
- [东方财富 A 股适配器](../eastmoney/README.md)
- [Yahoo Finance](https://finance.yahoo.com/)

---

## English summary

One read-only CLI command for global stock quotes via bun-browser (Chrome context, no login, no API key):

| Command | Purpose |
|---------|---------|
| `yahoo-finance/quote <symbol>` | Real-time quote for US/international tickers, indices, ETFs |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`.

**Examples:**

```bash
bun-browser site yahoo-finance/quote AAPL
bun-browser site yahoo-finance/quote 0700.HK
bun-browser site yahoo-finance/quote ^GSPC
```

**Key fields:** `symbol`, `name`, `price`, `change`, `changePercent`, `volume`, `marketCap`, `pe`, `url`.

**vs `eastmoney/stock`:** Yahoo Finance uses **ticker symbols** (global markets); Eastmoney uses **Chinese names or 6-digit A-share codes**.

**Docs:** `bun-browser site info yahoo-finance/quote`
