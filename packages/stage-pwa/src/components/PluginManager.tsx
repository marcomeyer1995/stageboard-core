import { CAPABILITIES, HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { usePluginsStore } from '../store/usePluginsStore'
import { useNow } from '../lib/useNow'

/**
 * The plugins a band can add without a plugin repository yet. Installing one writes a
 * document that replicates across the stage mesh - every other tablet and the
 * Stage-Server pick it up (docs/01).
 */
const CATALOG: Array<Omit<PluginInstallation, 'installedAt' | 'enabled'>> = [
  {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    runtime: 'server',
    capabilities: [CAPABILITIES.mixer],
  },
  {
    id: 'generic-webmidi',
    name: 'Generic WebMIDI Input',
    version: '0.0.1',
    runtime: 'client',
    capabilities: [CAPABILITIES.midiInput],
  },
  {
    id: 'mock-lighting',
    name: 'Mock Lighting (DMX)',
    version: '0.0.1',
    runtime: 'server',
    capabilities: [CAPABILITIES.lighting, CAPABILITIES.showControl],
  },
  {
    id: 'mock-backup',
    name: 'Mock Backup',
    version: '0.0.1',
    runtime: 'server',
    capabilities: [CAPABILITIES.backup],
  },
]

export function PluginManager() {
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const install = usePluginsStore((state) => state.install)
  const setEnabled = usePluginsStore((state) => state.setEnabled)
  const uninstall = usePluginsStore((state) => state.uninstall)
  const now = useNow()

  function healthLabel(plugin: PluginInstallation): string {
    if (plugin.runtime === 'client') return 'läuft auf dem Tablet'
    const entry = health.plugins[plugin.id]
    if (!entry) return 'kein Heartbeat — Stage-Server offline?'
    if (entry.status !== 'online') return entry.message ?? entry.status
    if (now - entry.lastSeenAt > HEALTH_TIMEOUT_MS) return 'Heartbeat veraltet'
    return 'online'
  }

  const notInstalled = CATALOG.filter(
    (candidate) => !installed.some((plugin) => plugin.id === candidate.id),
  )

  return (
    <div className="h-dvh overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="mb-1 text-2xl font-bold">Plugins</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Installierte Plugins replizieren über das Bühnen-Netz zu allen Tablets und zum
        Stage-Server. Deaktivierte Plugins verschwinden aus der Widget-Bibliothek.
      </p>

      <div className="mb-6 space-y-2">
        {installed.length === 0 && (
          <p className="text-sm text-ink-faint">Noch keine Plugins installiert.</p>
        )}
        {installed.map((plugin) => (
          <div
            key={plugin.id}
            className="flex flex-wrap items-center gap-3 rounded-sb border border-line bg-surface px-4 py-3 shadow-sb"
          >
            <div className="flex-1">
              <p className="font-semibold">
                {plugin.name}{' '}
                <span className="text-xs font-normal text-ink-faint">v{plugin.version}</span>
              </p>
              <p className="text-xs text-ink-muted">
                {plugin.capabilities.join(', ') || 'keine Capabilities'} · {healthLabel(plugin)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void setEnabled(plugin.id, !plugin.enabled)}
              className={`rounded-sb-sm px-3 py-1 text-xs font-medium ${
                plugin.enabled
                  ? 'bg-accent text-accent-ink hover:bg-accent-hover'
                  : 'bg-control-strong text-ink hover:bg-control-strong-hover'
              }`}
            >
              {plugin.enabled ? 'Aktiv' : 'Deaktiviert'}
            </button>
            <button
              type="button"
              onClick={() => void uninstall(plugin.id)}
              className="rounded-sb-sm bg-control px-3 py-1 text-xs text-ink-soft hover:bg-control-hover"
            >
              Entfernen
            </button>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">
        Verfügbar
      </h2>
      <div className="space-y-2">
        {notInstalled.length === 0 && (
          <p className="text-sm text-ink-faint">Alles aus dem Katalog ist installiert.</p>
        )}
        {notInstalled.map((candidate) => (
          <div
            key={candidate.id}
            className="flex items-center gap-3 rounded-sb border border-line bg-surface px-4 py-3 shadow-sb"
          >
            <div className="flex-1">
              <p className="font-semibold">{candidate.name}</p>
              <p className="text-xs text-ink-muted">{candidate.capabilities.join(', ')}</p>
            </div>
            <button
              type="button"
              onClick={() =>
                void install({ ...candidate, enabled: true, installedAt: Date.now() })
              }
              className="rounded-sb-sm bg-control-strong px-3 py-1 text-xs font-medium text-ink hover:bg-control-strong-hover"
            >
              Installieren
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
