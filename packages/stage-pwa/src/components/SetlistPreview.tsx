import i18n from '../i18n'
import { isSongEntry, isTransitionEntry, type Setlist } from 'shared-types'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { formatItemSeconds } from '../lib/formatItemDuration'
import { resolveVariantForEntry } from '../lib/computeQueue'
import { VARIANT_ISSUE_LABEL } from '../lib/variantLabel'
import { type OverflowMenuAction } from './OverflowMenu'
import { Badge, PageHeader } from './ui'
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
  /** Back to the list - on narrow screens only, as ← at the start of the title row (no row of its own). */
  onBack?: () => void
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
export function SetlistPreview({ setlist, active, canActivate, onActivate, onDeactivate, onEdit, menu, onSelectSong, onBack }: SetlistPreviewProps) {
  const { t } = useTranslation('library')
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const songCount = setlist.entries.filter(isSongEntry).length
  // One grey line under the title instead of a row of chips (Marco, 2026-10-29: save space).
  const facts = [
    setlist.performanceDate && t('pv.gig', { date: formatDate(setlist.performanceDate) }),
    t('pv.songs', { count: songCount }),
    setlist.targetEndTime && t('pv.end', { time: setlist.targetEndTime }),
    setlist.defaultTransitionMs !== undefined && t('pv.pause', { s: Math.round(setlist.defaultTransitionMs / 1000) }),
    setlist.defaultSongDurationMs !== undefined && t('pv.songLength', { s: Math.round(setlist.defaultSongDurationMs / 1000) }),
  ].filter((fact): fact is string => !!fact)

  let songNumber = 0
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto">
      <PageHeader
        back={onBack && { label: t('title'), onClick: onBack }}
        actions={[
          { icon: 'edit', label: t('edit'), variant: 'primary', onClick: onEdit },
          active
            ? { icon: 'deactivate', label: t('pv.deactivate'), onClick: onDeactivate, disabled: !canActivate }
            : { icon: 'activate', label: t('pv.activate'), onClick: onActivate, disabled: !canActivate },
        ]}
        menu={{ title: setlist.name, actions: menu }}
        title={setlist.name}
        titleExtra={active && <Badge tone="accent">{t('active')}</Badge>}
        subtitle={facts.join(' · ')}
      />

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
            // Always the variant that will play (Marco, 2026-10-29): "Abadschen (Standard)" when the
            // entry follows the song's default, the missing one's label when it is gone.
            const { variant, issue } = resolveVariantForEntry(entry, variants)
            const variantText = issue
              ? VARIANT_ISSUE_LABEL[issue]
              : variant && (entry.variantId === null ? t('variant.isDefault', { name: variant.label }) : variant.label)
            const variantBadge = issue
              ? variantText
              : variant && (entry.variantId === null ? t('variant.isDefaultShort', { name: variant.label }) : variant.label)
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelectSong(entry.songId, entry.variantId)}
                  className="flex min-h-form w-full items-center gap-2 rounded-control bg-control py-2 pl-2 pr-3 text-left text-base [@media(hover:hover)]:hover:bg-control-hover"
                >
                  <span className="w-6 flex-shrink-0 text-right tabular-nums text-ink-faint">{songNumber}</span>
                  {/* The variant as a badge (Marco, 2026-10-29) that always stays readable. From 600 px on
                      the right edge of the one line, title and band cut off first; on the phone that left
                      "All the small things — …" - there the band and the badge get a line of their own. */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {song ? song.title || t('untitled') : <span className="text-ink-faint">{t('pv.songMissing')}</span>}
                        {song?.artist && <span className="text-ink-faint max-[599px]:hidden"> — {song.artist}</span>}
                      </span>
                      {variantBadge && (
                        <span className="max-w-[45%] flex-shrink-0 overflow-hidden whitespace-nowrap max-[599px]:hidden" title={variantText ?? undefined}>
                          <Badge tone={issue ? 'danger' : 'neutral'}>{variantBadge}</Badge>
                        </span>
                      )}
                    </span>
                    {(song?.artist || variantBadge) && (
                      <span className="flex min-w-0 items-center gap-2 min-[600px]:hidden">
                        <span className="min-w-0 flex-1 truncate text-ink-faint">{song?.artist}</span>
                        {variantBadge && (
                          <span className="max-w-[60%] flex-shrink-0 overflow-hidden whitespace-nowrap" title={variantText ?? undefined}>
                            <Badge tone={issue ? 'danger' : 'neutral'}>{variantBadge}</Badge>
                          </span>
                        )}
                      </span>
                    )}
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
