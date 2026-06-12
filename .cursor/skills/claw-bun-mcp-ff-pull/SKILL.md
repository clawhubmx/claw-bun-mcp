---
name: claw-bun-mcp-ff-pull
description: Fast-forward pull the bun-browser community adapter install at ~/.bun-browser/claw-bun-mcp from clawhubmx/claw-bun-mcp. Use when deploying adapter changes to production bun-browser, running bun-browser site update, syncing HELPERS_VERSION, or when the user asks to update, pull, or merge the installed claw-bun-mcp repo.
---

# Fast-forward pull ~/.bun-browser/claw-bun-mcp

Production `bun-browser` loads site adapters from `~/.bun-browser/claw-bun-mcp/`, not the dev workspace. After merging changes to `clawhubmx/claw-bun-mcp`, fast-forward that install so `bun-browser site` runs the latest adapters.

## Quick path (preferred)

```bash
bun-browser site update
```

This runs `git pull --ff-only` in `~/.bun-browser/claw-bun-mcp`. If the directory has no `.git`, it clones `https://github.com/clawhubmx/claw-bun-mcp.git` instead.

Non-interactive shells (no `bun-browser` alias):

```bash
bun /Users/hesdx/Documents/toolings/bun-browser/dist/cli.js site update
```

## Manual fast-forward

Use when `bun-browser site update` fails or you need explicit git steps:

```bash
COMMUNITY_DIR="$HOME/.bun-browser/claw-bun-mcp"

# First-time install
if [ ! -d "$COMMUNITY_DIR/.git" ]; then
  git clone https://github.com/clawhubmx/claw-bun-mcp.git "$COMMUNITY_DIR"
  exit 0
fi

cd "$COMMUNITY_DIR"
git fetch origin
git status -sb
git merge --ff-only origin/main
```

`git pull --ff-only` in that directory is equivalent to `fetch` + `merge --ff-only origin/main` when tracking `origin/main`.

## Pre-pull checklist

1. **Upstream must have the change** — push dev workspace commits to `origin/main` before pulling the install copy.
2. **No local edits in the install** — `~/.bun-browser/claw-bun-mcp` should stay a clean mirror. Develop in the workspace repo, not in the install dir.
3. **Local overrides** — files under `~/.bun-browser/sites/` shadow community adapters. Updating `claw-bun-mcp` does not change overrides.

## Verify after pull

```bash
cd ~/.bun-browser/claw-bun-mcp
git log -1 --oneline
git status -sb   # should be clean, on main, not behind origin/main
```

For Notion helper changes, confirm the inlined version:

```bash
grep "HELPERS_VERSION" ~/.bun-browser/claw-bun-mcp/notion/chat.js
```

Smoke test:

```bash
bun-browser site notion/models --json
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Not possible to fast-forward` (diverged) | Do not force-pull. Inspect with `git log --oneline main..origin/main` and `git log --oneline origin/main..main`. If install has only accidental local commits, reset to remote: `git fetch origin && git reset --hard origin/main` (only when install has no intentional local work). |
| Uncommitted changes in install | `git stash -u` or discard: `git checkout -- .` then retry `git pull --ff-only`. |
| Still on old behavior after pull | Check `~/.bun-browser/sites/<platform>/` for overrides; remove or update them. |
| Clone missing | Run `bun-browser site update` (auto-clones) or manual `git clone` above. |

## Workflow after claw-bun-mcp changes

```
Task progress:
- [ ] Regenerate adapters if helpers changed (notion/scripts/inline-helpers.mjs)
- [ ] Run tests in dev workspace
- [ ] Push to origin/main
- [ ] bun-browser site update  (or manual ff-pull)
- [ ] Verify HELPERS_VERSION / smoke test
```
