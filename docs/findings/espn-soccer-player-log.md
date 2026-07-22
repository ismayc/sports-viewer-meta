# ESPN's per-player match log for soccer is somewhere else, and lies about the score

*Found 2026-07-22, adding recent-form rows to premier-league's player pop-outs.*

The basketball viewers in this family read a player's game log from
`/athletes/{id}/gamelog`. For soccer that endpoint is broken, the log lives somewhere
else entirely, and three things about the payload will produce plausible-looking wrong
output if taken at face value.

## The endpoint

```console
$ base=https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/253989
$ curl -s -o /dev/null -w "%{http_code}\n" $base/gamelog      # 500
$ curl -s -o /dev/null -w "%{http_code}\n" $base/stats        # 404
$ curl -s -o /dev/null -w "%{http_code}\n" $base/splits       # 404
$ curl -s -o /dev/null -w "%{http_code}\n" $base/overview     # 200
```

`/gamelog` answers `{"code":0,"detail":"general error: unknown error"}` — and keeps doing
so with an explicit season (`?season=2025`). It returns 200 only for a season with no
matches in it yet (`?season=2026`, the unstarted 2026-27), which makes it look alive if
that is the first thing you try.

The log is inside **`/overview`**, under `gameLog`: a `statistics[0]` block holding
`labels` and `events`, plus a sibling `events` map of per-match metadata keyed by event id.

## Three traps in the payload

### 1. Goalkeepers are sent different columns

The figures are a bare positional array described by `labels`. Outfielders and keepers do
not get the same list:

| | Columns |
|---|---|
| Outfield | `APP G A SHOT SOG FC FA OF YC RC` |
| Goalkeeper | `APP CS SV GA G A FC FA YC RC` |

Clean sheets, saves and goals against replace shots, shots on goal and offsides. Reading
the outfield set for a keeper raises no error — it silently yields nothing, so a keeper's
every match renders blank. Resolve columns by label (never by index) and choose *which*
labels to display from what the block actually sent.

### 2. `score` is written winner-first

Not home-first, and not the player's-side-first. Danny Welbeck's real May 2026 run, with
Brighton as team `331`:

| Date | Fixture | `gameResult` | `score` | Actual |
|---|---|---|---|---|
| 24 May | vs MAN (home) | `L` | `"3-0"` | Brighton lost **0-3** |
| 17 May | @ LEE | `L` | `"1-0"` | Brighton lost **0-1** |
| 9 May | vs WOL (home) | `W` | `"3-0"` | Brighton won 3-0 |
| 2 May | @ NEW | `L` | `"3-1"` | Brighton lost **1-3** |

Printed beside the `L`, three of those read as though Brighton had scored the larger
number. Rebuild the line from `homeTeamScore` / `awayTeamScore` against `team.id` and
`homeTeamId`, which are unambiguous, and keep `score` only as a fallback.

### 3. It is the last five matches *overall*, not per competition

Internationals and cup ties share the list, tagged by `leagueName` — `English Premier
League`, `FIFA World Cup`, `International Friendly`. Through the close season they are
usually the whole list: in July 2026 every one of Haaland's and Gyökeres's five was a
World Cup match, so an unfiltered pop-out showed a Premier League page full of Norway and
Sweden.

Filter on `leagueName`, but know the ceiling: **there is no depth behind the filter.** A
player who was at the tournament has *zero* league matches in the payload, and no
parameter widens it. Reaching last season's matches means the core API's
`seasons/{year}/athletes/{id}/eventlog` (38 events for 2025-26, league only) — where every
item is a `$ref`, the event ref carries date and teams but hides both scores behind two
further refs, and the player's own figures need a fourth. That is ~22 requests per pop-out,
or ~7 if each match is routed through the site summary endpoint instead. premier-league
deliberately does not pay that: the gap closes on its own once league fixtures resume.

## What premier-league does with it

League matches only, current season preferred — once a player has played this season that
is their form, however short the list. Otherwise the most recent league matches stand in,
labelled with the season they came from. Other competitions stay behind an "All
competitions" toggle rather than being discarded. The season is derived from each match's
date (the league runs August to May, and nothing is played in June or July) because the
payload does not state it.

See `src/services/athlete.js` and `src/components/RecentMatches.jsx` in
[premier-league](https://github.com/ismayc/premier-league), added in `166ed33` and
`0b34f01`.
