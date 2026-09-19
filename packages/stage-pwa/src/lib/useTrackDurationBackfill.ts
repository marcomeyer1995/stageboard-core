import { useEffect, useRef, useState } from 'react'
import { resolveTrackForEntry } from './computeQueue'
import { measureAudioDurationMs } from './measureAudioDuration'
import { useShowMode } from './showMode'
import { getTrack } from './songVariantsDb'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

/**
 * Fills in `TrackMeta.durationMs` for tracks that predate it (#28): the Festival Clock needs each
 * song's length, and only a device that has the file can measure it. Mounted once in App.tsx and
 * works through the queue's tracks one at a time. It only runs on the device that controls the
 * queue (Master in Gig mode, always in Practice) so devices don't all measure and write the same
 * value, and never while a song is playing - fetching a whole track then would compete with the
 * live stream for the shared connection (docs/11). The result is saved on the variant, so it
 * replicates to every tablet.
 */
export function useTrackDurationBackfill(): void {
  const { queue, canControl, playbackStatus } = useShowMode()
  const items = queue.orderedItems
  const failedRef = useRef(new Set<string>())
  const busyRef = useRef(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!canControl || playbackStatus === 'playing' || busyRef.current) return
    let target: { variantId: string; trackId: string } | null = null
    for (const item of items) {
      const track = resolveTrackForEntry(item.entry, item.variant, null)
      if (item.variant && track && track.durationMs === undefined && !failedRef.current.has(track.id)) {
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
          failedRef.current.add(trackId)
          return
        }
        await useSongVariantsStore.getState().saveVariant({
          ...current,
          tracks: current.tracks.map((t) => (t.id === trackId ? { ...t, durationMs } : t)),
        })
      } catch {
        failedRef.current.add(trackId)
      } finally {
        busyRef.current = false
        setTick((n) => n + 1)
      }
    })()
  }, [items, canControl, playbackStatus, tick])
}
