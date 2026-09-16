import { useAppModeStore, type SessionMode } from '../store/useAppModeStore'
import { useShowMode } from '../lib/showMode'

const OPTIONS: { mode: SessionMode; label: string; hint: string }[] = [
  { mode: 'gig', label: 'Gig', hint: 'Master-Token, geteilte Show-Uhr, Backing-Track-Plugin' },
  { mode: 'practice', label: 'Solo Üben', hint: 'Rein lokal, Wiedergabe über dieses Gerät' },
]

const BLOCKED_TITLE = 'Moduswechsel erst möglich, wenn gerade kein Song läuft'

/**
 * Gig vs. Practice (useAppModeStore.ts) - per-device, so switching this on one tablet never
 * affects anyone else's. Deliberately not gated behind Master-Kontrolle: it's a decision about
 * *this device*, unrelated to who's steering the live show.
 *
 * Safety feature (Marco, explicit request): disabled while the current mode has a song actively
 * playing - `useAppModeStore.setMode` itself already refuses the switch either way, this is
 * just the "tell the user why, don't just make it disappear" surface for that same rule (same
 * instinct as e.g. LibraryView's disabled "+" button).
 */
export function SessionModeControl() {
  const mode = useAppModeStore((state) => state.mode)
  const setMode = useAppModeStore((state) => state.setMode)
  const { playbackStatus } = useShowMode()
  const isPlaying = playbackStatus === 'playing'
  const active = OPTIONS.find((option) => option.mode === mode)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const blocked = isPlaying && option.mode !== mode
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
      {active && <p className="text-xs text-ink-faint">{isPlaying ? BLOCKED_TITLE : active.hint}</p>}
    </div>
  )
}
