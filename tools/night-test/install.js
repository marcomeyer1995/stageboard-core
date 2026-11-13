// Counters for the night test, installed once in the page. Nothing here changes how the app plays.
(() => {
  if (window.__night) return 'already installed'
  const n = (window.__night = { t0: performance.now(), wall0: Date.now(), ticks: 0, lastTick: performance.now(), maxGap: 0, gaps: [], whens: [], clicks: 0, read: { at: performance.now(), ticks: 0, clicks: 0 } })
  // A 1 s timer, as the app's own timers: how often does it really run?
  setInterval(() => {
    const t = performance.now()
    const g = t - n.lastTick
    n.ticks++
    if (g > n.maxGap) n.maxGap = g
    if (g > 2000) n.gaps.push(Math.round(g / 1000))
    n.lastTick = t
  }, 1000)
  // Every click clickEngine.ts schedules is an oscillator started at its audio time.
  const start = AudioScheduledSourceNode.prototype.start
  AudioScheduledSourceNode.prototype.start = function (when = 0, ...rest) {
    if (this instanceof OscillatorNode) {
      n.clicks++
      n.whens.push(when)
      if (n.whens.length > 4000) n.whens.splice(0, 2000)
    }
    return start.call(this, when, ...rest)
  }
  return 'installed'
})()
