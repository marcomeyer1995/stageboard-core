import type { ShowLogEvent } from 'shared-types'
import { useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'

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

export function PostShowReport() {
  const events = useShowLogStore((state) => state.events)
  const profiles = useProfilesStore((state) => state.profiles)
  const shows = groupByShow(events)

  function authorName(authorProfileId: string | null): string {
    if (!authorProfileId) return 'Unbekannt'
    return profiles.find((profile) => profile.id === authorProfileId)?.name ?? 'Unbekannt'
  }

  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
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
            className="rounded-sb border border-line bg-surface p-4 shadow-sb"
          >
            <h2 className="mb-3 font-semibold">{fmtTime(show.startedAt)}</h2>
            <div className="space-y-1 text-sm">
              {show.events
                .filter((event) => event.type !== 'show-started')
                .sort((a, b) => a.at - b.at)
                .map((event) => {
                  if (event.type === 'song-played') {
                    return (
                      <div key={event.id} className="flex items-center justify-between gap-2">
                        <span>{event.songTitle}</span>
                        <span className="text-ink-faint">
                          {fmtTime(event.at)} · {fmtDuration(event.activeMs)}
                        </span>
                      </div>
                    )
                  }
                  if (event.type === 'capability-changed') {
                    return (
                      <div key={event.id} className="text-amber-500">
                        ⚠ {event.capability}: {event.from} → {event.to} ({fmtTime(event.at)})
                      </div>
                    )
                  }
                  return (
                    <div key={event.id} className="text-ink-soft">
                      📝 {event.text} — {authorName(event.authorProfileId)} ({fmtTime(event.at)})
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
