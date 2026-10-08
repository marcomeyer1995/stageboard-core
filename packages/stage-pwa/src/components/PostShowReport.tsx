import type { ShowLogEvent } from 'shared-types'
import { useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { Icon } from './Icon'

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
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
      {technical.length > 0 && (
        <details className="mt-4">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-warn">
            Technik ({technical.length})
          </summary>
          <div className="space-y-1 text-sm text-warn">
            {technical.map((event) => (
              <div key={event.id}>
                <Icon name="warning" className="mr-1" />
                {event.capability}: {event.from} → {event.to} ({fmtTime(event.at)})
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  )
}

export function PostShowReport() {
  const events = useShowLogStore((state) => state.events)
  const profiles = useProfilesStore((state) => state.profiles)
  const shows = groupByShow(events)

  function authorName(authorProfileId: string | null): string {
    if (!authorProfileId) return 'Unbekannt'
    return profiles.find((profile) => profile.id === authorProfileId)?.name ?? 'Unbekannt'
  }

  return (
    <div className="h-full overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Nachbericht</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Automatisch erfasst: wann eine Show begann, welche Songs wirklich gespielt wurden
        (mindestens 20 Sekunden aktiv), technische Ereignisse und Notizen von Band und
        Crew.
      </p>

      {shows.length === 0 && <p className="text-sm text-ink-faint">Noch keine Show erfasst.</p>}

      <div className="space-y-6">
        {shows.map((show) => (
          <div
            key={show.showId}
            className="rounded-container border border-line bg-surface p-4 shadow-sb"
          >
            <ShowSections show={show} authorName={authorName} />
          </div>
        ))}
      </div>
    </div>
  )
}
