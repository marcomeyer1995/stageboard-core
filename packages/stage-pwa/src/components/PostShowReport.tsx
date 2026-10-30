import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { SHOW_LOG_CATEGORIES, showLogCategory, type ShowLogCategory, type ShowLogEvent, type SongVariant } from 'shared-types'
import { pauseBefore } from '../lib/showPauses'
import { capabilitiesLabel } from '../lib/pluginCatalog'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useDialogStore } from '../store/useDialogStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { describeCue } from '../lib/deviceCommands'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { Icon, type IconName } from './Icon'
import { CueDialog, type CueContent } from './timeline/CueDialog'
import { ActionMenu, Button, ChipGroup, InfoHint, PageHeader, ToggleChip, type MenuAction } from './ui'
import { CONTROL, FOCUS, HOVER, SELECTED } from './ui/styles'
import { RigCheckReport } from './RigCheckReport'
import { rigCheckLabel, rigCheckVerdicts } from '../lib/rigCheck'

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Wall-clock time to the second - cues follow each other closely. */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export interface ShowGroup {
  showId: string
  startedAt: number
  events: ShowLogEvent[]
}

/** A "show" is just every event sharing one showId - see showLog.ts. */
function groupByShow(events: ShowLogEvent[]): ShowGroup[] {
  const byShow = new Map<string, ShowLogEvent[]>()
  for (const event of events) {
    const list = byShow.get(event.showId) ?? []
    list.push(event)
    byShow.set(event.showId, list)
  }
  const groups: ShowGroup[] = []
  for (const [showId, showEvents] of byShow) {
    // A Rig-Check that was only prepared, never played (#464) is no show.
    if (showEvents.some((event) => event.type === 'rig-check-run' && event.startedAt === undefined)) continue
    const start = showEvents.find((event) => event.type === 'show-started')
    groups.push({ showId, startedAt: start?.at ?? showEvents[0].at, events: showEvents })
  }
  return groups.sort((a, b) => b.startedAt - a.startedAt)
}

type SongPlayed = Extract<ShowLogEvent, { type: 'song-played' }>

/** "+0:08" / "-0:12" - how far the actual ran from the plan. */
function fmtDiff(ms: number): string {
  return `${ms < 0 ? '-' : '+'}${fmtDuration(Math.abs(ms))}`
}

type CueFired = Extract<ShowLogEvent, { type: 'cue-fired' }>

/** The variant a logged cue belongs to: the one it names, else (older events) the song's variant
 * that still holds it. Null when the cue is gone from the song. */
function variantOfCue(event: CueFired, variants: readonly SongVariant[]): SongVariant | null {
  const holds = (variant: SongVariant) => variant.songId === event.songId && variant.cues.some((cue) => cue.id === event.cueId)
  return variants.find((variant) => variant.id === event.variantId && holds(variant)) ?? variants.find(holds) ?? null
}

/** The Rig-Check's generated test song (#464, lib/rigCheckSong.ts): its cues are the run's device
 * cues, set under System → Rig-Check - a change saved into the song was gone at the next
 * "Vorbereiten" (2026-10-29). */
const RIG_CHECK_SONG_ID = 'rig-check'

/** A section that folds away: its line, with an arrow that turns when it opens - `flex` on a
 * <summary> drops the browser's own triangle, and "Cues (7)" read like plain text (2026-10-29). */
const FOLD = 'flex min-h-form cursor-pointer items-center gap-1 text-sm font-semibold'
const FoldArrow = () => <Icon name="next" className="transition-transform group-open:rotate-90" />

/**
 * A fired cue with its ⋯ "Cue anpassen" (#8): the timeline's cue dialog plus the song time
 * (typed or − / +), saved straight into the variant's cue list - after a show, "the patch change
 * came a bit late" is fixed where it was noticed.
 */
