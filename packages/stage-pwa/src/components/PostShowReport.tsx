import { useState } from 'react'
import type { ShowLogEvent } from 'shared-types'
import { capabilitiesLabel } from '../lib/pluginCatalog'
import { useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { Icon } from './Icon'
import { Button } from './ui'

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

interface ShowGroup {
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
function ShowSections({ show, authorName }: { show: ShowGroup; authorName: (id: string | null) => string }) {
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
      <h2 className="font-semibold">{fmtTime(show.startedAt)}</h2>
      <p className="mb-3 text-sm text-ink-muted">
        {songs.length} {songs.length === 1 ? 'Song' : 'Songs'} · {fmtDuration(playedMs)} gespielt
      </p>
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

/** One show in the list: a full-width row that opens it. */
function ShowRow({ show, onOpen }: { show: ShowGroup; onOpen: () => void }) {
  const summary = summarize(show)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-touch w-full items-center gap-3 rounded-container border border-line bg-surface px-4 py-2 text-left shadow-sb [@media(hover:hover)]:hover:bg-control"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{fmtTime(show.startedAt)}</span>
        <span className="block text-sm text-ink-muted">
          {summary.songs} {summary.songs === 1 ? 'Song' : 'Songs'} · {fmtDuration(summary.playedMs)} gespielt
          {summary.notes > 0 && ` · ${summary.notes} ${summary.notes === 1 ? 'Notiz' : 'Notizen'}`}
        </span>
        {/* Its own line in red - a badge beside the text squeezed it to one word per line on the phone. */}
        {summary.failedCues > 0 && <span className="block text-sm font-semibold text-danger">{summary.failedCues} Cues fehlgeschlagen</span>}
      </span>
      <Icon name="next" className="text-ink-faint" />
    </button>
  )
}

/**
 * Every show as a list, opened one at a time (System cleanup, 2026-10-16) - all of them open at
 * once were 23 screens after a month of rehearsals. Starts with nothing in them fold away.
 */
export function PostShowReport() {
  const events = useShowLogStore((state) => state.events)
  const profiles = useProfilesStore((state) => state.profiles)
  const [openShowId, setOpenShowId] = useState<string | null>(null)
  const shows = groupByShow(events)
  const openShow = shows.find((show) => show.showId === openShowId)

  function authorName(authorProfileId: string | null): string {
    if (!authorProfileId) return 'Unbekannt'
    return profiles.find((profile) => profile.id === authorProfileId)?.name ?? 'Unbekannt'
  }

  if (openShow) {
    return (
      <div className="h-full overflow-y-auto sb-app-bg p-4 text-ink">
        <div className="mb-3">
          <Button onClick={() => setOpenShowId(null)}>
            <Icon name="back" /> Alle Shows
          </Button>
        </div>
        <div className="rounded-container border border-line bg-surface p-4 shadow-sb">
          <ShowSections show={openShow} authorName={authorName} />
        </div>
      </div>
    )
  }

  const withContent = shows.filter((show) => !isEmpty(summarize(show)))
  const empty = shows.filter((show) => isEmpty(summarize(show)))

  return (
    <div className="h-full overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Nachbericht</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Automatisch erfasst: wann eine Show begann, welche Songs wirklich gespielt wurden
        (mindestens 20 Sekunden aktiv), technische Ereignisse und Notizen von Band und
        Crew.
      </p>

      {shows.length === 0 && <p className="text-sm text-ink-faint">Noch keine Show erfasst.</p>}

      <div className="space-y-2">
        {withContent.map((show) => (
          <ShowRow key={show.showId} show={show} onOpen={() => setOpenShowId(show.showId)} />
        ))}
      </div>
      {empty.length > 0 && (
        <details className="mt-4">
          <summary className="flex min-h-form cursor-pointer items-center text-sm font-semibold text-ink-soft">
            Ohne gespielte Songs ({empty.length})
          </summary>
          <div className="space-y-2">
            {empty.map((show) => (
              <ShowRow key={show.showId} show={show} onOpen={() => setOpenShowId(show.showId)} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
