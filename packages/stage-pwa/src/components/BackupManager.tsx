import { useRef, useState } from 'react'
import { CAPABILITIES, HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { useDialogStore } from '../store/useDialogStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useNow } from '../lib/useNow'
import {
  buildWorkspaceSnapshot,
  downloadWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} from '../lib/workspaceSnapshot'
import { ServerBackupTargets } from './ServerBackupTargets'
import { Badge, Button, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'

/** Same look as the "Sicherung des Stage-Servers" heading above it (ui Section). */
const SUBHEADING = 'text-xs font-bold uppercase tracking-widest text-ink-faint'

/**
 * A focused view of just the band's backup-capability plugin(s), for the "gated built-in
 * mode" version of Backup (docs/02): StageBoard itself never triggers a backup, it only
 * shows whether a backup plugin is installed and currently reachable. Deliberately not a
 * duplicate of PluginManager's full install/enable/remove flow - that's still the one
 * place to actually manage plugins - this is a status view, reached only when a backup
 * capability already exists to report on (see availableModes in lib/modes.ts).
 */
export function BackupManager() {
  const { t } = useTranslation('system')
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const now = useNow()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const confirm = useDialogStore((state) => state.confirm)
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const backupPlugins = installed.filter((plugin) =>
    plugin.capabilities.includes(CAPABILITIES.backup),
  )

  async function handleExport() {
    setSnapshotStatus(t('bk.creating'))
    try {
      const snapshot = await buildWorkspaceSnapshot(workspaceId)
      downloadWorkspaceSnapshot(snapshot)
      setSnapshotStatus(t('bk.downloaded'))
    } catch (err) {
      setSnapshotStatus(err instanceof Error ? err.message : t('bk.failed'))
    }
  }

  async function handleImportFile(file: File) {
    const confirmed = await confirm(t('bk.restoreConfirm', { file: file.name }), {
      confirmLabel: t('bk.restore'),
    })
    if (!confirmed) {
      return
    }
    setSnapshotStatus(t('bk.restoring'))
    try {
      const raw = await file.text()
      const snapshot = parseWorkspaceSnapshot(raw)
      await restoreWorkspaceSnapshot(snapshot, workspaceId)
      setSnapshotStatus(t('bk.restored'))
    } catch (err) {
      setSnapshotStatus(err instanceof Error ? err.message : t('bk.restoreFailed'))
    }
  }

  function healthLabel(plugin: PluginInstallation): string {
    if (plugin.runtime === 'client') return t('bk.onTablet')
    const entry = health.plugins[plugin.id]
    if (!entry) return t('bk.noHeartbeat')
    if (entry.status !== 'online') return entry.message ?? entry.status
    if (now - entry.lastSeenAt > HEALTH_TIMEOUT_MS) return t('bk.staleHeartbeat')
    return 'online'
  }

  return (
    // A part of System → Stage-Server since the System split (2026-10-16), no tab of its own; the
    // card and its "Backup" heading come from there (SystemSettings Group).
    <div className="flex flex-col text-ink">
      <ServerBackupTargets />

      {backupPlugins.length > 0 && <h4 className={`mb-2 mt-3 ${SUBHEADING}`}>{t('bk.plugins')}</h4>}
      <div className="space-y-2">
        {backupPlugins.map((plugin) => (
          <div
            key={plugin.id}
            className="flex flex-wrap items-center gap-3 rounded-container border border-line bg-surface px-4 py-3 shadow-sb"
          >
            <div className="flex-1">
              <p className="font-semibold">
                {plugin.name}{' '}
                <span className="text-xs font-normal text-ink-faint">v{plugin.version}</span>
              </p>
              <p className="text-xs text-ink-muted">{healthLabel(plugin)}</p>
            </div>
            <Badge tone={healthLabel(plugin) === 'online' ? 'accent' : 'neutral'}>{plugin.enabled ? t('bk.active') : t('bk.disabled')}</Badge>
          </div>
        ))}
      </div>

      <div className="mb-2 mt-3 flex items-center gap-1">
        <h4 className={SUBHEADING}>{t('bk.snapshots')}</h4>
        <InfoHint
          label={t('bk.snapshotsLabel')}
          text={t('bk.snapshotsInfo')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void handleExport()}>
          {t('bk.download')}
        </Button>
        <Button onClick={() => fileInputRef.current?.click()}>
          {t('bk.restoreFile')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleImportFile(file)
          }}
        />
      </div>
      {snapshotStatus && <p className="mt-2 text-sm text-ink-muted">{snapshotStatus}</p>}
    </div>
  )
}
