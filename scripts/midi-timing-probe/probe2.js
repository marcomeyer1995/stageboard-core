// Load comparison probe. Marker CC119=run before each run. ch1 (0x90): all notes scheduled up front with
// timestamps. ch2 (0x91): sent "now" from a 4 ms timer. ch3 (0x92): like useCueScheduler - 25 ms tick,
// 100 ms lookahead, timestamped. Optional main-thread stalls (opts.stalls).
async function sbMidiProbe2(run, opts = {}) {
  const N = 48, step = 20.833, sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const access = await navigator.requestMIDIAccess({ sysex: false })
  const out = [...access.outputs.values()][0]
  if (!out) return { error: 'no output' }
  let stallTimer = null, stallMs = 0
  if (opts.stalls) stallTimer = setInterval(() => { const d = 50 + Math.random() * 100, end = performance.now() + d; stallMs += d; while (performance.now() < end) {} }, 200)
  out.send([0xb0, 119, run]); await sleep(300)
  // A: all up front
  const t0 = performance.now() + 300
  for (let k = 0; k < N; k++) out.send([0x90, k, 100], t0 + k * step)
  await sleep(300 + N * step + 300)
  // B: timer, send now
  const t1 = performance.now() + 50
  await new Promise((res) => { let k = 0; const tick = () => { while (k < N && performance.now() >= t1 + k * step) { out.send([0x91, k, 100]); k++ } if (k < N) setTimeout(tick, 4); else res() }; setTimeout(tick, 4) })
  await sleep(300)
  // C: scheduler-like
  const t2 = performance.now() + 200
  const gaps = []; let last = performance.now()
  await new Promise((res) => { let k = 0; const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; while (k < N && t2 + k * step <= now + (opts.lookahead ?? 100)) { out.send([0x92, k, 100], t2 + k * step); k++ } if (k >= N) { clearInterval(timer); res() } }, 25) })
  await sleep(500)
  if (stallTimer) clearInterval(stallTimer)
  gaps.sort((a, b) => a - b)
  return { run, tickGapMax: Math.round(gaps[gaps.length - 1]), tickGapP95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), stalledMs: Math.round(stallMs) }
}
