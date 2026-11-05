// clock-replay.mjs clocklog-<dev>.json... - the old (burst/minute, applied at once) and the new
// (continuous window, slewed) clock sync replayed on the same recorded samples, each against the
// truth: a line through the fastest 10 % of all samples of the recording.
import { readFileSync } from 'node:fs'
const fit = (pts) => { const n = pts.length; const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n; let sxx = 0, sxy = 0, sst = 0; for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); sst += (p.y - my) ** 2 } const slope = sxx ? sxy / sxx : 0, intercept = my - slope * mx; const ssr = pts.reduce((a, p) => a + (p.y - intercept - slope * p.x) ** 2, 0); return { slope, intercept, r2: sst ? 1 - ssr / sst : 1 } }
const med = (x) => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
// old: clockSync.ts estimateOffset (min RTT, or the asymmetry line through RTT/offset)
function burstEstimate(b) { const best = b.reduce((a, c) => (c.rtt < a.rtt ? c : a)); if (b.length < 3) return best.offset; const r = b.map((s) => s.rtt); if (Math.max(...r) - Math.min(...r) < 10) return best.offset; const f = fit(b.map((s) => ({ x: s.rtt, y: s.offset }))); return f.r2 < 0.5 ? best.offset : f.intercept }
// new: clockSync.ts estimateFromWindow + slewing (same constants)
function windowEstimate(samples, now) {
  const recent = samples.filter((s) => s.at >= now - 120_000)
  if (recent.length < 10 || now - Math.min(...recent.map((s) => s.at)) < 20_000) return null
  const best = [...recent].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(5, Math.ceil(recent.length * 0.25)))
  const span = Math.max(...best.map((s) => s.at)) - Math.min(...best.map((s) => s.at))
  if (best.length >= 8 && span >= 30_000) { const f = fit(best.map((s) => ({ x: s.at - now, y: s.offset }))); return { offsetMs: f.intercept, perMs: f.slope } }
  return { offsetMs: med(best.map((s) => s.offset)), perMs: 0 }
}
for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const all = raw.map(([kind, a, b, srv]) => ({ kind, at: (a + b) / 2, rtt: b - a, offset: srv - (a + b) / 2 }))
  const fast = [...all].sort((x, y) => x.rtt - y.rtt).slice(0, Math.ceil(all.length * 0.1))
  const t0 = all[0].at
  const truthFit = fit(fast.map((s) => ({ x: s.at - t0, y: s.offset })))
  const truth = (t) => truthFit.intercept + truthFit.slope * (t - t0)
  // evaluate both every 500 ms from 60 s on
  const bursts = []; let cur = []
  for (const s of all) { if (s.kind === 'b') cur.push(s); else if (cur.length) { bursts.push(cur); cur = [] } }
  if (cur.length) bursts.push(cur)
  const burstAt = bursts.map((b) => ({ at: b[b.length - 1].at, offset: burstEstimate(b) }))
  const oldErr = [], newErr = []
  let applied = null // {target:{at,offsetMs,perMs}, errorMs, since}
  const appliedAt = (t) => { if (!applied) return 0; const left = Math.max(0, Math.abs(applied.errorMs) - 2 * (t - applied.since) / 1000); return applied.target.offsetMs + applied.target.perMs * (t - applied.target.at) + Math.sign(applied.errorMs) * left }
  const window = []; let si = 0
  const end = all[all.length - 1].at
  for (let t = t0 + 60_000; t < end; t += 500) {
    const ob = burstAt.filter((b) => b.at <= t).pop(); if (ob) oldErr.push(ob.offset - truth(t))
    while (si < all.length && all[si].at <= t) { window.push(all[si]); const est = windowEstimate(window, all[si].at); if (est) { const now = all[si].at; const curA = applied ? appliedAt(now) : null; const e = curA === null ? 0 : curA - est.offsetMs; applied = { target: { at: now, offsetMs: est.offsetMs, perMs: est.perMs }, errorMs: Math.abs(e) > 50 ? 0 : e, since: now } } si++ }
    if (applied) newErr.push(appliedAt(t) - truth(t))
  }
  const q = (x, p) => { const s = x.map(Math.abs).sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))] }
  const jumps = burstAt.slice(1).map((b, i) => Math.abs(b.offset - burstAt[i].offset))
  console.log(`${file.replace(/^clocklog-|\.json$/g, '').padEnd(6)} samples ${all.length}  rtt min/med ${Math.min(...all.map((s) => s.rtt)).toFixed(0)}/${med(all.map((s) => s.rtt)).toFixed(0)} ms  drift ${(truthFit.slope * 1e6).toFixed(0)} ppm`)
  console.log(`   old (burst/min): |error| median ${q(oldErr, 0.5).toFixed(1)}  95% ${q(oldErr, 0.95).toFixed(1)}  max ${q(oldErr, 1).toFixed(1)} ms   jumps between bursts up to ${Math.max(...jumps).toFixed(1)} ms`)
  console.log(`   new (window):    |error| median ${q(newErr, 0.5).toFixed(1)}  95% ${q(newErr, 0.95).toFixed(1)}  max ${q(newErr, 1).toFixed(1)} ms   (moves ≤ 2 ms/s)`)
}
