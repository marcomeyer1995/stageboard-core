import { useMemo, type ReactNode } from 'react'
import type { ShowLogEvent } from 'shared-types'
import { capabilitiesLabel } from '../lib/pluginCatalog'
import { useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { Icon } from './Icon'
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
type CapabilityChanged = Extract<ShowLogEvent, { type: 'capability-changed' }>
type Note = Extract<ShowLogEvent, { type: 'note' }>
type CueFired = Extract<ShowLogEvent, { type: 'cue-fired' }>

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
  const cueLine = (event: CueFired) => `${fmtClock(event.at)} · ${event.songTitle} · ${event.cueType} → ${event.target}`
  const playedMs = songs.reduce((sum, song) => sum + song.activeMs, 0)

  return (
    <>
      <h2 className="text-xl font-bold">{fmtTime(show.startedAt)}</h2>
      <p className="mb-3 text-sm text-ink-muted">
        {songs.length} {songs.length === 1 ? 'Song' : 'Songs'} · {fmtDuration(playedMs)} gespielt
      </p>
      {/* A Rig-Check's result (#464) under the show's own heading, above its songs. */}
      {children}
      <div className="space-y-1 text-base">
        {songs.map((event, index) => (
          <div key={event.id} className="flex items-center justify-between gap-2">
            <span>
              <span className="mr-2 text-ink-faint">{index + 1}.</span>
              {event.songTitle}
            </span>
            <span className="whitespace-nowrap text-sm text-ink-faint">
              {new Date(event.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · {fmtDuration(event.activeMs)}
            </span>
          </div>
        ))}
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
            <p key={event.id} className="text-sm text-danger">
              <Icon name="warning" className="mr-1" />
              {cueLine(event)}
              {event.message ? ` - ${event.message}` : ''}
            </p>
          ))}
        </div>
      )}
      {cues.length > 0 && (
        <details className="mt-4">
          <summary className="flex min-h-form cursor-pointer items-center text-sm font-semibold text-ink-soft">
            Cues ({cues.length}{failedCues.length > 0 ? `, ${failedCues.length} fehlgeschlagen` : ''})
          </summary>
          <div className="space-y-1 text-sm text-ink-soft">
            {cues.map((event) => (
              <div key={event.id} className={event.ok ? '' : 'text-danger'}>
                {event.ok ? '✓' : '✗'} {cueLine(event)}
              </div>
            ))}
          </div>
        </details>
      )}
      {technical.length > 0 && (
        <details className="mt-4">
          <summary className="flex min-h-form cursor-pointer items-center text-sm font-semibold text-warn">
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

/** One show in the list: a full-width row that opens it; the open one yellow (docs/15 D7). */
function ShowRow({ show, selected, onOpen }: { show: ShowGroup; selected: boolean; onOpen: () => void }) {
  const summary = summarize(show)
  const rigCheck = rigCheckLabel(show.events)
  const verdicts = rigCheckVerdicts(show.events)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      className={`flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left ${CONTROL} ${FOCUS} ${selected ? SELECTED : `bg-control ${HOVER}`}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {fmtTime(show.startedAt)}
          {rigCheck && ` · ${rigCheck}`}
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
        {summary.failedCues > 0 && <span className={`block text-sm font-semibold ${selected ? '' : 'text-danger'}`}>{summary.failedCues} Cues fehlgeschlagen</span>}
      </span>
      <Icon name="next" className={selected ? '' : 'text-ink-faint'} />
    </button>
  )
}

/**
 * The shows in the Bibliothek's "Shows" tab (the former System → Nachbericht, moved 2026-10-16:
 * what the band played belongs beside the setlists). Opened one at a time - all of them open at
 * once were 23 screens after a month of rehearsals. Starts with nothing in them fold away.
 */
export function ShowList({ shows, selectedId, onOpen }: { shows: ShowGroup[]; selectedId: string | null; onOpen: (showId: string) => void }) {
  const withContent = shows.filter((show) => !isEmpty(summarize(show)))
  const empty = shows.filter((show) => isEmpty(summarize(show)))
  const row = (show: ShowGroup) => <ShowRow key={show.showId} show={show} selected={show.showId === selectedId} onOpen={() => onOpen(show.showId)} />

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">Automatisch erfasst: wann eine Show begann, welche Songs wirklich gespielt wurden (mindestens 20 Sekunden aktiv), technische Ereignisse und Notizen von Band und Crew.</p>
      {shows.length === 0 && <p className="text-sm text-ink-faint">Noch keine Show erfasst.</p>}
      {withContent.map(row)}
      {empty.length > 0 && (
        <details>
          <summary className="flex min-h-form cursor-pointer items-center text-sm font-semibold text-ink-soft">Ohne gespielte Songs ({empty.length})</summary>
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
