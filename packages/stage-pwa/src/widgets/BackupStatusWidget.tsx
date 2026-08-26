import { CAPABILITIES } from 'shared-types'
import { useCapabilities } from '../lib/useCapabilities'
import type { CapabilityStatus } from '../lib/capabilities'

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: 'Backup online',
  degraded: 'Backup nicht erreichbar',
  missing: 'Kein Backup-Plugin',
}

const STATUS_DOT: Record<CapabilityStatus, string> = {
  available: 'bg-green-500',
  degraded: 'bg-control-strong-hover',
  missing: 'bg-control-strong-hover',
}

/** A glanceable live indicator; the full picture lives in the "Backup" mode. */
export function BackupStatusWidget() {
  const capabilities = useCapabilities()
  const status = capabilities.get(CAPABILITIES.backup) ?? 'missing'

  return (
    <div className="flex h-full items-center gap-2 text-sm text-ink-soft">
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </div>
  )
}
