# Banned news sources

Publishers that **block programmatic article extraction** even after Cloudflare bypass attempts. Adapters return `{ "banned": true, "reason": "..." }`.

Detected via HTTP 403/451, Akamai access-denied pages, or persistent bot blocks (not Cloudflare — use `cloudflare/wait` for those).

| Source | Domain | Reason |
|--------|--------|--------|
| hayspost | www.hayspost.com | HTTP 403 — Cloudflare/publisher blocks programmatic fetch |
| nbcwashington | www.nbcwashington.com | HTTP 403 — Akamai blocks programmatic fetch |
| newser | www.newser.com | HTTP 403 — publisher blocks programmatic fetch |

## Cloudflare (try bypass first)

Sites behind Cloudflare bot protection should **not** be banned immediately. Adapters call the shared `cloudflare` module to wait for clearance:

```bash
bun-browser site cloudflare/wait "https://www.example.com/article"
bun-browser site example/get-article "https://www.example.com/article"
```

See [cloudflare/GUIDE.md](cloudflare/GUIDE.md).

## Usage

```bash
bun-browser site hayspost/get-article "https://www.hayspost.com/posts/..."
```

Example response:

```json
{
  "banned": true,
  "reason": "HTTP 403 — publisher blocks programmatic fetch",
  "url": "https://www.hayspost.com/posts/...",
  "hint": "Publisher blocks programmatic article extraction. Open in Chrome manually or use a subscription session."
}
```

## Paywall (not banned)

These may return partial content or require opening the article in Chrome with a subscription:

- bloomberg, rollingstone, statnews, ussoccer, hollywoodreporter (subscriber CTA in body)

Use `bun-browser open <url>` then retry `get-article` with the same URL.
