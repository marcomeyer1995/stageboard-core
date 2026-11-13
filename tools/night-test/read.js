// One probe: what happened since the last one. Returns plain JSON.
(() => {
  const n = window.__night
  if (!n) return { error: 'not installed' }
  const now = performance.now()
  const sinceS = (now - n.read.at) / 1000
  // Clicks: gaps between scheduled audio times; a gap of k periods means k-1 clicks missing.
  const fresh = n.whens.slice(Math.max(0, n.whens.length - (n.clicks - n.read.clicks)))
  const d = fresh.slice(1).map((w, i) => w - fresh[i]).filter((x) => x > 0)
  const sorted = [...d].sort((a, b) => a - b)
  const period = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
  let missing = 0
  let worstGapS = 0
  for (const x of d) {
    worstGapS = Math.max(worstGapS, x)
    if (period && x > 1.5 * period) missing += Math.round(x / period) - 1
  }
  // A plugin round trip, not awaited here (a locked page's timers can't time it out): this probe
  // reports the previous call - its time, or how long it has been waiting - and sends a new one.
  const p = n.plugin
  const pluginMs = !p ? 'first probe' : p.ms !== undefined ? p.ms : `pending ${Math.round((now - p.at) / 1000)} s`
  if (!p || p.ms !== undefined) {
    const call = { at: now }
    n.plugin = call
    window.Capacitor.Plugins.NativeOutput.status().then(
      () => (call.ms = Math.round(performance.now() - call.at)),
      (e) => (call.ms = 'error ' + e),
    )
  }
  const native = window.__sbNativeOutput?.state?.() ?? null
  const out = {
    minutes: +((Date.now() - n.wall0) / 60000).toFixed(1),
    sinceS: Math.round(sinceS),
    timerTicks: n.ticks - n.read.ticks,
    timerExpected: Math.round(sinceS),
    // Not only gaps between ticks: a timer that hasn't run since is the longest gap of all.
    timerMaxGapS: +(Math.max(n.maxGap, now - n.lastTick) / 1000).toFixed(1),
    clicks: n.clicks - n.read.clicks,
    clickPeriodMs: period ? Math.round(period * 1000) : null,
    missingClicks: missing,
    worstClickGapS: +worstGapS.toFixed(2),
    pluginMs,
    native: native ? { state: native.state, delayMs: native.delayMs, fellBack: native.fellBack } : null,
    visibility: document.visibilityState,
  }
  n.read = { at: now, ticks: n.ticks, clicks: n.clicks }
  n.maxGap = 0
  return out
})()