function CueRow({ event, className, prefix, suffix = '', clockColumn = false }: { event: CueFired; className: string; prefix: ReactNode; suffix?: string; clockColumn?: boolean }) {
  const variants = useSongVariantsStore((state) => state.variants)
  const saveVariant = useSongVariantsStore((state) => state.saveVariant)
  const devices = useLogicalDevicesStore((state) => state.devices)
  const { t } = useTranslation('shows')
  const [editing, setEditing] = useState(false)
  const variant = variantOfCue(event, variants)
  const cue = variant?.cues.find((candidate) => candidate.id === event.cueId)
  // In words where the cue is still known ("Patch 02B"), else its raw type ("mg30.selectPatch").
  const device = cue ? devices.find((d) => d.id === cue.targetLogicalDeviceId) : undefined
  const what = cue && device ? describeCue(cue, device.capability) : event.cueType

  const save = (content: CueContent, timeMs?: number) => {
    setEditing(false)
    if (!variant || !cue) return
    const cues = variant.cues.map((c) => (c.id === cue.id ? { ...content, id: cue.id, timeMs: timeMs ?? cue.timeMs } : c)).sort((a, b) => a.timeMs - b.timeMs)
    void saveVariant({ ...variant, cues })
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* In the timeline the time stands in its own column, like every other line. */}
      {clockColumn && <span className="w-20 flex-shrink-0 tabular-nums text-sm text-ink-faint">{fmtClock(event.at)}</span>}
      <span className="min-w-0 flex-1">
        {prefix}
        {!clockColumn && `${fmtClock(event.at)} · `}
        {event.songTitle} · {what} → {event.target}
        {suffix}
      </span>
      <ActionMenu
        title={t('cueTitle', { what })}
        actions={[
          event.songId === RIG_CHECK_SONG_ID
            ? { icon: 'edit', label: t('cueAdjustRigCheck'), disabled: true, onClick: () => undefined }
            : { icon: 'edit', label: cue ? t('cueAdjust') : t('cueAdjustGone'), disabled: !cue, onClick: () => setEditing(true) },
        ]}
      />
      {editing && cue && variant && (
        <CueDialog
          title={t('cueIn', { song: `${event.songTitle}${variant.isDefault ? '' : ` (${variant.label})`}` })}
          devices={devices}
          initial={cue}
          initialTimeMs={cue.timeMs}
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}

/**
 * One show: what was played first, then the notes, and the technical events folded into a single
 * "Technik (n)" line - they used to sit between the songs, dozens of "click-track: degraded →
 * available" lines burying the setlist that was actually played (GUI audit 2026-09-26).
 */
function ShowSections({ show, authorName, children, onBack }: { show: ShowGroup; authorName: (id: string | null) => string; children?: ReactNode; onBack?: () => void }) {
  const byTime = [...show.events].sort((a, b) => a.at - b.at)
  const songs = byTime.filter((event): event is SongPlayed => event.type === 'song-played')
  const failedCues = byTime.filter((event): event is CueFired => event.type === 'cue-fired' && !event.ok)
  const playedMs = songs.reduce((sum, song) => sum + song.activeMs, 0)
  const longPauses = songs.slice(1).filter((song, i) => pauseBefore(songs[i], song).tooLong).length
  const { t } = useTranslation('shows')

  return (
    <>
      {/* The page header every page has (docs/15 D12). */}
      <div className="mb-3">
        <PageHeader
          back={onBack && { label: t('back'), onClick: onBack }}
          title={fmtTime(show.startedAt)}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-1">
              {t('songs', { count: songs.length })} · {t('played', { duration: fmtDuration(playedMs) })}
              {longPauses > 0 && <span className="font-semibold text-warn"> · {t('pausesTooLong', { count: longPauses })}</span>}
              <InfoHint label={t('playedExplainLabel')} text={t('playedExplain')} />
            </span>
          }
        />
      </div>
      {/* A Rig-Check's result (#464) under the show's own heading, above its songs. */}
      {children}
      <div className="space-y-1 text-base">
        {songs.map((event, index) => {
          const pause = index > 0 ? pauseBefore(songs[index - 1], event) : null
          return (
            <div key={event.id}>
              {/* Planned vs. actual (#64): the pause before, marked when it ran too long. */}
              {pause && (
                <p className={`pl-6 text-sm ${pause.tooLong ? 'font-semibold text-warn' : 'text-ink-faint'}`}>
                  {t('pause', { duration: fmtDuration(pause.ms) })}
                  {pause.plannedMs !== null && ` · ${t('planned', { duration: fmtDuration(pause.plannedMs) })}`}
                  {pause.tooLong && pause.plannedMs !== null && ` (${fmtDiff(pause.ms - pause.plannedMs)})`}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="mr-2 text-ink-faint">{index + 1}.</span>
                  {event.songTitle}
                </span>
                <span className="whitespace-nowrap text-sm text-ink-faint">
                  {new Date(event.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })} · {fmtDuration(event.activeMs)}
                  {event.plannedMs !== undefined && ` (${fmtDiff(event.activeMs - event.plannedMs)})`}
                </span>
              </div>
            </div>
          )
        })}
        {songs.length === 0 && <p className="text-sm text-ink-faint">{t('noSong')}</p>}
      </div>
      {/* What went wrong stays in sight above the timeline (#8). */}
      {failedCues.length > 0 && (
        <div className="mt-4 space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-danger">{t('cuesFailedHeading', { count: failedCues.length })}</h3>
          {failedCues.map((event) => (
            <CueRow key={event.id} event={event} className="text-sm text-danger" prefix={<Icon name="warning" className="mr-1" />} suffix={event.message ? ` - ${event.message}` : ''} />
          ))}
        </div>
      )}
      <ShowTimeline show={show} authorName={authorName} />
    </>
  )
}

/** One line of the timeline: when, what, and where in the song. */
interface TimelineRow {
  key: string
  at: number
  category: ShowLogCategory | null
  icon: IconName
  text: string
  /** Song time, where the event knows it. */
  songMs?: number
  tone?: 'warn' | 'danger' | 'faint'
  cue?: CueFired
}

/** The rows one event makes - a song two: its start and its end. Rig-Check results have their own
 * report (#464), the show's start is the first line. */
function timelineRows(event: ShowLogEvent, authorName: (id: string | null) => string): TimelineRow[] {
  // Keys built from the event's kind - checked by the tests that render every kind.
  const t = (key: string, options?: Record<string, unknown>) => (i18n.t as (key: string, options?: Record<string, unknown>) => string)(`shows:${key}`, options)
  const row = (icon: IconName, text: string, extra: Partial<TimelineRow> = {}): TimelineRow[] => [{ key: event.id, at: event.at, category: showLogCategory(event), icon, text, ...extra }]
  switch (event.type) {
    case 'show-started':
      return row('play', t('tl.showStarted'))
    case 'song-played':
      return [
        { key: `${event.id}-start`, at: event.at, category: 'songs', icon: 'setlist', text: t('tl.songStart', { song: event.songTitle }) },
        {
          key: `${event.id}-end`,
          at: event.endedAt,
          category: 'songs',
          icon: 'setlist',
          text: `${t('tl.songEnd', { song: event.songTitle, duration: fmtDuration(event.activeMs) })}${event.plannedMs !== undefined ? ` (${fmtDiff(event.activeMs - event.plannedMs)})` : ''}`,
        },
      ]
    case 'playback': {
      const key = { play: 'tl.play', pause: 'tl.pause', stop: 'tl.stop', reset: 'tl.reset', 'track-end': 'tl.trackEnd' }[event.action]
      const icon: IconName = { play: 'play', pause: 'pause', stop: 'stop', reset: 'reset', 'track-end': 'stop' }[event.action] as IconName
      return row(icon, t(key, { song: event.songTitle }), { songMs: event.positionMs })
    }
    case 'section': {
      const unknown = t('tl.unknownSection')
      if (event.action === 'jump') return row('forward', t('tl.jump', { from: event.fromLabel ?? unknown, to: event.toLabel ?? unknown }), { songMs: event.fromMs })
      if (event.action === 'jump-cancelled') return row('undo', t('tl.jumpCancelled', { to: event.toLabel ?? unknown }), { tone: 'faint' })
      if (event.action === 'repeat') return row('repeat', t('tl.repeat', { section: event.fromLabel ?? unknown }), { songMs: event.fromMs })
      return row('repeat', t('tl.repeatEnd', { section: event.fromLabel ?? unknown }))
    }
    case 'cue-fired':
      return row(event.ok ? 'check' : 'warning', '', { cue: event, tone: event.ok ? undefined : 'danger' })
    case 'capability-changed':
      return row('warning', t('tl.capability', { capability: capabilitiesLabel([event.capability]), from: event.from, to: event.to }), { tone: 'warn' })
    case 'master': {
      const who = event.profileName ? `${event.deviceName} (${event.profileName})` : event.deviceName
      return row('master', t(event.forced ? 'tl.masterForced' : 'tl.master', { who }), event.forced ? { tone: 'warn' } : {})
    }
    case 'ready-check': {
      if (event.action === 'started') return row('check', t('tl.readyStarted'))
      const missing = event.missing ?? []
      const text = t('tl.readyEnded', { count: (event.ready ?? []).length }) + (missing.length ? ` · ${t('tl.readyMissing', { names: missing.join(', ') })}` : '')
      return row('check', text, missing.length ? { tone: 'warn' } : {})
    }
    case 'sound': {
      const song = event.songTitle
      if (event.what === 'tempo') return row('tapSync', t('tl.tempo', { value: Number(event.value) > 0 ? `+${event.value}` : event.value, song }))
      if (event.what === 'track') return row('replace', event.value ? t('tl.track', { value: event.value, song }) : t('tl.trackDefault', { song }))
      if (event.what === 'click-extend') return row('timeline', t('tl.clickExtend', { value: event.value, song }))
      return row('timeline', t(event.value === 'on' ? 'tl.clickOn' : event.value === 'off' ? 'tl.clickOff' : 'tl.clickDefault', { song }))
    }
    case 'flash': {
      const to = event.to.length ? event.to.join(', ') : t('tl.everyone')
      return row('comment', event.from ? t('tl.flashFrom', { from: event.from, to, text: event.text }) : t('tl.flash', { to, text: event.text }))
    }
    case 'note':
      return row('note', t('tl.note', { author: authorName(event.authorProfileId), text: event.text }))
    case 'item-played': {
      const duration = fmtDuration(event.activeMs)
      return [
        {
          key: event.id,
          at: event.at,
          category: 'between',
          icon: event.style === 'heading' ? 'heading' : 'comment',
          text: event.plannedMs !== undefined ? t('tl.itemPlanned', { title: event.title, duration, planned: fmtDuration(event.plannedMs) }) : t('tl.item', { title: event.title, duration }),
        },
      ]
    }
    default:
      return []
  }
}

const TONE: Record<NonNullable<TimelineRow['tone']>, string> = { warn: 'text-warn', danger: 'text-danger', faint: 'text-ink-faint' }

/**
 * Everything that happened in the show, in order (#673, Marco 2026-10-30: "what happened, when and
 * how" - not only what ran off plan): time of day, what, and where in the song. Chips filter by
 * category; only categories this show has events of are offered.
 */
function ShowTimeline({ show, authorName }: { show: ShowGroup; authorName: (id: string | null) => string }) {
  const { t } = useTranslation('shows')
  const [hidden, setHidden] = useState<ReadonlySet<ShowLogCategory>>(new Set())
  const rows = useMemo(() => show.events.flatMap((event) => timelineRows(event, authorName)).sort((a, b) => a.at - b.at), [show.events, authorName])
  const present = SHOW_LOG_CATEGORIES.filter((category) => rows.some((row) => row.category === category))
  const shown = rows.filter((row) => row.category === null || !hidden.has(row.category))
  const toggle = (category: ShowLogCategory, on: boolean) =>
    setHidden((current) => {
      const next = new Set(current)
      if (on) next.delete(category)
      else next.add(category)
      return next
    })

  return (
    <section aria-label={t('tl.title', { count: shown.length })} className="mt-4 space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-widest text-ink-faint">{t('tl.title', { count: shown.length })}</h3>
      {present.length > 1 && (
        <ChipGroup label={t('tl.filter')} hint={null}>
          {present.map((category) => (
            <ToggleChip key={category} label={t(`cat.${category}`)} selected={!hidden.has(category)} onToggle={(on) => toggle(category, on)} />
          ))}
        </ChipGroup>
      )}
      <ol className="space-y-1 text-base">
        {shown.map((row) =>
          row.cue ? (
            <li key={row.key}>
              <CueRow clockColumn event={row.cue} className={row.cue.ok ? 'text-ink' : 'text-danger'} prefix={<Icon name={row.icon} className="mr-1" />} suffix={row.cue.message ? ` - ${row.cue.message}` : ''} />
            </li>
          ) : (
            <li key={row.key} className={`flex items-baseline gap-2 ${row.tone ? TONE[row.tone] : 'text-ink'}`}>
              <span className="w-20 flex-shrink-0 tabular-nums text-sm text-ink-faint">{fmtClock(row.at)}</span>
              <Icon name={row.icon} className="flex-shrink-0 self-center" />
              <span className="min-w-0 flex-1 break-words">{row.text}</span>
              {row.songMs !== undefined && <span className="flex-shrink-0 tabular-nums text-sm text-ink-faint">{t('tl.at', { time: fmtDuration(Math.max(0, row.songMs)) })}</span>}
            </li>
          ),
        )}
        {shown.length === 0 && <li className="text-sm text-ink-faint">{t('tl.nothing')}</li>}
      </ol>
    </section>
  )
}

interface ShowSummary {
  songs: number
  playedMs: number
  notes: number
  failedCues: number
}

function summarize(show: ShowGroup): ShowSummary {
  const songs = show.events.filter((event): event is SongPlayed => event.type === 'song-played')
  return {
    songs: songs.length,
    playedMs: songs.reduce((sum, song) => sum + song.activeMs, 0),
    notes: show.events.filter((event) => event.type === 'note').length,
    failedCues: show.events.filter((event) => event.type === 'cue-fired' && !event.ok).length,
  }
}

/** A start with nothing worth reading - no song played long enough, no note, no failed cue
 * (mostly a test start). */
function isEmpty(summary: ShowSummary): boolean {
  return summary.songs === 0 && summary.notes === 0 && summary.failedCues === 0
}

/** Every show, newest first. */
export function useShows(): ShowGroup[] {
  const events = useShowLogStore((state) => state.events)
  return useMemo(() => groupByShow(events), [events])
}

/** Shows worth reading - what the Bibliothek tab counts. */
export function countShowsWithContent(shows: ShowGroup[]): number {
  return shows.filter((show) => !isEmpty(summarize(show))).length
}

/** One show in the list: a full-width row that opens it; the open one yellow (docs/15 D7). A
 * protected show carries a lock; in "Bearbeiten" the row gets its ⋯ (#610). */
function ShowRow({
  show,
  selected,
  locked,
  actions,
  onOpen,
}: {
  show: ShowGroup
  selected: boolean
  locked: boolean
  actions: MenuAction[] | null
  onOpen: () => void
}) {
  const summary = summarize(show)
  const rigCheck = rigCheckLabel(show.events)
  const verdicts = rigCheckVerdicts(show.events)
  const { t } = useTranslation('shows')
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-h-touch min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left ${CONTROL} ${FOCUS} ${selected ? SELECTED : `bg-control ${HOVER}`}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold">
            {fmtTime(show.startedAt)}
            {rigCheck && ` · ${rigCheck}`}
            {locked && <Icon name="locked" label={t('protected')} className={selected ? '' : 'text-ink-soft'} />}
          </span>
          <span className={`block text-sm ${selected ? '' : 'text-ink-muted'}`}>
            {t('songs', { count: summary.songs })} · {t('played', { duration: fmtDuration(summary.playedMs) })}
            {summary.notes > 0 && ` · ${t('notes', { count: summary.notes })}`}
            {verdicts && verdicts.problems === 0 && verdicts.ok > 0 && ` · ${t('devicesOk', { count: verdicts.ok })}`}
          </span>
          {verdicts && verdicts.problems > 0 && (
            <span className={`block text-sm font-semibold ${selected ? '' : 'text-danger'}`}>
              {t('devicesProblem', { count: verdicts.problems })}
            </span>
          )}
          {/* Its own line in red - a badge beside the text squeezed it to one word per line on the phone. */}
          {summary.failedCues > 0 && <span className={`block text-sm font-semibold ${selected ? '' : 'text-danger'}`}>{t('cuesFailed', { count: summary.failedCues })}</span>}
        </span>
        <Icon name="next" className={selected ? '' : 'text-ink-faint'} />
      </button>
      {actions && <ActionMenu title={t('showTitle', { time: fmtTime(show.startedAt) })} actions={actions} />}
    </div>
  )
}

/**
 * The shows in the Bibliothek's "Shows" tab (the former System → Nachbericht, moved 2026-10-16:
 * what the band played belongs beside the setlists). Opened one at a time - all of them open at
 * once were 23 screens after a month of rehearsals. Starts with nothing in them fold away.
 *
 * Deleting and protecting only after "Bearbeiten" (#610, Marco 2026-10-22: the Bibliothek has no
 * edit lock of its own, so the tab gets one) - a stray tap on stage never removes a show.
 */
export function ShowList({ shows, selectedId, onOpen }: { shows: ShowGroup[]; selectedId: string | null; onOpen: (showId: string) => void }) {
  const [editing, setEditing] = useState(false)
  const protectedIds = useShowLogStore((state) => state.protectedShowIds)
  const setProtected = useShowLogStore((state) => state.setProtected)
  const deleteShows = useShowLogStore((state) => state.deleteShows)
  const confirm = useDialogStore((state) => state.confirm)
  const profile = useActiveProfile()
  const isProtected = (show: ShowGroup) => protectedIds.includes(show.showId)
  const withContent = shows.filter((show) => !isEmpty(summarize(show)))
  const empty = shows.filter((show) => isEmpty(summarize(show)))
  const unprotected = shows.filter((show) => !isProtected(show))
  const emptyUnprotected = empty.filter((show) => !isProtected(show))
  const { t } = useTranslation('shows')

  const remove = async (targets: ShowGroup[], title: string) => {
    if (targets.length === 0) return
    const ok = await confirm(t('deleteText', { shows: t('showCount', { count: targets.length }) }), {
      title,
      confirmLabel: t('delete'),
      danger: true,
    })
    if (ok) await deleteShows(targets.map((show) => show.showId))
  }
  const actionsFor = (show: ShowGroup): MenuAction[] | null =>
    editing
      ? [
          isProtected(show)
            ? { icon: 'unlocked', label: t('unprotect'), onClick: () => void setProtected(show.showId, false, profile?.id ?? null) }
            : { icon: 'locked', label: t('protect'), onClick: () => void setProtected(show.showId, true, profile?.id ?? null) },
          { icon: 'delete', label: isProtected(show) ? t('deleteProtected') : t('delete'), danger: true, disabled: isProtected(show), onClick: () => void remove([show], t('deleteOneTitle')) },
        ]
      : null
  const row = (show: ShowGroup) => (
    <ShowRow
      key={show.showId}
      show={show}
      selected={show.showId === selectedId}
      locked={isProtected(show)}
      actions={actionsFor(show)}
      onOpen={() => onOpen(show.showId)}
    />
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-sm text-ink-muted">
          {t('recorded')}
          <InfoHint
            label={t('explainLabel')}
            text={t('explain')}
          />
        </span>
        {shows.length > 0 && <Button onClick={() => setEditing(!editing)}>{editing ? t('done') : t('edit')}</Button>}
        {editing && (
          <ActionMenu
            scope="page"
            title={t('menuTitle')}
            actions={[
              // The usual tidy-up: the shows nothing was played in (a Play pressed by mistake, a
              // reload) - folded away below, so the count in the tab doesn't include them.
              {
                icon: 'delete',
                label: t('deleteEmpty', { count: emptyUnprotected.length }),
                danger: true,
                disabled: emptyUnprotected.length === 0,
                onClick: () => void remove(emptyUnprotected, t('deleteEmptyTitle')),
              },
              {
                icon: 'delete',
                label: emptyUnprotected.length > 0 ? t('deleteUnprotectedWithEmpty', { count: unprotected.length, empty: emptyUnprotected.length }) : t('deleteUnprotected', { count: unprotected.length }),
                danger: true,
                disabled: unprotected.length === 0,
                onClick: () => void remove(unprotected, t('deleteUnprotectedTitle')),
              },
            ]}
          />
        )}
      </div>
      {shows.length === 0 && <p className="text-sm text-ink-faint">{t('none')}</p>}
      {withContent.map(row)}
      {empty.length > 0 && (
        <details className="group" open={editing || undefined}>
          <summary className={`${FOLD} text-ink-soft`}>
            <FoldArrow />
            {t('withoutSongs', { count: empty.length })}
          </summary>
          <div className="flex flex-col gap-2">{empty.map(row)}</div>
        </details>
      )}
    </div>
  )
}

/** One show in full: the songs played, notes, cues and technical events. */
export function ShowDetail({ showId, onBack }: { showId: string; onBack?: () => void }) {
  const shows = useShows()
  const profiles = useProfilesStore((state) => state.profiles)
  const show = shows.find((candidate) => candidate.showId === showId)
  const { t } = useTranslation('shows')

  function authorName(authorProfileId: string | null): string {
    if (!authorProfileId) return t('unknownAuthor')
    return profiles.find((profile) => profile.id === authorProfileId)?.name ?? t('unknownAuthor')
  }

  if (!show)
    return (
      <div className="flex flex-col gap-3">
        <PageHeader back={onBack && { label: t('back'), onClick: onBack }} />
        <p className="text-ink-faint">{t('removed')}</p>
      </div>
    )
  return (
    <div className="text-ink">
      <ShowSections show={show} authorName={authorName} onBack={onBack}>
        <RigCheckReport events={show.events} />
      </ShowSections>
    </div>
  )
}
