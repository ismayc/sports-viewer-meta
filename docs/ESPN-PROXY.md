# ESPN_PROXY — a fallback egress for the data refresh

## Why

The refresh workflow fetches ESPN's public feeds from a GitHub-hosted runner. ESPN's
edge (Akamai) blocks a subset of GitHub's Azure runner IP ranges intermittently, so
roughly **1 refresh in 8 lands on a blocked IP and 403s** (WNBA 2026-08-09, 2026-08-16).

Two layers already handle the common case, in `scripts/lib/fetch.mjs` and the refresh
workflow:

1. A browser-like `User-Agent` and retry-on-`403`/`429`/`5xx`, which absorb short blips.
2. A **catch-up cron an hour after each main run**. A retry _inside_ a blocked run is
   useless (same runner = same blocked IP), but a fresh run gets a fresh runner and a
   fresh IP, which almost always isn't blocked. That recovers the common short block.

`ESPN_PROXY` is the **third layer, for the rare wide block** that lasts hours and takes
out the catch-up run too. It routes ESPN calls through an egress that isn't a GitHub IP,
so a blocked runner stops mattering entirely. It's **off by default** — set the variable
only if you want the extra guarantee.

## How the code uses it

`scripts/lib/fetch.mjs` reads `process.env.ESPN_PROXY`. When set, each request tries the
direct ESPN URL first; if that exhausts its retries, it falls back to:

```
GET <ESPN_PROXY>?url=<url-encoded ESPN URL>
```

and latches onto the proxy for the rest of that run (the block is per-IP, so the rest
would fail direct too). When the variable is unset, behaviour is unchanged — direct only.

The refresh workflow already passes it through:

```yaml
- name: Regenerate schedule, players, and logos
  run: node scripts/fetch-schedule.mjs
  env:
    ESPN_PROXY: ${{ vars.ESPN_PROXY }}
```

## The Worker

Any egress honouring the `?url=` contract works; a free
[Cloudflare Worker](https://developers.cloudflare.com/workers/) is the simplest. It is an
**allow-listed** proxy — it will only fetch `espn.com`/`espncdn.com`, never an open relay.

```js
// espn-proxy.worker.js — deploy free on Cloudflare Workers.
export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get('url')
    if (!target) return new Response('missing ?url=', { status: 400 })

    let host
    try {
      host = new URL(target).host
    } catch {
      return new Response('bad url', { status: 400 })
    }
    // Never a general-purpose relay: ESPN hosts only.
    if (!/(^|\.)espn\.com$|(^|\.)espncdn\.com$/.test(host)) {
      return new Response('host not allowed', { status: 403 })
    }

    const upstream = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
    })
    // Pass status + body straight through (JSON feeds and logo PNGs alike).
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/octet-stream' },
    })
  },
}
```

## Activation (~5 minutes)

1. Create the Worker: [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers &
   Pages** → **Create** → **Worker**. Paste `espn-proxy.worker.js` above, **Deploy**. Copy
   the deployed URL, e.g. `https://espn-proxy.<your-subdomain>.workers.dev`.
2. In each viewer repo that should use it: **Settings → Secrets and variables → Actions →
   Variables → New repository variable**, name `ESPN_PROXY`, value the Worker URL (no
   trailing slash; the script tolerates one either way).
3. Nothing else — the next refresh falls back to the Worker only when its own runner IP is
   blocked, so Worker traffic stays well within the free tier (100k requests/day).

To turn it off, delete the `ESPN_PROXY` variable; the refresh reverts to direct-only.
