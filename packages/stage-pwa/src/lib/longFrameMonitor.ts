/**
 * Long-frame monitor (docs/26 §3.1): logs every frame over LONG_FRAME_MS with what took the time -
 * the measurement behind the inbox (Redmi, 2026-10-28). Off by default. Enable from the devtools
 * console with `localStorage.setItem('sb:debug:frames', '1')` and reload, disable by removing the key.
 */
const KEY = 'sb:debug:frames'
export const LONG_FRAME_MS = 50

interface LoafScript {
  invoker?: string
  sourceURL?: string
  duration: number
  forcedStyleAndLayoutDuration?: number
}
interface LoafEntry extends PerformanceEntry {
  renderStart: number
  styleAndLayoutStart: number
  scripts: LoafScript[]
}

export function longFrameMonitorEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** One line per long frame: total, drawing part, and the scripts in it. */
export function describeLongFrame(entry: LoafEntry): string {
  const end = entry.startTime + entry.duration
  const render = entry.renderStart > 0 ? Math.round(end - entry.renderStart) : 0
  const scripts = entry.scripts
    .map((s) => `${s.invoker ?? s.sourceURL ?? '?'} ${Math.round(s.duration)}ms`)
    .join(', ')
  return `[frames] ${Math.round(entry.duration)} ms (render ${render} ms)${scripts ? ` - ${scripts}` : ''}`
}

/** Starts the monitor if enabled and the browser can (Long Animation Frames API). */
export function startLongFrameMonitor(): void {
  if (!longFrameMonitorEnabled() || typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LoafEntry[]) {
      if (entry.duration >= LONG_FRAME_MS) console.warn(describeLongFrame(entry))
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
}
