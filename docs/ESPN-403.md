# ESPN 403s from CI

## The answer, first

**Fetch from `site.web.api.espn.com`, never `site.api.espn.com`.** ESPN's edge (Akamai)
refuses `site.api` for requests from datacenter IPs — which is every unattended refresh —
while serving the same routes from `site.web.api` without complaint. A viewer built
against `site.api` therefore works on your laptop and 403s the moment CI refreshes it.

If a refresh fails with `HTTP 403`, check the host in `scripts/` before anything else.
The transport says so in the error message.

## How that was established (2026-08-16)

`the-wnba-schedule`'s refresh had been red for eight hours across four runs. The first
diagnosis was "Akamai blocks a subset of GitHub's Azure runner IPs intermittently", and
the defences built from it — a browser UA, retry-on-403, a catch-up cron on a fresh
runner, and a Cloudflare Worker proxy — all failed, the proxy most informatively of all:
it returned 403 too.

Probing both hosts from three egresses, within the same few minutes:

| From | `site.api.espn.com` | `site.web.api.espn.com` |
|---|---|---|
| GitHub runner (2 repos, 3 runs) | **403** | 200 |
| Cloudflare Worker | **403** (every league, every route, 4/4 repeats) | 200 |
| A home connection | 200 | 200 |

Not per-IP, and not intermittent: a policy attached to the `site.api` property, inherited
by any datacenter egress. `sports.core.api.espn.com` and `a.espncdn.com` are unaffected —
`site.api` is the odd one out. The 403 body is Akamai's "Access Denied" page, which is how
we knew the Worker was relaying ESPN's refusal rather than raising its own.

## `site.web.api` is a true drop-in

For the `apis/site/v2/*` and `apis/v2/*` families. Before the family switched, every route
the scripts call was fetched from both hosts and compared: `teams`,
`teams/{abbr}/schedule`, both scoreboard date-range forms, `roster` and `standings` all
came back identical once the response's own `timestamp` was excluded.

Two things worth copying if you ever repeat this:

- **Run a same-host control fetch.** One scoreboard comparison showed a real difference
  that turned out to be a live game advancing between the two calls; fetching the same
  host twice proved the diff tool was fine.
- `summary` matches on every value but serialises its top-level keys in a different
  order, so compare parsed objects, not response text.

## What we deliberately do NOT do

An earlier version of this document described a catch-up cron and an `ESPN_PROXY` egress
as layered defences against a per-IP block. Both were removed on 2026-08-16, along with
the retry-on-403, after reading the full refresh-failure history of all four actively
refreshing repos:

| Date | Repo | Actual cause |
|---|---|---|
| 2026-07-23 | WNBA | test failure |
| 2026-07-25 | WNBA | `HTTP 500` |
| 2026-07-28 | NBA | `HTTP 500` |
| 2026-07-29 | PL | test failure |
| 2026-07-31 | WNBA | network `fetch failed` |
| 2026-08-09 | WNBA | test failure |
| 2026-08-14 | NBA | test failure |
| 2026-08-16 | WNBA ×5 | this host block |

**A per-IP block has never been observed.** The "~1 refresh in 8 lands on a blocked IP"
figure cited 2026-08-09 as evidence, and that run was a failing line-score test, not a
403. The statistic was invented to explain the host block and then back-fitted onto an
unrelated failure.

So the only real transient class is 5xx and network errors, and `scripts/lib/fetch.mjs`
already covers it with 5 attempts, exponential backoff and jitter. A 403 fails
immediately and loudly with the host named, because repeating a request the host is
refusing only turns a fast failure into a slow one — 5×403 over 61 minutes, the day this
was diagnosed.

If a genuine per-IP block ever does show up, this is the place to write down the evidence
before building anything for it.
