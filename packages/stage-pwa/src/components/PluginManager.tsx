import { useState, type ComponentType } from 'react'
import { HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { usePluginsStore } from '../store/usePluginsStore'
import { capabilitiesLabel, installableCatalog, isTestPlugin, pluginKind, type PluginKind } from '../lib/pluginCatalog'
import { useDialogStore } from '../store/useDialogStore'
import { useNow } from '../lib/useNow'
import { AnnouncementTextsDialog } from './AnnouncementTextsDialog'
import { SpeechVoiceDialog } from './SpeechVoiceDialog'
import { ActionMenu, Badge, Button, Switch } from './ui'

/** Plugins with band-wide settings of their own - opened with "Einstellungen" on their card. */
const SETTINGS: Record<string, ComponentType<{ onClose: () => void }>> = {
  'piper-speech': SpeechVoiceDialog,
  'section-announcements': AnnouncementTextsDialog,
}

const HEADER: Record<PluginKind, { title: string; text: string; empty: string }> = {
  extensions: {
    title: 'Add-ons',
    text: 'Software ohne eigenes Gerät für die ganze Band, z. B. Sprachausgabe, Ansagen oder Spuren trennen - Geräte stehen unter Bühnentechnik. Installierte Add-ons gelten auf allen Tablets und dem Stage-Server; deaktivierte verschwinden aus der Widget-Bibliothek.',
    empty: 'Noch kein Add-on installiert.',
  },
  drivers: {
    title: 'Treiber',
    text: 'Damit StageBoard ein Gerät steuern kann (Amp, Mischpult, Looper, MIDI). Ein Gerät oben braucht seinen Treiber - „Neues Gerät“ installiert ihn mit.',
    empty: 'Noch kein Treiber installiert.',
  },
  test: {
    title: 'Test-Plugins',
    text: 'Platzhalter, die nur protokollieren, was sie bekommen - ein Mischpult, Licht oder Backup, das es nicht gibt. Nur zum Ausprobieren; installieren lassen sie sich nur in der Dev-App.',
    empty: 'Kein Test-Plugin installiert.',
  },
}

/**
 * Plugins of one kind (System split, 2026-10-16): Add-ons get their own tab, gear drivers
 * sit under Bühnentechnik next to the devices they drive, the test stand-ins under Diagnose. Only
 * Add-ons is a page of its own; the other two are a part of their page.
 */
export function PluginManager({ kind = 'extensions' }: { kind?: PluginKind }) {
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const install = usePluginsStore((state) => state.install)
  const setEnabled = usePluginsStore((state) => state.setEnabled)
  const uninstall = usePluginsStore((state) => state.uninstall)
  const confirm = useDialogStore((state) => state.confirm)
  const now = useNow()
  const [settingsOf, setSettingsOf] = useState<string | null>(null)
  const Settings = settingsOf ? SETTINGS[settingsOf] : undefined

  function healthLabel(plugin: PluginInstallation): string {
    if (plugin.runtime === 'client') return 'läuft auf dem Tablet'
    const entry = health.plugins[plugin.id]
    if (!entry) return 'kein Heartbeat — Stage-Server offline?'
    if (entry.status !== 'online') return entry.message ?? entry.status
    if (now - entry.lastSeenAt > HEALTH_TIMEOUT_MS) return 'Heartbeat veraltet'
    return 'online'
  }

  const header = HEADER[kind]
  const mine = installed.filter((plugin) => pluginKind(plugin) === kind)
  const notInstalled = installableCatalog().filter((candidate) => pluginKind(candidate) === kind && !installed.some((plugin) => plugin.id === candidate.id))
  const page = kind === 'extensions'

  return (
    <section aria-label={header.title} className={page ? 'h-full overflow-y-auto sb-app-bg p-4 text-ink' : 'text-ink'}>
      {page ? <h1 className="mb-1 text-2xl font-bold">{header.title}</h1> : <h2 className="mb-1 text-lg font-bold">{header.title}</h2>}
      <p className="mb-4 text-sm text-ink-muted">{header.text}</p>

      <div className="mb-6 space-y-2">
        {mine.length === 0 && <p className="text-sm text-ink-faint">{header.empty}</p>}
        {mine.map((plugin) => (
          <div key={plugin.id} className="flex flex-col gap-3 rounded-container border border-line bg-surface px-4 py-3 shadow-sb">
            {/* Text across the full width, the controls in one row below - beside the text they
                squeezed name and description into a narrow column on the phone (Marco, 2026-10-07). */}
            <div className="min-w-0">
              <p className="font-semibold">
                {plugin.name} <span className="text-sm font-normal text-ink-faint">v{plugin.version}</span>{' '}
                {/* A stand-in that only logs (lib/pluginCatalog.ts TEST_PLUGIN_IDS) - never mistaken for the real thing. */}
                {isTestPlugin(plugin.id) && <Badge tone="warning">Test</Badge>}
              </p>
              <p className="text-sm text-ink-muted">
                {capabilitiesLabel(plugin.capabilities) || 'keine Funktionen'} · {healthLabel(plugin)}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* On/off = a switch (docs/15 D5), never a button whose text flips. */}
              <Switch layout="inline" label="Aktiv" checked={plugin.enabled} onChange={(on) => void setEnabled(plugin.id, on)} />
              <span className="flex flex-wrap gap-2">
                {SETTINGS[plugin.id] && <Button onClick={() => setSettingsOf(plugin.id)}>Einstellungen</Button>}
                {/* Entfernen behind ⋯ like every list row - a red button on every card was nine red
                    buttons on one page (System cleanup, 2026-10-16). */}
                <ActionMenu
                  title={plugin.name}
                  actions={[
                    {
                      label: 'Entfernen',
                      danger: true,
                      onClick: async () => {
                        if (await confirm(`"${plugin.name}" entfernen?`, { confirmLabel: 'Entfernen', danger: true })) void uninstall(plugin.id)
                      },
                    },
                  ]}
                />
              </span>
            </div>
          </div>
        ))}
      </div>

      {Settings && <Settings onClose={() => setSettingsOf(null)} />}

      {notInstalled.length > 0 && <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">Verfügbar</h3>}
      <div className="space-y-2">
        {notInstalled.map((candidate) => (
          <div
            key={candidate.id}
            className="flex items-center gap-3 rounded-container border border-line bg-surface px-4 py-3 shadow-sb"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{candidate.name}</p>
              <p className="text-sm text-ink-muted">{capabilitiesLabel(candidate.capabilities)}</p>
            </div>
            <Button onClick={() =>
                void install({ ...candidate, enabled: true, installedAt: Date.now() })
              }>
              Installieren
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
