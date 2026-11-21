#!/usr/bin/env node
/** /time round-trip spread of a host: node time-probe.mjs <url> [samples] [intervalMs]. NODE_TLS_REJECT_UNAUTHORIZED=0 for a self-signed host.
 * Reports RTT percentiles and the spread of the NTP-style offset estimate (server - local midpoint). Over WiFi from one machine;
 * a measurement of the host's answer path, not of audio sync. */
const url = process.argv[2]?.replace(/\/+$/, '')
const n = Number(process.argv[3] ?? 100)
const gap = Number(process.argv[4] ?? 100)
if (!url) { console.error('usage: time-probe.mjs <url> [samples] [intervalMs]'); process.exit(2) }
const rtts = [], offs = []
let failures = 0
for (let i = 0; i < n; i++) {
  const t0 = performance.timeOrigin + performance.now()
  try {
    const r = await fetch(`${url}/time`, { signal: AbortSignal.timeout(3000) })
    const j = await r.json()
    const t1 = performance.timeOrigin + performance.now()
    rtts.push(t1 - t0); offs.push(j.serverTime - (t0 + t1) / 2)
  } catch { failures++ }
  await new Promise((r) => setTimeout(r, gap))
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p / 100))].toFixed(1) : null }
// keep the best quarter by RTT (the NTP rule): the spread of the offset among those is the host's own jitter
const best = rtts.map((r, i) => [r, offs[i]]).sort((a, b) => a[0] - b[0]).slice(0, Math.max(1, Math.floor(rtts.length / 4))).map((x) => x[1])
console.log(JSON.stringify({ url, samples: rtts.length, failures, rttMs: { p50: pct(rtts, 50), p95: pct(rtts, 95), max: pct(rtts, 100) }, offsetSpreadBestQuarterMs: best.length ? +(Math.max(...best) - Math.min(...best)).toFixed(2) : null }))
