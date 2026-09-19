import { useAppModeStore, type SessionMode } from '../store/useAppModeStore'
import { useShowStateStore } from '../store/useShowStateStore'

const OPTIONS: { mode: SessionMode; label: string; hint: string }[] = [
  { mode: 'gig', label: 'Gig', hint: 'Master-Token, geteilte Show-Uhr, Backing-Track-Plugin' },
  { mode: 'practice', label: 'Solo Üben', hint: 'Rein lokal, Wiedergabe über dieses Gerät' },
]

const BLOCKED_TITLE = 'Wechsel zu Solo Üben erst möglich, wenn gerade kein Song läuft'

/**
 * Gig vs. Practice (useAppModeStore.ts) - per-device, so switching this on one tablet never
 * affects anyone else's. Deliberately not gated behind Master-Kontrolle: it's a decision about
 * *this device*, unrelated to who's steering the live show.
 *
 * Safety feature (Marco, explicit request): the Solo Üben button is disabled while the shared
 * show is playing in Gig mode - `useAppModeStore.setMode` itself already refuses that switch,
 * this is just the "tell the user why, don't just make it disappear" surface for that same rule
 * (same instinct as e.g. LibraryView's disabled "+" button). The other direction (Solo Üben ->
 * Gig) is never blocked: it just force-stops this device's own local practice playback (#233).
 */
export function SessionModeControl() {
  const mode = useAppModeStore((state) => state.mode)
  const setMode = useAppModeStore((state) => state.setMode)
  const gigPlaying = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const isBlocked = mode === 'gig' && gigPlaying
  const active = OPTIONS.find((option) => option.mode === mode)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const blocked = isBlocked && option.mode !== mode
          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => setMode(option.mode)}
              disabled={blocked}
              title={blocked ? BLOCKED_TITLE : undefined}
              className={`h-12 rounded-sb text-base font-semibold disabled:opacity-40 ${
                mode === option.mode
                  ? 'bg-accent text-accent-ink'
                  : 'bg-control text-ink-soft hover:bg-control-hover'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {active && <p className="text-xs text-ink-faint">{isBlocked ? BLOCKED_TITLE : active.hint}</p>}
    </div>
  )
}
