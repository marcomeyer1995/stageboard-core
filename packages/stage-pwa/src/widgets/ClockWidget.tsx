import { useNow } from '../lib/useNow'

/** A prominent wall-clock readout for stage timing (#23) - unlike SyncCheckWidget's
 * server-synced flash, this is plain local time, the same clock the venue's own wall
 * clock shows. */
export function ClockWidget() {
  const now = useNow(1000)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <span className="text-4xl font-bold tabular-nums text-ink">
        {new Date(now).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  )
}
