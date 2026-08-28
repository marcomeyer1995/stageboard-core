import { useRef, useState } from 'react'
import { CAPABILITIES, HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { usePluginsStore } from '../store/usePluginsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useNow } from '../lib/useNow'
import {
  buildWorkspaceSnapshot,
  downloadWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} from '../lib/workspaceSnapshot'

/**
 * A focused view of just the band's backup-capability plugin(s), for the "gated built-in
 * mode" version of Backup (docs/02): StageBoard itself never triggers a backup, it only
 * shows whether a backup plugin is installed and currently reachable. Deliberately not a
 * duplicate of PluginManager's full install/enable/remove flow - that's still the one
 * place to actually manage plugins - this is a status view, reached only when a backup
 * capability already exists to report on (see availableModes in lib/modes.ts).
 */
export function BackupManager() {
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const now = useNow()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const backupPlugins = installed.filter((plugin) =>
    plugin.capabilities.includes(CAPABILITIES.backup),
  )

  async function handleExport() {
    setSnapshotStatus('Erstelle Backup…')
    try {
      const snapshot = await buildWorkspaceSnapshot(workspaceId)
      downloadWorkspaceSnapshot(snapshot)
      setSnapshotStatus('Backup heruntergeladen.')
    } catch (err) {
      setSnapshotStatus(err instanceof Error ? err.message : 'Backup fehlgeschlagen.')
    }
  }

  async function handleImportFile(file: File) {
    if (!window.confirm(`"${file.name}" wiederherstellen und mit den lokalen Daten zusammenführen?`)) {
      return
    }
    setSnapshotStatus('Stelle Backup wieder her…')
    try {
      const raw = await file.text()
      const snapshot = parseWorkspaceSnapshot(raw)
      await restoreWorkspaceSnapshot(snapshot, workspaceId)
      setSnapshotStatus('Backup wiederhergestellt.')
    } catch (err) {
      setSnapshotStatus(err instanceof Error ? err.message : 'Wiederherstellung fehlgeschlagen.')
    }
  }

  function healthLabel(plugin: PluginInstallation): string {
    if (plugin.runtime === 'client') return 'läuft auf dem Tablet'
    const entry = health.plugins[plugin.id]
    if (!entry) return 'kein Heartbeat — Stage-Server offline?'
    if (entry.status !== 'online') return entry.message ?? entry.status
    if (now - entry.lastSeenAt > HEALTH_TIMEOUT_MS) return 'Heartbeat veraltet'
    return 'online'
  }

  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Backup</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Automatische Backups laufen über ein installiertes Backup-Plugin, nicht über
        StageBoard selbst - hier siehst du nur, ob eins installiert und gerade erreichbar
        ist. Ein Plugin verwalten geht unter „Plugins".
      </p>

      <div className="space-y-2">
        {backupPlugins.length === 0 && (
          <p className="text-sm text-ink-faint">Kein Backup-Plugin installiert.</p>
        )}
        {backupPlugins.map((plugin) => (
          <div
            key={plugin.id}
            className="flex flex-wrap items-center gap-3 rounded-sb border border-line bg-surface px-4 py-3 shadow-sb"
          >
            <div className="flex-1">
              <p className="font-semibold">
                {plugin.name}{' '}
                <span className="text-xs font-normal text-ink-faint">v{plugin.version}</span>
              </p>
              <p className="text-xs text-ink-muted">{healthLabel(plugin)}</p>
            </div>
            <span
              className={`rounded-sb-sm px-2 py-1 text-xs font-medium ${
                healthLabel(plugin) === 'online'
                  ? 'bg-accent text-accent-ink'
                  : 'bg-control-strong text-ink'
              }`}
            >
              {plugin.enabled ? 'Aktiv' : 'Deaktiviert'}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mb-1 mt-8 text-xl font-bold">Lokale Snapshots</h2>
      <p className="mb-4 text-sm text-ink-muted">
        Unabhängig von einem Backup-Plugin: ein vollständiger Datei-Dump dieses Workspaces
        (Songs, Setlists, Dashboards, Profile, Plugins, Show-Log) zum lokalen Speichern und
        Wiederherstellen - ideal vor größeren Änderungen oder Tourbeginn.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleExport()}
          className="rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink"
        >
          Backup herunterladen
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-sb border border-line bg-surface px-4 py-2 font-semibold"
        >
          Backup wiederherstellen…
        </button>
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
