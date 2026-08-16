# ESPN 403s from CI — the host, and the fallback egress

## Read this first: it is almost certainly the host

**Fetch from `site.web.api.espn.com`, never `site.api.espn.com`.** ESPN's edge (Akamai)
refuses `site.api` for requests from datacenter IPs — which is every unattended refresh —
while serving the same routes from `site.web.api` without complaint. If a refresh fails
with `HTTP 403 — still failing after 5 attempts`, check the host in `scripts/` before
looking at anything else.

### How that was established (2026-08-16)

The family spent a day on the wrong theory. The original diagnosis here was "Akamai
blocks a subset of GitHub's Azure runner IPs intermittently, ~1 run in 8", and the
defences built from it — a catch-up cron on a fresh runner, then this proxy — could not
recover `the-wnba-schedule`, which stayed red across four runs and eight hours.

What the probing actually showed, all within the same few minutes:

| From | `site.api.espn.com` | `site.web.api.espn.com` |
|---|---|---|
| GitHub runner (two repos, three runs) | **403** | 200 |
| Cloudflare Worker (this proxy) | **403** (every league, every route, 4/4 repeats) | 200 |
| A home connection | 200 | 200 |

So it is not per-IP and not intermittent: it is a policy attached to the `site.api`
property, and any datacenter egress inherits it. `sports.core.api.espn.com` and
`a.espncdn.com` are unaffected too — `site.api` is the odd one out.

`site.web.api` is a true drop-in for the `apis/site/v2` and `apis/v2` route families.
Before the family switched, every route the scripts call was fetched from both hosts and
compared: `teams`, `teams/{abbr}/schedule`, both scoreboard date-range forms, `roster`
and `standings` all came back identical once the response's own `timestamp` was
excluded — with a same-host control fetch each time, so live-game churn could not be
mistaken for a host difference. (`summary` matches on every value but serialises its top
level in a different key order.)

## What the remaining defences are actually for

`scripts/lib/fetch.mjs` and the refresh workflow still carry three layers. They are
worth keeping — they just address a *different* failure than the one above:

1. A browser-like `User-Agent` and retry-on-`403`/`429`/`5xx`, which absorb short blips.
2. A **catch-up cron an hour after each main run** — for a genuine per-IP block, where a
   retry inside the run is useless (same runner, same IP) but a fresh runner escapes.
3. `ESPN_PROXY`, below, for a wide block that outlasts the catch-up.

None of the three can help against a host-wide block. A fresh runner is still a
datacenter, and a proxy pointed at the blocked host inherits the block — which is
exactly why this proxy sat there returning 403s on 2026-08-16.

## ESPN_PROXY

A fallback egress that isn't a GitHub IP. It's **off by default** — set the variable
only if you want the extra guarantee against a per-IP block.

## How the code uses it

`scripts/lib/fetch.mjs` reads `process.env.ESPN_PROXY`. When set, each request tries the
direct ESPN URL first; if that exhausts its retries, it falls back to:

```
GET <ESPN_PROXY>?url=<url-encoded ESPN URL>
```

and latches onto the proxy for the rest of that run: if a per-IP block is what went
wrong, the remaining calls would fail direct too, and paying the direct-failure tax on
all ~90 of them wastes minutes. When the variable is unset, behaviour is unchanged —
direct only.

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
