import { isSongEntry, isTransitionEntry, type Setlist } from 'shared-types'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { formatItemSeconds } from '../lib/formatItemDuration'
import { OverflowMenu, type OverflowMenuAction } from './OverflowMenu'
import { Badge, Button } from './ui'

interface SetlistPreviewProps {
  setlist: Setlist
  active: boolean
  /** Only the master may (de)activate - same rule as before. */
  canActivate: boolean
  onActivate: () => void
  onDeactivate: () => void
  onEdit: () => void
  menu: OverflowMenuAction[]
  onSelectSong: (songId: string, variantId: string | null) => void
}

/** "Do., 24.12.2026" from "2026-12-24". */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * A setlist at a glance, read-only - like SongPreview for a song (Marco, 2026-10-07): name, gig
 * date, schedule and the running order. Changing anything goes through "Bearbeiten"; only
 * (de)activating stays here, since that's what a show reaches for.
 */
export function SetlistPreview({ setlist, active, canActivate, onActivate, onDeactivate, onEdit, menu, onSelectSong }: SetlistPreviewProps) {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const songCount = setlist.entries.filter(isSongEntry).length
  const facts = [
    `${songCount} ${songCount === 1 ? 'Song' : 'Songs'}`,
    setlist.targetEndTime && `Ende ${setlist.targetEndTime}`,
    setlist.defaultTransitionMs !== undefined && `Pause ${Math.round(setlist.defaultTransitionMs / 1000)} s`,
    setlist.defaultSongDurationMs !== undefined && `Songlänge ${Math.round(setlist.defaultSongDurationMs / 1000)} s`,
  ].filter((fact): fact is string => !!fact)

  let songNumber = 0
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-ink">
          <span className="truncate">{setlist.name}</span>
          {active && <Badge tone="accent">Aktiv</Badge>}
        </h2>
        {setlist.performanceDate && <p className="text-ink-faint">Auftritt {formatDate(setlist.performanceDate)}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onEdit}>
          Bearbeiten
        </Button>
        <Button onClick={active ? onDeactivate : onActivate} disabled={!canActivate}>
          {active ? 'Deaktivieren' : 'Aktivieren'}
        </Button>
        <OverflowMenu title={setlist.name} actions={menu} />
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-ink-muted">
        {facts.map((fact) => (
          <span key={fact} className="rounded-control bg-control px-2 py-1">
            {fact}
          </span>
        ))}
      </div>

      {setlist.entries.length === 0 ? (
        <p className="text-ink-faint">Noch leer - „Bearbeiten“ fügt Songs hinzu.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {setlist.entries.map((entry) => {
            if (isTransitionEntry(entry)) {
              const seconds = entry.estimatedDurationMs !== undefined ? formatItemSeconds(entry.estimatedDurationMs) : null
              return entry.style === 'heading' ? (
                <li key={entry.id} className="mt-2 px-1 text-sm font-semibold uppercase tracking-widest text-ink-muted">
                  {entry.title}
                </li>
              ) : (
                <li key={entry.id} className="px-4 py-2 text-base italic text-ink-faint">
                  {entry.title}
                  {seconds && ` · ${seconds}`}
                </li>
              )
            }
            songNumber += 1
            const song = songs.find((s) => s.id === entry.songId)
            const variant = entry.variantId ? variants.find((v) => v.id === entry.variantId) : undefined
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelectSong(entry.songId, entry.variantId)}
                  className="flex min-h-form w-full items-center gap-3 rounded-control bg-control px-4 py-2 text-left text-base [@media(hover:hover)]:hover:bg-control-hover"
                >
                  <span className="w-6 flex-shrink-0 text-right tabular-nums text-ink-faint">{songNumber}</span>
                  <span className="min-w-0 truncate">
                    {song ? song.title || '(ohne Titel)' : <span className="text-ink-faint">Song fehlt</span>}
                    {song?.artist && <span className="text-ink-faint"> — {song.artist}</span>}
                    {variant && <span className="text-ink-faint"> · {variant.label}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
