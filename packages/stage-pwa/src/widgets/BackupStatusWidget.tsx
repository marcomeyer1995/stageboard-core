import { CAPABILITIES } from 'shared-types'
import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
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
  // Chosen over cq units/discrete tiers after Marco compared all three live (2026-09-14,
  // see the widget-font-autofit memory).
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 10, max: 40 },
    [status],
  )

  return (
    <div ref={containerRef} className="flex h-full items-center overflow-hidden text-ink-soft">
      <span ref={textRef} style={{ fontSize }} className="flex items-center gap-[0.4em] whitespace-nowrap">
        <span
          className={`inline-block flex-shrink-0 rounded-full ${STATUS_DOT[status]}`}
          style={{ width: '0.6em', height: '0.6em' }}
        />
        {STATUS_LABEL[status]}
      </span>
    </div>
  )
}
