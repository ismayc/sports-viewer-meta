// Live smoke test: proves one standings engine and one fetch layer serve all three
// league shapes against the real ESPN API. Run manually — it hits the network.
//   node test/smoke.mjs
//
// Expected: WNBA matches ESPN's published standings exactly; NFL exercises the
// win-loss-TIE model; EPL fetches exactly teams x (teams-1) fixtures, which is the
// assertion that proves the calendar walk did not silently hit the ~50-event cap.

const { fetchTeams, fetchSeason } = await import('../scripts/lib/espn.mjs')
const { rankTeams } = await import('../core/utils/standings.js')
const cases=[
 {id:'wnba',espnPath:'basketball/wnba',season:2026,standingsModel:'winloss',   tiebreakers:['headToHead','pointDiff'],strategy:'team-schedule'},
 {id:'nfl', espnPath:'football/nfl',   season:2025,standingsModel:'winlosstie',tiebreakers:['headToHead','pointDiff'],strategy:'team-schedule'},
 {id:'epl', espnPath:'soccer/eng.1',   season:2025,standingsModel:'points',    tiebreakers:['goalDiff','goalsFor'],   strategy:'calendar-walk'},
]
for (const a of cases){
  const teams=await fetchTeams(a.espnPath)
  const games=await fetchSeason(a.espnPath, a.strategy==='team-schedule'?teams:[], {season:a.season,seasonTypes:[2],strategy:a.strategy,windowDays:10})
  const played=games.filter(g=>g.score)
  const rows=rankTeams(games,a)
  const fmt=r=>a.standingsModel==='points'?`${r.abbr} ${r.points}pt ${r.w}-${r.t}-${r.l} gd${r.diff>=0?'+':''}${r.diff}`:`${r.abbr} ${r.w}-${r.l}${r.t?'-'+r.t:''}`
  console.log(`${a.id.toUpperCase().padEnd(5)} ${a.standingsModel.padEnd(11)} fetched=${String(games.length).padEnd(4)} played=${String(played.length).padEnd(4)} → ${rows.slice(0,3).map(fmt).join(' | ')}`)
}

// The count assertion that matters — a short read looks exactly like a quiet season.
const epl = cases.find((c) => c.id === 'epl')
const teams = await fetchTeams(epl.espnPath)
const expected = teams.length * (teams.length - 1)
const got = (await fetchSeason(epl.espnPath, [], { strategy: 'calendar-walk', windowDays: 10 })).length
console.log(got === expected ? `\n✅ EPL fixture count ${got} === teams x (teams-1)` : `\n❌ EPL ${got} !== ${expected}`)
process.exit(got === expected ? 0 : 1)
