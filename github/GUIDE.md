# GitHub 使用指南

通过 [bun-browser](https://github.com/epiral/bun-browser) 的 site adapter，在 Chrome 里调用 GitHub REST API。无需 Personal Access Token、无需手动导出 Cookie — 复用浏览器已登录的 `github.com` session。

[English summary](#english-summary) · 中文正文

## 前置条件

1. 已安装 bun-browser，Chrome 扩展已连接，daemon 在运行

```bash
bun-browser status
bun-browser start    # 如未运行
```

2. 浏览器中打开 GitHub（写操作和部分读操作需要登录）

```bash
bun-browser open https://github.com/ --tab current
# 写操作（fork、issue-create、pr-create）及 github/me 需在 Chrome 中完成登录
```

3. 安装/更新 site adapter

```bash
bun-browser site update
bun-browser site list | grep github   # 应看到 6 个命令
```

> 所有 adapter 在 `github.com` 域下执行。若当前没有对应标签页，bun-browser 会自动打开 GitHub。**公开仓库的 `repo` 和 `issues` 无需登录**；`me`、`fork`、`issue-create`、`pr-create` 需要已登录 session。

## 命令一览

| 命令 | 作用 | 典型场景 |
|------|------|----------|
| `github/me` | 当前登录用户信息 | 确认账号、查 public repos 数 |
| `github/repo` | 仓库元信息 | 查 stars、语言、默认分支 |
| `github/issues` | 仓库 issue 列表 | 扫 open issues、过滤 PR |
| `github/issue-create` | 创建 issue | 从 CLI/Agent 提 bug、反馈 |
| `github/pr-create` | 创建 pull request | 无 `gh` CLI 时开 PR |
| `github/fork` | Fork 仓库 | 贡献社区 adapter 前的第一步 |

查看单个命令的完整参数（Agent 函数签名）：

```bash
bun-browser site info github/repo
bun-browser site info github/pr-create
```

## 推荐工作流

### 调研一个仓库（repo → issues）

```bash
# 1. 仓库概况
bun-browser site github/repo epiral/bun-browser

# 2. 查看 open issues（含 PR，用 is_pr 区分）
bun-browser site github/issues epiral/bun-browser

# 3. 也看已关闭的
bun-browser site github/issues epiral/bun-browser --state closed
```

### 贡献社区 adapter（fork → 本地开发 → PR）

无需安装 `gh` CLI，全程可用 bun-browser：

```bash
# 1. 确认当前 GitHub 账号
bun-browser site github/me

# 2. Fork 上游仓库
bun-browser site github/fork epiral/bb-sites
# 返回 clone_url，例如 https://github.com/YOUR_USER/bb-sites.git

# 3. 本地开发
git clone https://github.com/YOUR_USER/bb-sites && cd bb-sites
git checkout -b feat-mysite
# 添加 adapter 文件...
git add . && git commit -m "feat(mysite): add adapters"
git push -u origin feat-mysite

# 4. 向上游开 PR
bun-browser site github/pr-create epiral/bb-sites \
  --title "feat(mysite): add adapters" \
  --head "YOUR_USER:feat-mysite" \
  --body "Adds mysite/search.js and mysite/detail.js"
```

### 从 Agent 提 issue

```bash
bun-browser site github/issue-create epiral/bb-sites \
  --title "[reddit/me] returns empty on logged-in session" \
  --body "## Steps to reproduce\n1. Login to reddit.com\n2. Run reddit/me\n\n## Expected\nUser profile JSON\n\n## Actual\nEmpty response"
```

---

## github/me — 当前登录用户

获取当前浏览器 session 对应的 GitHub 账号信息。

```bash
bun-browser site github/me
```

**需要登录。** 调用 `GET https://api.github.com/user`，携带浏览器 Cookie。

**返回示例**

```json
{
  "login": "your_username",
  "name": "Your Name",
  "bio": "Building things",
  "url": "https://github.com/your_username",
  "public_repos": 42,
  "followers": 100,
  "following": 50,
  "created_at": "2018-01-15T08:30:00Z"
}
```

| 字段 | 说明 |
|------|------|
| `login` | GitHub 用户名（@handle） |
| `url` | 个人主页链接 |
| `public_repos` | 公开仓库数 |
| `created_at` | 账号创建时间（ISO 8601） |

---

## github/repo — 仓库信息

获取公开仓库的元数据。私有仓库需登录且有访问权限。

```bash
bun-browser site github/repo <owner/repo>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `repo` | ✅ | `owner/repo` 格式，如 `epiral/bun-browser` |

**示例**

```bash
bun-browser site github/repo epiral/bun-browser
bun-browser site github/repo microsoft/vscode
```

**返回示例**

```json
{
  "full_name": "epiral/bun-browser",
  "description": "Browser automation CLI for AI agents",
  "language": "TypeScript",
  "url": "https://github.com/epiral/bun-browser",
  "stars": 1200,
  "forks": 85,
  "open_issues": 12,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2026-05-20T12:00:00Z",
  "default_branch": "main",
  "topics": ["browser", "cli", "mcp"],
  "license": "MIT"
}
```

| 字段 | 说明 |
|------|------|
| `stars` | Star 数（`stargazers_count`） |
| `open_issues` | 含 PR 的 open issue 总数 |
| `default_branch` | 默认分支，开 PR 时 `--base` 可参考此值 |
| `license` | SPDX 标识，无 license 时为 `null` |

---

## github/issues — Issue 列表

列出仓库的 issues。GitHub API 将 PR 也视为 issue，返回中带 `is_pr: true` 标记。

```bash
bun-browser site github/issues <owner/repo> [--state STATE]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `repo` | ✅ | — | `owner/repo` 格式 |
| `--state` | ❌ | `open` | `open`、`closed` 或 `all` |

**示例**

```bash
bun-browser site github/issues epiral/bun-browser
bun-browser site github/issues epiral/bb-sites --state all
bun-browser site github/issues epiral/bb-sites --state closed
```

**返回示例**

```json
{
  "repo": "epiral/bun-browser",
  "state": "open",
  "count": 5,
  "issues": [
    {
      "number": 42,
      "title": "Add site adapter for example.com",
      "state": "open",
      "url": "https://github.com/epiral/bun-browser/issues/42",
      "author": "contributor",
      "labels": ["enhancement", "good first issue"],
      "comments": 3,
      "created_at": "2026-05-01T10:00:00Z",
      "is_pr": false
    },
    {
      "number": 41,
      "title": "feat(cli): add jq filter support",
      "state": "open",
      "url": "https://github.com/epiral/bun-browser/pull/41",
      "author": "dev",
      "labels": [],
      "comments": 8,
      "created_at": "2026-04-28T14:00:00Z",
      "is_pr": true
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `is_pr` | `true` 表示该项实为 Pull Request |
| `labels` | 标签名数组 |
| `count` | 本次返回条数（最多 30 条，见下方限制） |

> 单次最多返回 **30** 条（`per_page=30`）。需要更多时需扩展 adapter 或分页。

### 用 jq 过滤纯 issue（排除 PR）

```bash
bun-browser site github/issues epiral/bb-sites --json --jq '.issues[] | select(.is_pr == false) | {number, title, url, labels}'
```

---

## github/issue-create — 创建 Issue

在当前登录账号下，向指定仓库创建 issue。

```bash
bun-browser site github/issue-create <owner/repo> --title "<title>" [--body "<body>"]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `repo` | ✅ | 目标仓库 `owner/repo` |
| `--title` | ✅ | Issue 标题 |
| `--body` | ❌ | Issue 正文（支持 Markdown） |

**需要登录**，且账号对该仓库有创建 issue 的权限（公开仓库通常允许；私有仓库需 collaborator 权限）。

**示例**

```bash
bun-browser site github/issue-create epiral/bb-sites \
  --title "Add adapter for example.com" \
  --body "Would be useful for searching example.com docs."

bun-browser site github/issue-create epiral/bb-sites --title "Quick bug report"
```

**返回示例**

```json
{
  "number": 123,
  "title": "Add adapter for example.com",
  "url": "https://github.com/epiral/bb-sites/issues/123",
  "state": "open"
}
```

---

## github/pr-create — 创建 Pull Request

向目标仓库发起 PR。适合已 push 分支到 GitHub、但没有 `gh` CLI 的场景。

```bash
bun-browser site github/pr-create <owner/repo> \
  --title "<title>" \
  --head "<source>" \
  [--base "<target>"] \
  [--body "<description>"]
```

| 参数 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `repo` | ✅ | — | **目标**仓库（通常是 upstream），如 `epiral/bb-sites` |
| `--title` | ✅ | — | PR 标题 |
| `--head` | ✅ | — | 源分支：`user:branch`（fork 贡献）或 `branch`（同仓库分支） |
| `--base` | ❌ | `main` | 目标分支；若 upstream 默认分支不是 `main`，请显式指定 |
| `--body` | ❌ | 空 | PR 描述（Markdown） |

**需要登录。** `head` 分支必须已 push 到 GitHub，且相对 `base` 有 commits。

**示例**

```bash
# 从 fork 向上游提 PR（最常见）
bun-browser site github/pr-create epiral/bb-sites \
  --title "feat(weibo): add hot adapter" \
  --head "myuser:feat-weibo" \
  --body "Adds weibo/hot.js for trending topics."

# upstream 默认分支是 master
bun-browser site github/pr-create owner/repo \
  --title "fix: typo in README" \
  --head "myuser:fix-readme" \
  --base master

# 同一仓库内开 PR
bun-browser site github/pr-create owner/repo \
  --title "refactor: simplify handler" \
  --head "refactor-handler" \
  --base main
```

**返回示例**

```json
{
  "number": 56,
  "title": "feat(weibo): add hot adapter",
  "url": "https://github.com/epiral/bb-sites/pull/56",
  "state": "open"
}
```

### head 格式说明

| 场景 | `--head` 值 | 说明 |
|------|-------------|------|
| Fork 贡献 | `YOUR_USER:feat-branch` | 分支在 **你的 fork** 上 |
| 同仓库分支 | `feat-branch` | 分支在 **同一 repo** 上 |
| 已存在 open PR | — | GitHub 返回 422，提示 PR 已存在 |

---

## github/fork — Fork 仓库

将指定仓库 fork 到当前登录账号下。

```bash
bun-browser site github/fork <owner/repo>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `repo` | ✅ | 要 fork 的仓库，如 `epiral/bb-sites` |

**需要登录。** 若已 fork 过，GitHub 可能返回已有 fork 的信息（HTTP 202/现有 fork）。

**示例**

```bash
bun-browser site github/fork epiral/bb-sites
bun-browser site github/fork epiral/bun-browser
```

**返回示例**

```json
{
  "full_name": "your_username/bb-sites",
  "url": "https://github.com/your_username/bb-sites",
  "clone_url": "https://github.com/your_username/bb-sites.git"
}
```

| 字段 | 说明 |
|------|------|
| `clone_url` | HTTPS clone 地址，可直接 `git clone` |
| `url` | Fork 后的仓库网页链接 |

---

## 用 jq 过滤 JSON

```bash
# 仓库：stars + 语言 + 链接
bun-browser site github/repo epiral/bun-browser --json --jq '{full_name, stars, language, url, default_branch}'

# Issues：只要非 PR 的 open issue
bun-browser site github/issues epiral/bb-sites --json --jq '.issues[] | select(.is_pr==false) | {number, title, author, url}'

# 按标签过滤
bun-browser site github/issues epiral/bb-sites --json --jq '.issues[] | select(.labels[]? == "good first issue") | {number, title, url}'
```

---

## 常见问题

### `Not logged in to GitHub` / HTTP 401

浏览器未登录 GitHub，或 session 已过期。

```bash
bun-browser open https://github.com/ --tab current
# 在 Chrome 中登录后重试
bun-browser site github/me
```

### `Repo not found` / HTTP 404

- `owner/repo` 拼写错误
- 私有仓库且当前账号无访问权限
- 仓库已删除或更名

### PR 创建失败 / HTTP 422

常见原因：

- `head` 分支尚未 push 到 GitHub
- `head` 格式错误（fork 贡献应用 `YOUR_USER:branch`，不是 upstream 的 branch 名 alone）
- `base` 分支名与 upstream 默认分支不一致（检查 `github/repo` 返回的 `default_branch`）
- 源分支与目标分支无 diff，或已存在相同 head→base 的 open PR

```bash
# 先确认默认分支
bun-browser site github/repo epiral/bb-sites --json --jq '.default_branch'

# 确认分支已 push
git push -u origin feat-mysite

# 再开 PR
bun-browser site github/pr-create epiral/bb-sites \
  --title "..." \
  --head "YOUR_USER:feat-mysite" \
  --base main
```

### `github/issues` 里混有 Pull Request

GitHub REST API 设计如此。用返回字段 `is_pr: true` 区分，或 jq 过滤（见上文）。

### 需要登录吗？

| 命令 | 登录 |
|------|------|
| `github/repo` | ❌ 公开仓库即可；私有需权限 |
| `github/issues` | ❌ 公开仓库即可；私有需权限 |
| `github/me` | ✅ 必须 |
| `github/fork` | ✅ 必须 |
| `github/issue-create` | ✅ 必须 |
| `github/pr-create` | ✅ 必须 |

### 与 `gh` CLI 的区别

| | bun-browser `github/*` | `gh` CLI |
|---|------------------------|----------|
| 认证 | 浏览器 Cookie | `gh auth login` / token |
| 安装 | 仅需 bun-browser + Chrome | 需单独安装 gh |
| 适用场景 | Agent 自动化、无 gh 环境 | 本地开发、CI |
| 能力范围 | 6 个常用操作 | GitHub 全功能 |

两者可混用：例如 `gh pr create` 开 PR，或 `bun-browser site github/pr-create` 在无 gh 的机器上操作。

### Private adapter

可将修改版放到 `~/.bun-browser/sites/github/`，同名文件会覆盖社区版（例如增加 issues 分页、支持 assignees 等）。

---

## 技术说明

- **无需 Personal Access Token** — adapter 通过浏览器内 XHR/fetch 调用 `api.github.com`，写操作依赖已登录 session 的 Cookie。
- **只读 vs 写入** — `me`、`repo`、`issues` 为 `readOnly: true`；`fork`、`issue-create`、`pr-create` 会修改 GitHub 上的资源。
- **API 版本** — 使用 GitHub REST API，`Accept: application/vnd.github+json`。
- **速率限制** — 受 GitHub API rate limit 约束；已认证 session 限额高于匿名。批量调用时建议串行、间隔几秒。
- **域名** — `github.com`；adapter 不会访问 GitHub Enterprise Server 实例。

---

## English summary

Six CLI commands for GitHub via bun-browser (no PAT; uses browser session cookies):

| Command | Purpose |
|---------|---------|
| `github/me` | Logged-in user profile |
| `github/repo <owner/repo>` | Repository metadata (stars, language, default branch) |
| `github/issues <owner/repo> [--state open\|closed\|all]` | Issue list (max 30; PRs marked with `is_pr`) |
| `github/issue-create <repo> --title "..." [--body "..."]` | Create an issue |
| `github/pr-create <repo> --title "..." --head "user:branch" [--base main] [--body "..."]` | Create a pull request |
| `github/fork <owner/repo>` | Fork a repository |

**Prerequisites:** `bun-browser start`, run `bun-browser site update`. Open `https://github.com/`; login required for `me`, `fork`, `issue-create`, and `pr-create`. Public `repo` and `issues` work without login.

**Typical contribution flow:** `github/fork` → local branch & push → `github/pr-create` with `--head YOUR_USER:branch`.

**Per-command docs:** `bun-browser site info github/<command>`
