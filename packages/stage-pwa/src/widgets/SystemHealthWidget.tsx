import type { CapabilityStatus } from '../lib/capabilities'
import { useCapabilities } from '../lib/useCapabilities'

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

/**
 * The "Cockpit-Dashboard" traffic-light overview from docs/08 Use Case 3.1 - every
 * capability the band's installed plugins provide, at a glance. Crew/tech-facing (see
 * relevantRoles in registry.tsx), used during setup/soundcheck, not something a
 * performing musician needs cluttering their own Station.
 */
export function SystemHealthWidget() {
  const capabilities = useCapabilities()
  const entries = [...capabilities.entries()]

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
    </div>
  )
}
