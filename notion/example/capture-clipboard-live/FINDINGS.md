# Clipboard capture live validation findings

Run: `run-2026-06-13T19-23-15-769Z.json` on foreground tab `e3ee` (`hidden=false`, `visibility=visible`).

## Summary

| Check | Result |
|-------|--------|
| Tab visible | Yes |
| Copy button found | Yes (all runs) |
| `navigator.clipboard.readText()` | Available but does not return answer text |
| Isolated probe `copySource` | `copy-dialog` (false positive) |
| Chat `captureSource` | `dom` (correct content) |
| DOM capture content | Passes JSON + prose control prompts |

## Key findings

1. **Background tabs → DOM only** (from prior `capture-consistency-live` runs with `--fresh-tab`): `captureSource` is always `dom` because clipboard read fails when `document.hidden === true`.

2. **Foreground tab → clipboard still fails**: On a visible, focused tab, `captureAnswerViaCopy` does not get answer text from `navigator.clipboard.readText()`. It falls through to `captureAnswerFromCopyDialog`, which returns the label **"Copy response"** (13 chars) — a false positive, not the assistant reply.

3. **Chat wait loop correctly uses DOM**: End-to-end `notion/chat` reports `captureSource: dom` and returns correct JSON/prose. The isolated post-chat probe reports `copy-dialog` because re-clicking Copy after capture opens UI chrome, not the answer.

4. **Copy vs DOM text mismatch**: Probe shows `copyTextLen: 13` vs `domTextLen: 49` for JSON control; `copyPreview: "Copy response"` vs valid JSON in `domPreview`.

## Next step: tab activation before capture

Once clipboard read is fixed (or copy-dialog detection tightened), background-tab workflows should activate the target tab before capture:

```bash
# Pattern from test-tab-pool-title-watch.mjs (selectTab before captureWaitOnly)
bun-browser tab select --id <index>   # note: CLI --id is numeric index today
# or eval with activateTarget when bun-browser adds shortId select
```

Planned flags:

- `test-capture-consistency-live.mjs --activate-before-capture`
- Auto-activate in bun-browser eval path (see `test-auto-activate-capture.mjs`)

Goal: background tabs get reliable capture without manual Chrome focus. Clipboard path fixes are a separate follow-up (post-click timing, permission, copy-dialog heuristics).

## How to re-run

```bash
# Focus Notion AI tab in Chrome, then:
bun notion/scripts/test-capture-clipboard-live.mjs --tab <shortId> --require-visible
```
