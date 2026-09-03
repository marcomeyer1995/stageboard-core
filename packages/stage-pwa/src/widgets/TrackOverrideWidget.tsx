import { useShowMode } from '../lib/showMode'

/**
 * Swaps which track of the current variant plays, on top of the setlist's own lasting default
 * (SetlistEntry.trackId) - not solo-practice-only, despite living next to ShowTransportWidget's
 * Practice-mode audio: e.g. tonight's second guitarist couldn't make it, so the shared PA feed
 * needs the "1 guitar" mix instead of the setlist's usual "no guitar" one, and this is the
 * fastest way to swap it for just this show without editing the setlist itself. In Gig mode
 * that write is Master-gated and shared (ShowState.trackOverride, everyone hears the same
 * feed); in Practice mode it's a purely personal, local choice (only this device's speakers
 * are affected) - see useShowMode.ts.
 */
export function TrackOverrideWidget() {
  const { queue, trackOverride, canControl, setTrackOverride } = useShowMode()
  const { currentVariant } = queue

  if (!currentVariant || currentVariant.tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Kein Track angehängt
      </div>
    )
  }

  if (currentVariant.tracks.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Nur ein Track vorhanden - kein Wechsel nötig
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      <span className="text-xs uppercase tracking-widest text-ink-faint">
        Track für „{currentVariant.label}"
      </span>
      <select
        value={trackOverride ?? ''}
        disabled={!canControl}
        onChange={(e) => setTrackOverride(e.target.value || null)}
        className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink disabled:opacity-40"
      >
        <option value="">Standard (Setlist)</option>
        {currentVariant.tracks.map((track) => (
          <option key={track.id} value={track.id}>
            {track.label}
          </option>
        ))}
      </select>
    </div>
  )
}
