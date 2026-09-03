import { useAppModeStore, type SessionMode } from '../store/useAppModeStore'

const OPTIONS: { mode: SessionMode; label: string; hint: string }[] = [
  { mode: 'gig', label: 'Gig', hint: 'Master-Token, geteilte Show-Uhr, Backing-Track-Plugin' },
  { mode: 'practice', label: 'Solo Üben', hint: 'Rein lokal, Wiedergabe über dieses Gerät' },
]

/**
 * Gig vs. Practice (useAppModeStore.ts) - per-device, so switching this on one tablet never
 * affects anyone else's. Deliberately not gated behind Master-Kontrolle: it's a decision about
 * *this device*, unrelated to who's steering the live show.
 */
export function SessionModeControl() {
  const mode = useAppModeStore((state) => state.mode)
  const setMode = useAppModeStore((state) => state.setMode)
  const active = OPTIONS.find((option) => option.mode === mode)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => setMode(option.mode)}
            className={`h-12 rounded-sb text-base font-semibold ${
              mode === option.mode
                ? 'bg-accent text-accent-ink'
                : 'bg-control text-ink-soft hover:bg-control-hover'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {active && <p className="text-xs text-ink-faint">{active.hint}</p>}
    </div>
  )
}
