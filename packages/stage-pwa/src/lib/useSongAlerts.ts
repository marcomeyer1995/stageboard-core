import { useEffect, useMemo, useRef } from 'react'
import { songAlerts } from './chordpro'
import { showLocalFlash } from './flash'
import { useShowMode } from './showMode'
import { useClockStore } from '../store/useClockStore'

/**
 * Mounted once in App.tsx (#26): while the current song plays, each `{alert: ...}` line of its
 * text flashes when the song time passes it - on every playing device by itself, no operator and
 * no network needed. Jumping backwards re-arms the alerts after that point.
 */
export function useSongAlerts(): void {
  const { queue, playbackStatus } = useShowMode()
  const content = queue.currentVariant?.chordProContent ?? queue.currentSong?.chordProContent ?? ''
  const alerts = useMemo(() => songAlerts(content), [content])
  const lastMs = useRef<number | null>(null)

  useEffect(() => {
    lastMs.current = null
  }, [alerts])

  useEffect(() => {
    if (playbackStatus !== 'playing' || alerts.length === 0) {
      lastMs.current = null
      return
    }
    const tick = () => {
      const now = useClockStore.getState().getElapsedMs()
      const before = lastMs.current
      lastMs.current = now
      if (before === null || now < before - 1000) return // start or a jump back: arm from here
      for (const alert of alerts) if (alert.timeMs > before && alert.timeMs <= now) showLocalFlash(alert.text)
    }
    tick()
    const interval = setInterval(tick, 150)
    return () => clearInterval(interval)
  }, [playbackStatus, alerts])
}
