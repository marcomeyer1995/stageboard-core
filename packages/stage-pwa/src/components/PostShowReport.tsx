import { useMemo, useState, type ReactNode } from 'react'
import type { ShowLogEvent, SongVariant } from 'shared-types'
import { pauseBefore } from '../lib/showPauses'
import { capabilitiesLabel } from '../lib/pluginCatalog'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useDialogStore } from '../store/useDialogStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { describeCue } from '../lib/deviceCommands'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { Icon } from './Icon'
import { CueDialog, type CueContent } from './timeline/CueDialog'
import { ActionMenu, Button, InfoHint } from './ui'
import { CONTROL, FOCUS, HOVER, SELECTED } from './ui/styles'
import { RigCheckReport } from './RigCheckReport'
import { rigCheckLabel, rigCheckVerdicts } from '../lib/rigCheck'

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Wall-clock time to the second - cues follow each other closely. */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

type CapabilityChanged = Extract<ShowLogEvent, { type: 'capability-changed' }>
type Note = Extract<ShowLogEvent, { type: 'note' }>
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
function CueRow({ event, className, prefix, suffix = '' }: { event: CueFired; className: string; prefix: ReactNode; suffix?: string }) {
  const variants = useSongVariantsStore((state) => state.variants)
  const saveVariant = useSongVariantsStore((state) => state.saveVariant)
  const devices = useLogicalDevicesStore((state) => state.devices)
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
      <span className="min-w-0 flex-1">
        {prefix}
        {fmtClock(event.at)} · {event.songTitle} · {what} → {event.target}
        {suffix}
      </span>
      <ActionMenu
        title={`Cue ${what}`}
        actions={[
          event.songId === RIG_CHECK_SONG_ID
            ? { label: 'Cue anpassen (unter System → Rig-Check)', disabled: true, onClick: () => undefined }
            : { label: cue ? 'Cue anpassen' : 'Cue anpassen (nicht mehr im Song)', disabled: !cue, onClick: () => setEditing(true) },
        ]}
      />
      {editing && cue && variant && (
        <CueDialog
          title={`Cue in ${event.songTitle}${variant.isDefault ? '' : ` (${variant.label})`}`}
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
function ShowSections({ show, authorName, children }: { show: ShowGroup; authorName: (id: string | null) => string; children?: ReactNode }) {
  const byTime = [...show.events].sort((a, b) => a.at - b.at)
  const songs = byTime.filter((event): event is SongPlayed => event.type === 'song-played')
  const notes = byTime.filter((event): event is Note => event.type === 'note')
  const technical = byTime.filter((event): event is CapabilityChanged => event.type === 'capability-changed')
  const cues = byTime.filter((event): event is CueFired => event.type === 'cue-fired')
  const failedCues = cues.filter((event) => !event.ok)
  const playedMs = songs.reduce((sum, song) => sum + song.activeMs, 0)
  const longPauses = songs.slice(1).filter((song, i) => pauseBefore(songs[i], song).tooLong).length

  return (
    <>
      <h2 className="text-xl font-bold">{fmtTime(show.startedAt)}</h2>
      <p className="mb-3 flex flex-wrap items-center gap-x-1 text-sm text-ink-muted">
        {songs.length} {songs.length === 1 ? 'Song' : 'Songs'} · {fmtDuration(playedMs)} gespielt
        {longPauses > 0 && <span className="font-semibold text-warn"> · {longPauses} {longPauses === 1 ? 'Pause' : 'Pausen'} zu lang</span>}
        <InfoHint
          label="Erklärung: geplant und gespielt"
          text="Neben jedem Song, wie weit er von seiner geplanten Länge abwich. Pause = vom Ende des Songs davor bis dieser spielte, mit Einzählen und Unterbrechungen; markiert, wenn sie 15 s länger war als in der Setlist geplant."
        />
      </p>
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
                  Pause {fmtDuration(pause.ms)}
                  {pause.plannedMs !== null && ` · geplant ${fmtDuration(pause.plannedMs)}`}
                  {pause.tooLong && pause.plannedMs !== null && ` (${fmtDiff(pause.ms - pause.plannedMs)})`}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="mr-2 text-ink-faint">{index + 1}.</span>
                  {event.songTitle}
                </span>
                <span className="whitespace-nowrap text-sm text-ink-faint">
                  {new Date(event.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · {fmtDuration(event.activeMs)}
                  {event.plannedMs !== undefined && ` (${fmtDiff(event.activeMs - event.plannedMs)})`}
                </span>
              </div>
            </div>
          )
        })}
        {songs.length === 0 && <p className="text-sm text-ink-faint">Kein Song lange genug gespielt.</p>}
      </div>
      {notes.length > 0 && (
        <div className="mt-4 space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Notizen ({notes.length})</h3>
          {notes.map((event) => (
            <p key={event.id} className="text-ink-soft">
              <Icon name="note" className="mr-1" />
              {event.text} — {authorName(event.authorProfileId)} ({fmtTime(event.at)})
            </p>
          ))}
        </div>
      )}
      {/* Cues (#8, Marco 2026-10-08): the ones that failed stay in sight, all of them fold away. */}
      {failedCues.length > 0 && (
        <div className="mt-4 space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-danger">Cues fehlgeschlagen ({failedCues.length})</h3>
          {failedCues.map((event) => (
            <CueRow key={event.id} event={event} className="text-sm text-danger" prefix={<Icon name="warning" className="mr-1" />} suffix={event.message ? ` - ${event.message}` : ''} />
          ))}
        </div>
      )}
      {cues.length > 0 && (
        <details className="group mt-4">
          <summary className={`${FOLD} text-ink-soft`}>
            <FoldArrow />
            Cues ({cues.length}{failedCues.length > 0 ? `, ${failedCues.length} fehlgeschlagen` : ''})
          </summary>
          <div className="space-y-1 text-sm text-ink-soft">
            {cues.map((event) => (
              <CueRow key={event.id} event={event} className={event.ok ? '' : 'text-danger'} prefix={event.ok ? '✓ ' : '✗ '} />
            ))}
          </div>
        </details>
      )}
      {technical.length > 0 && (
        <details className="group mt-4">
          <summary className={`${FOLD} text-warn`}>
            <FoldArrow />
            Technik ({technical.length})
          </summary>
          <div className="space-y-1 text-sm text-warn">
            {technical.map((event) => (
              <div key={event.id}>
                <Icon name="warning" className="mr-1" />
                {capabilitiesLabel([event.capability])}: {event.from} → {event.to} ({fmtTime(event.at)})
              </div>
            ))}
          </div>
        </details>
      )}
    </>
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
  actions: { label: string; danger?: boolean; disabled?: boolean; onClick: () => void }[] | null
  onOpen: () => void
}) {
  const summary = summarize(show)
  const rigCheck = rigCheckLabel(show.events)
  const verdicts = rigCheckVerdicts(show.events)
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
            {locked && <Icon name="locked" label="Geschützt" className={selected ? '' : 'text-ink-soft'} />}
          </span>
          <span className={`block text-sm ${selected ? '' : 'text-ink-muted'}`}>
            {summary.songs} {summary.songs === 1 ? 'Song' : 'Songs'} · {fmtDuration(summary.playedMs)} gespielt
            {summary.notes > 0 && ` · ${summary.notes} ${summary.notes === 1 ? 'Notiz' : 'Notizen'}`}
            {verdicts && verdicts.problems === 0 && verdicts.ok > 0 && ` · ${verdicts.ok} ${verdicts.ok === 1 ? 'Gerät' : 'Geräte'} OK`}
          </span>
          {verdicts && verdicts.problems > 0 && (
            <span className={`block text-sm font-semibold ${selected ? '' : 'text-danger'}`}>
              Rig-Check: {verdicts.problems} {verdicts.problems === 1 ? 'Gerät' : 'Geräte'} mit Problem
            </span>
          )}
          {/* Its own line in red - a badge beside the text squeezed it to one word per line on the phone. */}
          {summary.failedCues > 0 && <span className={`block text-sm font-semibold ${selected ? '' : 'text-danger'}`}>{summary.failedCues} {summary.failedCues === 1 ? 'Cue' : 'Cues'} fehlgeschlagen</span>}
        </span>
        <Icon name="next" className={selected ? '' : 'text-ink-faint'} />
      </button>
      {actions && <ActionMenu title={`Show ${fmtTime(show.startedAt)}`} actions={actions} />}
    </div>
  )
}

