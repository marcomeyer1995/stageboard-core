import i18n from '../i18n'
import { isSongEntry, isTransitionEntry, type Setlist } from 'shared-types'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { formatItemSeconds } from '../lib/formatItemDuration'
import { OverflowMenu, type OverflowMenuAction } from './OverflowMenu'
import { Badge, Button } from './ui'
import { useTranslation } from 'react-i18next'

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
  return new Date(year, month - 1, day).toLocaleDateString(i18n.language, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * A setlist at a glance, read-only - like SongPreview for a song (Marco, 2026-10-07): name, gig
 * date, schedule and the running order. Changing anything goes through "Bearbeiten"; only
 * (de)activating stays here, since that's what a show reaches for.
 */
export function SetlistPreview({ setlist, active, canActivate, onActivate, onDeactivate, onEdit, menu, onSelectSong }: SetlistPreviewProps) {
  const { t } = useTranslation('library')
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const songCount = setlist.entries.filter(isSongEntry).length
  const facts = [
    t('pv.songs', { count: songCount }),
    setlist.targetEndTime && t('pv.end', { time: setlist.targetEndTime }),
    setlist.defaultTransitionMs !== undefined && t('pv.pause', { s: Math.round(setlist.defaultTransitionMs / 1000) }),
    setlist.defaultSongDurationMs !== undefined && t('pv.songLength', { s: Math.round(setlist.defaultSongDurationMs / 1000) }),
  ].filter((fact): fact is string => !!fact)

  let songNumber = 0
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto">
      {/* ⋮ top right: the menu for the whole setlist (docs/15 D9). */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <span className="truncate">{setlist.name}</span>
            {active && <Badge tone="accent">{t('active')}</Badge>}
          </h2>
          {setlist.performanceDate && <p className="text-ink-faint">{t('pv.gig', { date: formatDate(setlist.performanceDate) })}</p>}
        </div>
        <OverflowMenu title={setlist.name} actions={menu} scope="page" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onEdit}>
          {t('edit')}
        </Button>
        <Button onClick={active ? onDeactivate : onActivate} disabled={!canActivate}>
          {active ? t('pv.deactivate') : t('pv.activate')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-ink-muted">
        {facts.map((fact) => (
          <span key={fact} className="rounded-control bg-control px-2 py-1">
            {fact}
          </span>
        ))}
      </div>

      {setlist.entries.length === 0 ? (
        <p className="text-ink-faint">{t('pv.empty')}</p>
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
                    {song ? song.title || t('untitled') : <span className="text-ink-faint">{t('pv.songMissing')}</span>}
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
