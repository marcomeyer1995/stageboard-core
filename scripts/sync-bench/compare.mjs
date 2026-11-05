// compare.mjs - before/after table over the protocol datasets (docs/29 §11)
import { readdirSync } from 'node:fs'
const sets = process.argv.slice(2)
const OFF = { fire: 255, redmi: 35 }
const rows = []
for (const dev of ['fire', 'redmi']) {
  process.env.OFFSET = String(OFF[dev])
  const { analyze } = await import(`./analyze.mjs?${dev}`)
  for (const set of sets) {
    const dir = `${set}/${dev}`
    const takes = readdirSync(dir).filter(f => /^t\d+/.test(f)).sort().map(f => analyze(`${dir}/${f}`)).filter(r => r.beats > 0)
    const long = analyze(`${dir}/long-300s.json`)
    const range = k => { const v = takes.map(t => t[k]); return Math.max(...v) - Math.min(...v) }
    const maxAbs = k => Math.max(...takes.map(t => Math.abs(t[k])))
    rows.push({ dev, set, takes: takes.length, clickSongRange: range('clickVsSong'), trackSongRange: range('trackVsSong'), clickTrackMax: maxAbs('clickMinusTrack'), longClickTrack: Math.abs(long.clickMinusTrack), longTrackDrift: long.trackDriftMsPerMin, longTrackSd: long.trackSd })
  }
}
const f = v => v.toFixed(1).padStart(8)
console.log('device set            takes  click↔song  track↔song  |click−track|  song: |c−t|  track drift  track sd')
console.log('                             range/starts range/starts  max/starts     whole song  ms/min       whole song')
for (const r of rows) console.log(`${r.dev.padEnd(6)} ${r.set.padEnd(14)} ${String(r.takes).padStart(4)} ${f(r.clickSongRange)}   ${f(r.trackSongRange)}    ${f(r.clickTrackMax)}     ${f(r.longClickTrack)}  ${f(r.longTrackDrift)}   ${f(r.longTrackSd)}`)
