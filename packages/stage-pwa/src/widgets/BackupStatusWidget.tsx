import { CAPABILITIES } from 'shared-types'
import { useCapabilities } from '../lib/useCapabilities'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import type { CapabilityStatus } from '../lib/capabilities'
import { DEFAULT_SIZE_RATIO, type BackupStatusConfig } from './backupStatusConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

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

/** A glanceable live indicator; the full picture lives in the "Backup" mode.
 *
 * Sized as a ratio of the device-wide default (System/Einstellungen), not auto-fit to the
 * tile - a fixed, user-controlled size instead of one that changes as the tile is resized
 * (Marco, 2026-09-14: auto-fit "makes the dashboard look strange... Resizing is weird"). */
export function BackupStatusWidget({ config }: { config: BackupStatusConfig }) {
  const capabilities = useCapabilities()
  const status = capabilities.get(CAPABILITIES.backup) ?? 'missing'
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  return (
    <div className="flex h-full items-center overflow-hidden text-ink-soft">
      <span style={{ fontSize }} className="flex items-center gap-[0.4em] whitespace-nowrap">
        <span
          className={`inline-block flex-shrink-0 rounded-full ${STATUS_DOT[status]}`}
          style={{ width: '0.6em', height: '0.6em' }}
        />
        {STATUS_LABEL[status]}
      </span>
    </div>
  )
}

export function BackupStatusConfigPanel({
  config,
  onChange,
}: {
  config: BackupStatusConfig
  onChange: (next: BackupStatusConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
