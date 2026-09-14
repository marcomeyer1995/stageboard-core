import { useEffect, useState } from 'react'
import type { SongVariant } from 'shared-types'
import { parseChordPro } from '../lib/chordpro'
import { ensureDefaultVariant } from '../lib/songVariantsDb'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { ChordProLyrics } from './ChordProLyrics'

interface SongPreviewProps {
  songId: string
  variantId: string | null
  onEdit: () => void
}

/**
 * Read-only glance at a song before committing to the full editor (Marco, explicit request:
 * selecting a song should land here first, "like Setlists" do - instead of jumping straight
 * into SheetEditor). Loads the variant the same way SheetEditor's own selectSong does
 * (ensureDefaultVariant, falling back to the reactive store for a specific `variantId`), since
 * this is the exact same read, just without a draft to edit.
 */
export function SongPreview({ songId, variantId, onEdit }: SongPreviewProps) {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const [variant, setVariant] = useState<SongVariant | null>(null)

  const song = songs.find((s) => s.id === songId)

  useEffect(() => {
    setVariant(null)
    if (!song) return
    let cancelled = false
    void ensureDefaultVariant(song).then((defaultVariant) => {
      if (cancelled) return
      const picked = variantId ? (variants.find((v) => v.id === variantId) ?? defaultVariant) : defaultVariant
      setVariant(picked)
    })
    return () => {
      cancelled = true
    }
    // Only the ids matter here - re-running on every songs/variants array reference change (a
    // new array each render, since both are derived) would refetch on every unrelated store
    // update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, variantId])

  if (!song || !variant) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Lade…</div>
  }

  const lines = parseChordPro(variant.chordProContent)
  const contentBadges = [
    { label: 'Cues', count: variant.cues.length },
    { label: 'Audio', count: variant.tracks.length },
    { label: 'Klick-Anker', count: variant.beatAnchors.length },
  ]

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold text-ink">{song.title || '(ohne Titel)'}</h2>
          {song.artist && <p className="truncate text-ink-faint">{song.artist}</p>}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="h-10 flex-shrink-0 rounded-sb-sm bg-accent-2 px-4 text-sm font-medium text-accent-ink hover:bg-accent-2-hover"
        >
          Bearbeiten
        </button>
      </div>

      {/* At-a-glance overview of what this song actually has attached, present or not (Marco,
          explicit request) - shown even at zero, muted, rather than only appearing once
          something exists, since "nothing here yet" is itself part of the overview. */}
      <div className="flex flex-wrap gap-2 text-sm">
        {contentBadges.map(({ label, count }) => (
          <span
            key={label}
            className={`rounded-sb-sm px-2 py-1 ${
              count > 0 ? 'bg-accent-2/20 text-accent-ink' : 'bg-control text-ink-faint'
            }`}
          >
            {label}
            {count > 0 ? ` (${count})` : ''}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-ink-muted">
        {variant.key && <span className="rounded-sb-sm bg-control px-2 py-1">Key: {variant.key}</span>}
        {variant.tuning && <span className="rounded-sb-sm bg-control px-2 py-1">Tuning: {variant.tuning}</span>}
        {variant.capo !== undefined && (
          <span className="rounded-sb-sm bg-control px-2 py-1">Capo: {variant.capo}</span>
        )}
        <span className="rounded-sb-sm bg-control px-2 py-1">
          {variant.bpm} BPM · {variant.timeSignature}
        </span>
      </div>

      <ChordProLyrics lines={lines} />
    </div>
  )
}
