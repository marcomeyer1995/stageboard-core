import type { SongEntry, SongVariant } from 'shared-types'
import { resolveTrackForEntry } from './computeQueue'
import { countInLeadMs } from './metronome'

export type DurationSource = 'track' | 'manual'

/**
 * How long a song entry plays, from stored data (#28): the length of the track that is selected
 * (the setlist entry's choice, or the tonight-only override) wins; a track whose length isn't
 * measured yet and a song without a track fall back to the variant's own hand-entered length
 * (which also serves click-only playback). `null` = unknown - callers estimate for display and
 * never stop on it.
 */
export function songDurationMs(
  entry: SongEntry | null,
  variant: SongVariant | null,
  trackOverrideId: string | null,
): { ms: number; source: DurationSource } | null {
  if (!variant) return null
  const track = resolveTrackForEntry(entry, variant, trackOverrideId)
  if (track?.durationMs !== undefined) return { ms: track.durationMs, source: 'track' }
  if (variant.durationMs !== undefined) return { ms: variant.durationMs, source: 'manual' }
  return null
}

/** Time a fresh start spends counting in before the song's own position 0 - zero when there is no
 * count-in, or it fits inside the track's lead-in silence (see countInLeadMs). */
export function countInDurationMs(variant: SongVariant | null): number {
  if (!variant?.countInEnabled) return 0
  return Math.max(0, -countInLeadMs(variant.beatAnchors, variant.bpm, variant.timeSignature, variant.countInBars))
}
