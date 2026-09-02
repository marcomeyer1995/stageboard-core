import { useEffect, useState } from 'react'
import { getServerTime } from '../lib/clockSync'
import { useClockSyncStore } from '../store/useClockSyncStore'

/**
 * Re-renders every animation frame so the displayed server time and flash edge are as smooth
 * and precise as the browser can manage (same rAF-driven-tick pattern as useElapsedMs.ts) -
 * the whole point of this widget is to make a real offset between two devices visible to the
 * eye, so it can't afford setInterval's coarser, unsynchronized timing.
 */
function useServerTimeTick(): number {
  const [, forceTick] = useState(0)
  useEffect(() => {
    let frame: number
    const tick = () => {
      forceTick((n) => n + 1)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return getServerTime()
}

function formatClock(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/**
 * A visual instrument for eyeballing sync quality across devices (#31 follow-up, at Marco's
 * explicit request after the home-WiFi clock-sync debugging session) - not a diagnostic
 * number to interpret, but something two people can literally look at side by side: the whole
 * panel inverts color on every synchronized-second boundary (derived from getServerTime(), the
 * same corrected clock every ahead-of-time dispatch uses - see clockSync.ts), so two devices
 * with a real offset between them visibly flash out of step, while two well-synced devices
 * flash in lockstep. The millisecond-precision digits underneath are the same signal in numeric
 * form, for comparing over a video call or a photo instead of live side by side. Also surfaces
 * this device's own offset/driftMs (useClockSyncStore.ts) so the "why" is right there without
 * switching to the System-Status widget.
 */
export function SyncCheckWidget() {
  const serverTime = useServerTimeTick()
  const { offsetMs, driftMs, lastSyncedAt } = useClockSyncStore()
  const flashOn = Math.floor(serverTime / 1000) % 2 === 0

  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-1 rounded-sb transition-colors duration-75 ${
        flashOn ? 'bg-ink text-surface' : 'bg-surface text-ink'
      }`}
    >
      <span className="font-mono text-3xl tabular-nums">{formatClock(serverTime)}</span>
      <span className="text-xs uppercase tracking-widest opacity-70">Sync-Blitz - Geräte nebeneinander vergleichen</span>
      {lastSyncedAt !== null && (
        <span className="text-xs opacity-70">
          {`Offset ${offsetMs >= 0 ? '+' : ''}${Math.round(offsetMs)} ms · Drift ${driftMs === null ? '?' : Math.round(driftMs)} ms`}
        </span>
      )}
    </div>
  )
}
