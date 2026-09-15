import { useEffect, useState } from 'react'
import { getServerTime } from '../lib/clockSync'
import { useClockSyncStore } from '../store/useClockSyncStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type SyncCheckConfig } from './syncCheckConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

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
export function SyncCheckWidget({ config }: { config: SyncCheckConfig }) {
  const serverTime = useServerTimeTick()
  const { offsetMs, driftMs, lastSyncedAt } = useClockSyncStore()
  const flashOn = Math.floor(serverTime / 1000) % 2 === 0
  // Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14).
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  return (
    <div
      className={`flex h-full flex-col items-center gap-1 rounded-sb transition-colors duration-75 ${
        flashOn ? 'bg-ink text-surface' : 'bg-surface text-ink'
      }`}
    >
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
        <span style={{ fontSize }} className="whitespace-nowrap font-mono tabular-nums">
          {formatClock(serverTime)}
        </span>
      </div>
      <span className="text-xs uppercase tracking-widest opacity-70">Sync-Blitz - Geräte nebeneinander vergleichen</span>
      {lastSyncedAt !== null && (
        <span className="text-xs opacity-70">
          {`Offset ${offsetMs >= 0 ? '+' : ''}${Math.round(offsetMs)} ms · Drift ${driftMs === null ? '?' : Math.round(driftMs)} ms`}
        </span>
      )}
    </div>
  )
}

export function SyncCheckConfigPanel({
  config,
  onChange,
}: {
  config: SyncCheckConfig
  onChange: (next: SyncCheckConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
