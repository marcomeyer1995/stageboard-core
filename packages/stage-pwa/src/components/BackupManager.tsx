import { CAPABILITIES, HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { usePluginsStore } from '../store/usePluginsStore'
import { useNow } from '../lib/useNow'

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

  const backupPlugins = installed.filter((plugin) =>
    plugin.capabilities.includes(CAPABILITIES.backup),
  )

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
    </div>
  )
}
