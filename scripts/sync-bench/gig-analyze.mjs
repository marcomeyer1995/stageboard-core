// gig-analyze.mjs DIR [take...] - Gig: each device's heard beats against the band clock (server time),
// and device against device per beat. Needs DIR/pushes.jsonl (sse-log.mjs) and DIR/<device>/<take>.json.
import { readFileSync, readdirSync } from 'node:fs'
const beats = JSON.parse(readFileSync(new URL('./beats.json', import.meta.url)))
const fit = (xs, ys) => { const n = xs.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i] } mx /= n; my /= n; let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my) } const b = sxy / sxx; return { a: my - b * mx, b } }
const med = x => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const [dir, ...only] = process.argv.slice(2)
const OFF = { fire: Number(process.env.OFF_FIRE ?? 255), redmi: Number(process.env.OFF_REDMI ?? 35) }
const pushes = readFileSync(`${dir}/pushes.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l).push.patch).filter(p => 'playbackStatus' in p)
const transportAt = (serverMs) => { let t = null; for (const p of pushes) if (p.stateIssuedAt <= serverMs + 30) t = p; return t }
function heard(file, dev) {
  const r = JSON.parse(readFileSync(file, 'utf8'))
  let pairs = r.meta.map(m => [m[0] * 1000, m[1]]).filter(p => p[0] > 0)
  let f = fit(pairs.map(p => p[0]), pairs.map(p => p[1]))
  for (let it = 0; it < 2; it++) { const res = pairs.map(p => p[1] - (f.a + f.b * p[0])); const mad = med(res.map(Math.abs)) || 0.1; pairs = pairs.filter((p, j) => Math.abs(res[j]) <= Math.max(3, 4 * mad)); f = fit(pairs.map(p => p[0]), pairs.map(p => p[1])) }
  // server - perf, from the shortest round trips (like clockSync)
  const srv = [...r.srv].sort((x, y) => (x[1] - x[0]) - (y[1] - y[0])).slice(0, 5)
  const serverMinusPerf = med(srv.map(([a, b, s]) => s - (a + b) / 2))
  const list = (r.onsets || []).find(o => o && o.length > 5) || []
  const out = []
  for (const [fr, hz] of list) {
    const serverMs = f.a + f.b * (fr / r.sr * 1000) + serverMinusPerf
    const t = transportAt(serverMs)
    if (!t || t.playbackStatus !== 'playing') continue
    const song = t.playbackAccumulatedMs + (serverMs - t.playbackStartedAt)
    if (song < 1500) continue
    let best = beats[0]; for (const b of beats) if (Math.abs(b - song + OFF[dev]) < Math.abs(best - song + OFF[dev])) best = b
    if (Math.abs(song - best - OFF[dev]) < 250) out.push({ beat: best, err: song - best, serverMs, hz })
  }
  return { out, rtt: med(r.srv.map(([a, b]) => b - a)) }
}
const takes = only.length ? only : readdirSync(`${dir}/fire`).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort()
const sd = x => { const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length) }
console.log('take       fire click↔band  sd   redmi track↔band  sd   click(Fire)−track(Redmi)  sd   drift c/t ms/min   rtt f/r')
const rows = []
for (const tk of takes) {
  const F = heard(`${dir}/fire/${tk}.json`, 'fire'), R = heard(`${dir}/redmi/${tk}.json`, 'redmi')
  const byBeat = new Map(R.out.map(e => [e.beat, e]))
  const pair = F.out.filter(e => byBeat.has(e.beat)).map(e => e.err - byBeat.get(e.beat).err)
  if (process.env.SERIES) { const t0 = F.out[0]?.serverMs ?? 0; for (const e of F.out) { const r = byBeat.get(e.beat); console.log(`  t=${((e.serverMs - t0) / 1000).toFixed(2).padStart(6)} beat ${String(Math.round(e.beat)).padStart(6)}  fire click ${e.err.toFixed(1).padStart(7)}  redmi track ${r ? r.err.toFixed(1).padStart(7) : '      -'}`) } }
  const slope = o => o.length > 10 ? fit(o.map(e => e.serverMs / 60000), o.map(e => e.err)).b : NaN
  const row = { tk, fc: med(F.out.map(e => e.err)), fsd: sd(F.out.map(e => e.err)), rt: med(R.out.map(e => e.err)), rsd: sd(R.out.map(e => e.err)), ct: med(pair), ctsd: sd(pair), fd: slope(F.out), rd: slope(R.out), rf: F.rtt, rr: R.rtt, n: pair.length }
  rows.push(row)
  const f1 = v => (v === undefined || Number.isNaN(v) ? '   -' : v.toFixed(1).padStart(7))
  console.log(tk.padEnd(10) + f1(row.fc) + f1(row.fsd) + '     ' + f1(row.rt) + f1(row.rsd) + '          ' + f1(row.ct) + f1(row.ctsd) + '      ' + f1(row.fd) + f1(row.rd) + '   ' + f1(row.rf) + f1(row.rr) + `  (${row.n} beats)`)
}
const short = rows.filter(r => !/long/.test(r.tk))
const range = k => { const v = short.map(r => r[k]).filter(x => !Number.isNaN(x)); return (Math.max(...v) - Math.min(...v)).toFixed(1) }
console.log(`\nspread over starts: fire click↔band ${range('fc')} ms | redmi track↔band ${range('rt')} ms | click−track ${range('ct')} ms`)
