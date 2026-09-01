import type { CapabilityStatus } from '../lib/capabilities'
import { useCapabilities } from '../lib/useCapabilities'
import { useNow } from '../lib/useNow'
import { useClockSyncStore } from '../store/useClockSyncStore'

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: 'Online',
  degraded: 'Gestört',
  missing: 'Fehlt',
}

const STATUS_DOT: Record<CapabilityStatus, string> = {
  available: 'bg-green-500',
  degraded: 'bg-amber-500',
  missing: 'bg-control-strong-hover',
}

/** Above this spread between a burst's fastest and slowest round trip, the offset is still
 * the best available estimate but noticeably less trustworthy - flagged amber rather than
 * treated as an error (see useClockSyncStore's jitterMs doc comment). Picked as "clearly
 * more than normal LAN noise", not derived from a spec - docs/00 §4 targets sub-5ms
 * *execution*, not a hard bound on handshake jitter itself. */
const JITTER_WARN_THRESHOLD_MS = 20

/**
 * The "Cockpit-Dashboard" traffic-light overview from docs/08 Use Case 3.1 - every
 * capability the band's installed plugins provide, at a glance, plus this tablet's own
 * NTP-style clock sync to the Stage-Server (#31, docs/00 §4) - not a plugin capability, but
 * the same kind of "can I trust this system status" question. Crew/tech-facing (see
 * relevantRoles in registry.tsx), used during setup/soundcheck, not something a
 * performing musician needs cluttering their own Station.
 */
export function SystemHealthWidget() {
  const capabilities = useCapabilities()
  const entries = [...capabilities.entries()]
  const { offsetMs, jitterMs, lastSyncedAt } = useClockSyncStore()
  const now = useNow()

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto text-sm text-ink-soft">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">System-Status</p>
      {entries.length === 0 && <p className="text-ink-faint">Keine Plugins installiert.</p>}
      {entries.map(([capability, status]) => (
        <div
          key={capability}
          className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-2 py-1"
        >
          <span className="text-ink">{capability}</span>
          <span className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        </div>
      ))}

      <p className="mt-2 text-xs font-bold uppercase tracking-widest text-ink-faint">Uhrzeit-Sync</p>
      <div className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-2 py-1">
        <span className="text-ink">Stage-Server</span>
        {lastSyncedAt === null ? (
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-control-strong-hover" />
            Noch nicht synchronisiert
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                jitterMs !== null && jitterMs > JITTER_WARN_THRESHOLD_MS ? 'bg-amber-500' : 'bg-green-500'
              }`}
            />
            {`Offset ${offsetMs >= 0 ? '+' : ''}${Math.round(offsetMs)} ms · Jitter ${jitterMs === null ? '?' : Math.round(jitterMs)} ms · vor ${Math.max(0, Math.round((now - lastSyncedAt) / 1000))}s`}
          </span>
        )}
      </div>
    </div>
  )
}
