import { useEffect, useState } from 'react'
import type { SongVariant } from 'shared-types'
import { parseChordPro } from '../lib/chordpro'
import { isStandard, stageTuning, signedSteps, soundingKey, tuningLabel, unrecognisedTuningText, variantChordShift } from '../lib/pitch'
import { transposeLines } from '../lib/transposeChord'
import { variantToOpen } from '../lib/songVariantsDb'
import { useSongsStore } from '../store/useSongsStore'
import { ChordProLyrics } from './ChordProLyrics'
import { Button } from './ui'
import { playableTracks } from '../lib/stems'

interface SongPreviewProps {
  songId: string
  variantId: string | null
  onEdit: () => void
}

/**
 * Read-only glance at a song before committing to the full editor (Marco, explicit request:
 * selecting a song should land here first, "like Setlists" do - instead of jumping straight
 * into SheetEditor). Loads the variant the same way SheetEditor's own selectSong does
 * (variantToOpen), since
 * this is the exact same read, just without a draft to edit.
 */
export function SongPreview({ songId, variantId, onEdit }: SongPreviewProps) {
  const songs = useSongsStore((state) => state.songs)
  const [variant, setVariant] = useState<SongVariant | null>(null)

  const song = songs.find((s) => s.id === songId)

  useEffect(() => {
    setVariant(null)
    if (!song) return
    let cancelled = false
    void variantToOpen(song, variantId).then((picked) => {
      if (!cancelled) setVariant(picked)
    })
    return () => {
      cancelled = true
    }
    // Only the ids matter here - re-running on every songs/variants array reference change (a
    // new array each render, since both are derived) would refetch on every unrelated store
    // update. `!!song` is the one exception: a song that reaches the store only after this
    // mounted (just created, or still syncing in) must still load instead of staying "Lade…".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, variantId, !!song])

  if (!song || !variant) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Lade…</div>
  }

  // The grips as on stage: transpose, played and chart tuning (lib/pitch.ts).
  const lines = transposeLines(parseChordPro(variant.chordProContent), variantChordShift(variant), soundingKey(variant))
  const tuning = stageTuning(variant)
  const unknownTuning = unrecognisedTuningText(variant)
  const contentBadges = [
    { label: 'Cues', count: variant.cues.length },
    { label: 'Audio', count: playableTracks(variant.tracks).length },
    { label: 'Klick-Punkte', count: variant.beatGrid?.points.length ?? 0 },
  ]

  return (
    // flex-1/min-h-0, not h-full: sits beside LibraryView's mobile-only "← Bibliothek" button
    // (a flex-col sibling, not a fixed-height container of its own) - h-full would claim 100%
    // of that shared space and overflow by the button's own height whenever it's visible,
    // same "whole page scrolls" bug SetlistDetail had (Marco, explicit report there).
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto">
      {/* Phone: the title wraps instead of "All the small thi…", and the button keeps clear of
          the scrollbar (2026-10-16). */}
      <div className="flex items-start justify-between gap-3 max-[599px]:pr-2">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold text-ink max-[599px]:whitespace-normal max-[599px]:break-words">{song.title || '(ohne Titel)'}</h2>
          {song.artist && <p className="truncate text-ink-faint">{song.artist}</p>}
        </div>
        <Button variant="primary" className="flex-shrink-0" onClick={onEdit}>
          Bearbeiten
        </Button>
      </div>

      {/* At-a-glance overview of what this song actually has attached, present or not (Marco,
          explicit request) - shown even at zero, muted, rather than only appearing once
          something exists, since "nothing here yet" is itself part of the overview. */}
      <div className="flex flex-wrap gap-2 text-sm">
        {contentBadges.map(({ label, count }) => (
          <span
            key={label}
            className={`rounded-control px-2 py-1 ${
              count > 0 ? 'bg-accent-2/20 font-semibold text-ink' : 'bg-control text-ink-faint'
            }`}
          >
            {label}
            {count > 0 ? ` (${count})` : ''}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-ink-muted">
        {variant.key && <span className="rounded-control bg-control px-2 py-1">Key: {soundingKey(variant)}</span>}
        {(variant.transpose ?? 0) !== 0 && (
          <span className="rounded-control bg-control px-2 py-1">Transponiert: {signedSteps(variant.transpose ?? 0)}</span>
        )}
        {!isStandard(tuning) && <span className="rounded-control bg-control px-2 py-1">Stimmung: {tuningLabel(tuning)}</span>}
        {unknownTuning && <span className="rounded-control bg-control px-2 py-1">Tuning: {unknownTuning}</span>}
        {variant.capo !== undefined && (
          <span className="rounded-control bg-control px-2 py-1">Capo: {variant.capo}</span>
        )}
        <span className="rounded-control bg-control px-2 py-1">
          {variant.bpm} BPM · {variant.timeSignature}
        </span>
      </div>

      <ChordProLyrics lines={lines} />
    </div>
  )
}
