import { useEffect, useRef, useState } from 'react'
import { resolveTrackForEntry } from './computeQueue'
import { measureAudioDurationMs } from './measureAudioDuration'
import { useShowMode } from './showMode'
import { getTrack } from './songVariantsDb'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

const RETRY_AFTER_MS = 5 * 60 * 1000

/**
 * Fills in `TrackMeta.durationMs` for tracks that predate it (#28): the Festival Clock needs each
 * song's length, and only a device that has the file can measure it. Mounted once in App.tsx and
 * works through the queue's tracks one at a time. It only runs on the device that controls the
 * queue (Master in Gig mode, always in Practice) so devices don't all measure and write the same
 * value, and never while a song is playing - fetching a whole track then would compete with the
 * live stream for the shared connection (docs/11). The result is saved on the variant, so it
 * replicates to every tablet. A failed
 * measurement is retried after a cool-down (and logged), not given up on until a reload.
 */
export function useTrackDurationBackfill(): void {
  const { queue, canControl, playbackStatus } = useShowMode()
  const items = queue.orderedItems
  const failedAtRef = useRef(new Map<string, number>())
  const busyRef = useRef(false)
  const [tick, setTick] = useState(0)

  function fail(trackId: string, reason: string) {
    console.warn(`[durationBackfill] Track ${trackId}: ${reason} - neuer Versuch in ${RETRY_AFTER_MS / 60000} min`)
    failedAtRef.current.set(trackId, Date.now())
    setTimeout(() => setTick((n) => n + 1), RETRY_AFTER_MS + 1000)
  }

  useEffect(() => {
    if (!canControl || playbackStatus === 'playing' || busyRef.current) return
    let target: { variantId: string; trackId: string } | null = null
    for (const item of items) {
      const track = resolveTrackForEntry(item.entry, item.variant, null)
      const failedAt = track ? failedAtRef.current.get(track.id) : undefined
      const coolingDown = failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS
      if (item.variant && track && track.durationMs === undefined && !coolingDown) {
        target = { variantId: item.variant.id, trackId: track.id }
        break
      }
    }
    if (!target) return
    const { variantId, trackId } = target
    busyRef.current = true
    void (async () => {
      try {
        const blob = await getTrack(variantId, trackId)
        const durationMs = blob ? await measureAudioDurationMs(blob) : null
        const current = useSongVariantsStore.getState().variants.find((variant) => variant.id === variantId)
        if (durationMs === null || !current) {
          fail(trackId, blob ? 'Länge nicht lesbar' : 'Track nicht verfügbar')
          return
        }
        await useSongVariantsStore.getState().saveVariant({
          ...current,
          tracks: current.tracks.map((t) => (t.id === trackId ? { ...t, durationMs } : t)),
        })
      } catch (error) {
        fail(trackId, error instanceof Error ? error.message : 'unbekannter Fehler')
      } finally {
        busyRef.current = false
        setTick((n) => n + 1)
      }
    })()
  }, [items, canControl, playbackStatus, tick])
}
