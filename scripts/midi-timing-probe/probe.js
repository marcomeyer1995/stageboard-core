// Runs inside the page (Chrome or Android WebView). Returns a promise of a result object.
// Uses note numbers as ids: precision run = notes 0..N-1 (channel 1), baseline run = channel 2,
// clear test = notes 100/101 (should be dropped), 102 (sent after clear, must arrive).
async function sbMidiProbe(portName, opts = {}) {
  const N = opts.n ?? 48, step = opts.stepMs ?? 20.833, lead = opts.leadMs ?? 300
  const access = await navigator.requestMIDIAccess({ sysex: false })
  const outs = [...access.outputs.values()]
  const out = outs.find(o => (o.name || '').includes(portName))
  const info = { ua: navigator.userAgent, outputs: outs.map(o => o.name), hasClear: typeof MIDIOutput !== 'undefined' && typeof MIDIOutput.prototype.clear === 'function' }
  if (!out) return { ...info, error: 'port not found' }
  await out.open()
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  // 1) timestamped: N notes on channel 1, scheduled ahead
  const t0 = performance.now() + lead
  const sched = []
  for (let k = 0; k < N; k++) { const at = t0 + k * step; out.send([0x90, k, 100], at); sched.push(at) }
  await sleep(lead + N * step + 300)
  // 2) baseline: setTimeout-driven immediate sends on channel 2 (like polling per tick)
  const t1 = performance.now() + 50
  const sent = []
  await new Promise(res => { let k = 0; const tick = () => { while (k < N && performance.now() >= t1 + k * step) { out.send([0x91, k, 100]); sent.push(performance.now()); k++ } if (k < N) setTimeout(tick, 4); else res() }; setTimeout(tick, 4) })
  await sleep(300)
  // 3) clear()
  let clearResult = 'not supported'
  const tc = performance.now()
  out.send([0x92, 100, 100], tc + 500); out.send([0x92, 101, 100], tc + 520)
  await sleep(100)
  if (info.hasClear) { try { out.clear(); clearResult = 'called' } catch (e) { clearResult = 'threw: ' + e.message } }
  out.send([0x92, 102, 100], performance.now() + 50)
  await sleep(800)
  return { ...info, port: out.name, stepMs: step, scheduledOffsets: sched.map(a => a - t0), baselineOffsets: sent.map(a => a - t1), clearResult }
}