const showCount = (n: number) => `${n} ${n === 1 ? 'Show' : 'Shows'}`

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

  const remove = async (targets: ShowGroup[], title: string) => {
    if (targets.length === 0) return
    const ok = await confirm(`${showCount(targets.length)} mit allen Songs, Notizen und Cues löschen - auf allen Geräten der Band. Das lässt sich nicht rückgängig machen.`, {
      title,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (ok) await deleteShows(targets.map((show) => show.showId))
  }
  const actionsFor = (show: ShowGroup) =>
    editing
      ? [
          isProtected(show)
            ? { label: 'Schutz aufheben', onClick: () => void setProtected(show.showId, false, profile?.id ?? null) }
            : { label: 'Schützen', onClick: () => void setProtected(show.showId, true, profile?.id ?? null) },
          { label: isProtected(show) ? 'Löschen (geschützt)' : 'Löschen', danger: true, disabled: isProtected(show), onClick: () => void remove([show], 'Show löschen?') },
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
          Automatisch erfasst
          <InfoHint
            label="Erklärung: Shows"
            text="Wann eine Show begann, welche Songs wirklich gespielt wurden (mindestens 20 Sekunden aktiv), technische Ereignisse und Notizen von Band und Crew."
          />
        </span>
        {shows.length > 0 && <Button onClick={() => setEditing(!editing)}>{editing ? 'Fertig' : 'Bearbeiten'}</Button>}
        {editing && (
          <ActionMenu
            scope="page"
            title="Shows"
            actions={[
              // The usual tidy-up: the shows nothing was played in (a Play pressed by mistake, a
              // reload) - folded away below, so the count in the tab doesn't include them.
              {
                label: `Alle ohne gespielte Songs löschen (${emptyUnprotected.length})`,
                danger: true,
                disabled: emptyUnprotected.length === 0,
                onClick: () => void remove(emptyUnprotected, 'Shows ohne gespielte Songs löschen?'),
              },
              {
                label: `Alle ungeschützten löschen (${unprotected.length}${emptyUnprotected.length > 0 ? `, davon ${emptyUnprotected.length} ohne Songs` : ''})`,
                danger: true,
                disabled: unprotected.length === 0,
                onClick: () => void remove(unprotected, 'Alle ungeschützten Shows löschen?'),
              },
            ]}
          />
        )}
      </div>
      {shows.length === 0 && <p className="text-sm text-ink-faint">Noch keine Show erfasst.</p>}
      {withContent.map(row)}
      {empty.length > 0 && (
        <details className="group" open={editing || undefined}>
          <summary className={`${FOLD} text-ink-soft`}>
            <FoldArrow />
            Ohne gespielte Songs ({empty.length})
          </summary>
          <div className="flex flex-col gap-2">{empty.map(row)}</div>
        </details>
      )}
    </div>
  )
}

/** One show in full: the songs played, notes, cues and technical events. */
export function ShowDetail({ showId }: { showId: string }) {
  const shows = useShows()
  const profiles = useProfilesStore((state) => state.profiles)
  const show = shows.find((candidate) => candidate.showId === showId)

  function authorName(authorProfileId: string | null): string {
    if (!authorProfileId) return 'Unbekannt'
    return profiles.find((profile) => profile.id === authorProfileId)?.name ?? 'Unbekannt'
  }

  if (!show) return <p className="text-ink-faint">Show wurde entfernt.</p>
  return (
    <div className="text-ink">
      <ShowSections show={show} authorName={authorName}>
        <RigCheckReport events={show.events} />
      </ShowSections>
    </div>
  )
}
