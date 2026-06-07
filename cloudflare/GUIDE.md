# Cloudflare bypass module

Detect Cloudflare bot/challenge pages in the browser tab, wait for automatic clearance, and retry fetches. Used by `get-article` adapters and standalone via `cloudflare/wait`.

## Commands

### Wait for clearance

```bash
bun-browser open https://www.example.com/article
bun-browser site cloudflare/wait

# Or navigate + wait in one step:
bun-browser site cloudflare/wait "https://www.example.com/article"

# Longer wait, force reload near timeout:
bun-browser site cloudflare/wait "https://www.example.com/article" maxWaitMs=45000 reloadOnce=true
```

Returns:

```json
{
  "cleared": true,
  "waitedMs": 4200,
  "attempts": 9,
  "url": "https://www.example.com/article",
  "hadChallengeBefore": true,
  "challenge": null,
  "hint": null
}
```

### Get-article with auto-bypass

Generic `get-article` adapters inline this module. When a Cloudflare challenge is detected they:

1. Call `cf.waitForClearance({ url, autoClick: true })` on the open tab
2. Retry `fetch` after clearance
3. Return a actionable hint pointing at `cloudflare/wait` if still blocked

```bash
bun-browser open "https://www.gematsu.com/2026/06/some-article"
bun-browser site gematsu/get-article "https://www.gematsu.com/2026/06/some-article"
```

## Detection signals

- Page title: "Just a moment...", "Attention Required"
- DOM: `.cf-turnstile`, `#cf-challenge-running`, Turnstile iframes, `cdn-cgi/challenge` forms
- Body text: "Enable JavaScript and cookies", "Verify you are human", etc.

## Bypass strategy

Runs in real Chrome (via bun-browser), not headless fetch:

1. Navigate to target URL if needed
2. Poll every 500ms (configurable) up to `maxWaitMs`
3. Auto-click visible challenge checkbox / Turnstile widget when present
4. **Press-and-hold** (Bloomberg Fortress / HUMAN PerimeterX): find the hold button (including shadow DOM), simulate pointer down → wait ~12s → pointer up
5. Optional one reload near timeout (`reloadOnce=true`)
6. Proceed once challenge DOM/text is gone

For press-and-hold challenges:

```bash
bun-browser site cloudflare/wait "https://www.bloomberg.com/news/articles/..." holdMs=12000 maxWaitMs=45000
```

Turnstile inside cross-origin iframes may still require manual completion — open the tab and watch for the checkbox. The module tries coordinate clicks on the left edge of Turnstile iframes and on "Verify you are human" labels (used by grok.com and similar custom challenge pages).

### winehq.org (orchestrate managed challenge)

Pages like [winehq.org](https://www.winehq.org/) use Cloudflare's newer **orchestrate** challenge (`cdn-cgi/challenge-platform/.../chl_page`). They show the site name, "Performing security verification", and may auto-clear without a visible checkbox — or surface a `.cb-lb` Turnstile checkbox / iframe when interaction is required.

```bash
bun-browser open https://www.winehq.org/
bun-browser site cloudflare/wait "https://www.winehq.org/" maxWaitMs=60000 diag=true
```

Verify all wait behaviors (500ms polling, auto-click paths) with the test script:

```bash
bun scripts/test-cloudflare-wait.mjs --url https://www.winehq.org/
```

`diag=true` adds `clicked`, `widgets`, and `pollMs` to the wait response so you can confirm which paths fired.

### grok.com (Turnstile managed challenge)

Custom pages that show the site name, "Performing security verification", and a Cloudflare Turnstile checkbox are already detected (`security_verification`, `verify_human`). Use the standalone waiter on a real Chrome tab:

```bash
bun-browser open https://grok.com/
bun-browser site cloudflare/wait maxWaitMs=45000 reloadOnce=true
```

After `cleared: true`, confirm with `bun-browser site grok/health`. Grok chat adapters (`grok/chat`, etc.) detect Cloudflare but do not auto-wait yet — run `cloudflare/wait` first, or complete the checkbox manually in the open tab.

## Files

| File | Purpose |
|------|---------|
| `cloudflare/helpers.js` | Source of truth — `installCloudflareHelpers()` |
| `cloudflare/wait.js` | Standalone site adapter |
| `scripts/inject-cloudflare-module.mjs` | Inlines helpers into all `get-article.js` adapters |

## Maintenance

After editing `cloudflare/helpers.js`:

```bash
bun scripts/inject-cloudflare-module.mjs
```

Then sync adapters to `~/.bun-browser/sites/` if using a local install.
