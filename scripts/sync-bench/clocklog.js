// Raw clock-sync samples for 10 min: one /time per second, plus a 7-sample back-to-back burst every 60 s
// (what clockSync.ts does). Each sample: [kind, Date.now() sent, Date.now() back, serverTime].
(async () => {
  const base = JSON.parse(localStorage.getItem('stageboard-stage-server')).state.url
  const out = []
  const one = async (kind) => { const a = Date.now(); try { const r = await fetch(base + '/time', { cache: 'no-store' }); const { serverTime } = await r.json(); out.push([kind, a, Date.now(), serverTime]) } catch {} }
  const t0 = Date.now(); let nextBurst = t0
  while (Date.now() - t0 < DURATION_MS) {
    if (Date.now() >= nextBurst) { for (let i = 0; i < 7; i++) await one('b'); nextBurst += 60000 }
    await one('s')
    await new Promise(r => setTimeout(r, 1000))
  }
  return JSON.stringify(out)
})()
