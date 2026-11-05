(() => {
  const orig = AudioNode.prototype.connect
  const c = (window.__cap = { taps: [], meta: [], onsets: [], armed: false })
  const WORKLET = `
    class Rec extends AudioWorkletProcessor {
      constructor() { super(); this.armed = false; this.q = []; this.pend = []; this.port.onmessage = (e) => { this.armed = e.data === 'arm'; this.q = []; this.pend = [] } }
      process(inputs) {
        const inp = inputs[0]
        if (!this.armed || !inp || !inp.length) return true
        const thr = 0.02, gap = sampleRate * 0.06, win = Math.floor(sampleRate * 0.015)
        for (let ch = 0; ch < inp.length; ch++) {
          const d = inp[ch]; let q = this.q[ch] ?? Infinity
          const pend = (this.pend[ch] ??= [])
          for (let i = 0; i < d.length; i++) {
            for (const p of pend) if (p.left > 0) { if ((p.prev <= 0) !== (d[i] <= 0)) p.zc++; p.prev = d[i]; p.left-- }
            if (Math.abs(d[i]) > thr) { if (q >= gap) pend.push({ frame: currentFrame + i, zc: 0, prev: d[i], left: win }); q = 0 } else q++
          }
          this.q[ch] = q
          while (pend.length && pend[0].left <= 0) { const p = pend.shift(); this.port.postMessage([ch, p.frame, Math.round(p.zc / 2 / (win / sampleRate))]) }
        }
        return true
      }
    }
    registerProcessor('sb-rec', Rec)`
  function setup(ctx) {
    c.ctx = ctx
    c.merger = ctx.createChannelMerger(8)
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    ctx.audioWorklet.addModule(url).then(() => {
      c.node = new AudioWorkletNode(ctx, 'sb-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 8, channelCountMode: 'explicit', channelInterpretation: 'discrete' })
      c.node.port.onmessage = (e) => { const [ch, frame, hz] = e.data; (c.onsets[ch] ??= []).push([frame, hz]) }
      const mute = ctx.createGain(); mute.gain.value = 0
      orig.call(c.merger, c.node); orig.call(c.node, mute); orig.call(mute, ctx.destination)
      c.ready = true
    })
    // Output-timestamp pairs all the time (last ~10 min), so a short take can use a long fit.
    setInterval(() => { if (ctx.state !== 'running') return; const ts = ctx.getOutputTimestamp(); c.meta.push([ts.contextTime, ts.performanceTime, performance.now(), Date.now()]); if (c.meta.length > 30000) c.meta.splice(0, 1000) }, 20)
  }
  // Server-time samples while armed (Gig: the band clock), like clockSync's: [perf sent, perf back, server].
  const serverBase = (() => { try { return JSON.parse(localStorage.getItem('stageboard-stage-server')).state.url } catch { return null } })()
  let srvTimer = null
  c.arm = (on) => {
    c.armed = on
    if (on) {
      c.onsets = []; c.srv = []; c.armedAt = performance.now()
      clearInterval(srvTimer)
      if (serverBase) srvTimer = setInterval(async () => { const a = performance.now(); try { const r = await fetch(serverBase + '/time', { cache: 'no-store' }); const { serverTime } = await r.json(); c.srv.push([a, performance.now(), serverTime]) } catch {} }, 1000)
    } else { c.disarmedAt = performance.now(); clearInterval(srvTimer) }
    c.node?.port.postMessage(on ? 'arm' : 'disarm')
  }
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest)
    try {
      if (dest instanceof AudioDestinationNode && !this.__capIdx) {
        if (!c.ctx) setup(dest.context)
        if (dest.context === c.ctx && c.taps.length < 8) { this.__capIdx = c.taps.length + 1; c.taps.push(this.constructor.name); orig.call(this, c.merger, 0, c.taps.length - 1) }
      }
    } catch (err) { console.warn('cap', err) }
    return r
  }
})()
