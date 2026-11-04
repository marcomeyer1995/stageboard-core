// analyze.mjs take1.json [take2.json ...] -> per take: click/track vs song clock and click-track
import { readFileSync } from 'node:fs'
const OFFSET = process.env.OFFSET ? Number(process.env.OFFSET) : null
const beats = JSON.parse(readFileSync(new URL('./beats.json', import.meta.url)))
const fit = (xs, ys) => { const n = xs.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i] } mx /= n; my /= n; let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my) } const b = sxy / sxx; return { a: my - b * mx, b } }
const med = x => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
function onsets(x, sr, thr = 0.02, gapMs = 60) {
  const res = []; let quiet = 0; const gap = sr * gapMs / 1000, w = Math.floor(sr * 0.015)
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > thr) { if (quiet >= gap) { let zc = 0; for (let k = i + 1; k < Math.min(x.length, i + w); k++) if ((x[k - 1] <= 0) !== (x[k] <= 0)) zc++; res.push({ i, hz: zc / 2 / 0.015 }) } quiet = 0 } else quiet++
  }
  return res
}
export function analyze(file) {
  const r = JSON.parse(readFileSync(file, 'utf8'))
  // onset frames are exact audio-clock frames (AudioWorklet currentFrame)
  const ctxMsOf = fr => fr / r.sr * 1000
  // audible context time -> performance.now, robust fit over the take's output timestamps
  let pairs = r.meta.map(m => [m[0] * 1000, m[1]]).filter(p => p[0] > 0)
  let f = fit(pairs.map(p => p[0]), pairs.map(p => p[1]))
  for (let it = 0; it < 2; it++) { const res = pairs.map(p => p[1] - (f.a + f.b * p[0])); const mad = med(res.map(Math.abs)) || 0.1; pairs = pairs.filter((p, j) => Math.abs(res[j]) <= Math.max(3, 4 * mad)); f = fit(pairs.map(p => p[0]), pairs.map(p => p[1])) }
  const wallMinusPerf = med(r.meta.map(m => m[3] - m[2]))
  const t = r.transport
  const songOf = i => t.accumulatedMs + ((f.a + f.b * ctxMsOf(i) + wallMinusPerf) - t.startedAt) * (t.rate ?? 1)
  const per = (r.onsets || []).map(o => (o || []).map(([i, hz]) => ({ i, hz })))
  const mhz = o => med(o.map(e => e.hz)) ?? 0
  const click = per.findIndex(o => o.length > 5 && mhz(o) >= 900 && mhz(o) < 1700)
  const track = per.findIndex((o, k) => k !== click && o.length > 5 && mhz(o) >= 250 && mhz(o) < 900)
  const raw = (o, O) => o.map(e => { const s = songOf(e.i); let best = beats[0]; for (const b of beats) if (Math.abs(b - s + O) < Math.abs(best - s + O)) best = b; return { s, err: s - best, wall: f.a + f.b * ctxMsOf(e.i) } }).filter(e => Math.abs(e.err - O) < 250 && e.s > 1500)
  const O = OFFSET ?? med(raw(per[track] ?? [], 0).map(e => e.err)) ?? 0
  const errs = (o) => raw(o, O)
  const ce = click >= 0 ? errs(per[click]) : [], te = track >= 0 ? errs(per[track]) : []
  const ct = []
  for (const c of ce) { let best = null; for (const x of te) if (Math.abs(x.s - c.s) < 120 && (!best || Math.abs(x.s - c.s) < Math.abs(best.s - c.s))) best = x; if (best) ct.push(c.err - best.err) }
  const sd = x => { const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length) }
  const slope = (e) => e.length > 10 ? fit(e.map(x => x.wall / 60000), e.map(x => x.err)).b : NaN
  if (process.env.SERIES) for (const e of ce.filter((_, k) => k % 10 === 0)) { const x = te.find(t => Math.abs(t.s - e.s) < 120); console.log(`  t=${((e.wall - ce[0].wall) / 1000).toFixed(0).padStart(4)} s  click ${e.err.toFixed(1).padStart(7)}  track ${(x ? x.err.toFixed(1) : '-').padStart(7)}`) }
  return { file, beats: ce.length, clickVsSong: med(ce.map(e => e.err)), clickSd: sd(ce.map(e => e.err)), trackVsSong: med(te.map(e => e.err)), trackSd: sd(te.map(e => e.err)), clickMinusTrack: med(ct), clickDriftMsPerMin: slope(ce), trackDriftMsPerMin: slope(te) }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).map(analyze)
  const f1 = v => (v === undefined || Number.isNaN(v) ? '   -' : v.toFixed(1).padStart(7))
  console.log('take'.padEnd(26) + 'beats' + '  click↔song  sd   track↔song  sd   click−track  drift c/t ms/min')
  for (const r of rows) console.log(r.file.split('/').pop().padEnd(26) + String(r.beats).padStart(5) + f1(r.clickVsSong) + f1(r.clickSd) + f1(r.trackVsSong) + f1(r.trackSd) + f1(r.clickMinusTrack) + '   ' + f1(r.clickDriftMsPerMin) + f1(r.trackDriftMsPerMin))
  const spread = k => { const v = rows.map(r => r[k]).filter(x => x !== undefined && !Number.isNaN(x)); return v.length ? `${Math.min(...v).toFixed(1)} … ${Math.max(...v).toFixed(1)} (range ${(Math.max(...v) - Math.min(...v)).toFixed(1)})` : '-' }
  console.log(`\nper-start spread: click↔song ${spread('clickVsSong')} | track↔song ${spread('trackVsSong')} | click−track ${spread('clickMinusTrack')}`)
}
