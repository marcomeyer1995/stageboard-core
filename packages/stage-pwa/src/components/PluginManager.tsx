import { pluginName } from '../lib/pluginCatalog'
import { useState, type ComponentType } from 'react'
import { API_VERSION_MISMATCH_CODE, apiVersionFits, HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { usePluginsStore } from '../store/usePluginsStore'
import { capabilitiesLabel, installableCatalog, isTestPlugin, pluginKind, type PluginKind } from '../lib/pluginCatalog'
import { useDialogStore } from '../store/useDialogStore'
import { useServerNow } from '../lib/useNow'
import { AnnouncementTextsDialog } from './AnnouncementTextsDialog'
import { SpeechVoiceDialog } from './SpeechVoiceDialog'
import { RepositoryAddonInstall } from './RepositoryAddonInstall'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { ActionMenu, Badge, Button, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'

/** Plugins with band-wide settings of their own - opened with "Einstellungen" on their card. */
const SETTINGS: Record<string, ComponentType<{ onClose: () => void }>> = {
  'piper-speech': SpeechVoiceDialog,
  'section-announcements': AnnouncementTextsDialog,
}


/**
 * Plugins of one kind (System split, 2026-10-16): Add-ons get their own tab, gear drivers
 * sit under Bühnentechnik next to the devices they drive, the test stand-ins under Diagnose. Only
 * Add-ons is a page of its own; the other two are a part of their page.
 */
export function PluginManager({ kind = 'extensions' }: { kind?: PluginKind }) {
  const { t } = useTranslation('addons')
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const install = usePluginsStore((state) => state.install)
  const setEnabled = usePluginsStore((state) => state.setEnabled)
  const uninstall = usePluginsStore((state) => state.uninstall)
  const confirm = useDialogStore((state) => state.confirm)
  // `lastSeenAt` is the Stage-Server's stamp - compared in its time, not this device's (the Fire's clock
  // runs 18 s fast: every add-on read "Heartbeat veraltet", 2026-11-14).
  const now = useServerNow()
  const [settingsOf, setSettingsOf] = useState<string | null>(null)
  // Only the admin installs from a repository (docs/32 §12a) - the host refuses anyone else too.
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const Settings = settingsOf ? SETTINGS[settingsOf] : undefined

  function healthLabel(plugin: PluginInstallation): string {
    if (!apiVersionFits(plugin)) return t('apiVersionMismatch')
    if (plugin.runtime === 'client') return t('onTablet')
    const entry = health.plugins[plugin.id]
    if (!entry) return t('noHeartbeat')
    if (entry.status !== 'online') return entry.message === API_VERSION_MISMATCH_CODE ? t('apiVersionMismatch') : (entry.message ?? entry.status)
    if (now - entry.lastSeenAt > HEALTH_TIMEOUT_MS) return t('staleHeartbeat')
    return 'online'
  }

  const header = { title: t(`${kind}.title`), text: t(`${kind}.text`), empty: t(`${kind}.empty`) }
  const mine = installed.filter((plugin) => pluginKind(plugin) === kind)
  const notInstalled = installableCatalog().filter((candidate) => pluginKind(candidate) === kind && !installed.some((plugin) => plugin.id === candidate.id))
  const page = kind === 'extensions'

  return (
    <section aria-label={header.title} className={page ? 'h-full overflow-y-auto sb-app-bg p-4 text-ink' : 'text-ink'}>
      <div className="mb-4 flex items-center gap-1">
        {page ? <h1 className="text-2xl font-bold">{header.title}</h1> : <h2 className="text-lg font-bold">{header.title}</h2>}
        <InfoHint text={header.text} label={t('explain', { title: header.title })} />
      </div>

      <div className="mb-6 space-y-2">
        {mine.length === 0 && <p className="text-sm text-ink-faint">{header.empty}</p>}
        {mine.map((plugin) => (
          <div key={plugin.id} className={`flex items-start gap-2 rounded-container border border-line bg-surface px-4 py-3 shadow-sb ${plugin.enabled ? '' : 'opacity-60'}`}>
            {/* One row (Marco, 2026-11-14, #870): name, version, what it does and its state - on/off,
                settings and removal behind ⋯ (later also update, version check, repository, #852).
                Switched off stays visible: dimmed and "aus" in the status line. */}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {pluginName(plugin)} <span className="text-sm font-normal text-ink-faint">v{plugin.version}</span>{' '}
                {/* A stand-in that only logs (lib/pluginCatalog.ts TEST_PLUGIN_IDS) - never mistaken for the real thing. */}
                {isTestPlugin(plugin.id) && <Badge tone="warning">{t('testBadge')}</Badge>}
              </p>
              <p className="text-sm text-ink-muted">
                {capabilitiesLabel(plugin.capabilities) || t('noFunctions')} · {plugin.enabled ? healthLabel(plugin) : t('off')}
              </p>
            </div>
            <ActionMenu
              title={pluginName(plugin)}
              actions={[
                plugin.enabled
                  ? { icon: 'deactivate' as const, label: t('deactivate'), onClick: () => void setEnabled(plugin.id, false) }
                  : { icon: 'activate' as const, label: t('activate'), onClick: () => void setEnabled(plugin.id, true) },
                ...(SETTINGS[plugin.id] ? [{ icon: 'setup' as const, label: t('settings'), onClick: () => setSettingsOf(plugin.id) }] : []),
                {
                  icon: 'remove' as const,
                  label: t('remove'),
                  danger: true,
                  onClick: async () => {
                    if (await confirm(t('removeConfirm', { name: pluginName(plugin) }), { confirmLabel: t('remove'), danger: true })) void uninstall(plugin.id)
                  },
                },
              ]}
            />
          </div>
        ))}
      </div>

      {Settings && <Settings onClose={() => setSettingsOf(null)} />}

      {notInstalled.length > 0 && <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">{t('available')}</h3>}
      <div className="space-y-2">
        {notInstalled.map((candidate) => (
          <div
            key={candidate.id}
            className="flex items-center gap-3 rounded-container border border-line bg-surface px-4 py-3 shadow-sb"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{pluginName(candidate)}</p>
              <p className="text-sm text-ink-muted">{capabilitiesLabel(candidate.capabilities)}</p>
            </div>
            <Button onClick={() =>
                void install({ ...candidate, enabled: true, installedAt: Date.now() })
              }>
              {t('install')}
            </Button>
          </div>
        ))}
      </div>

      {page && isAdmin && workspaceId && <RepositoryAddonInstall workspaceId={workspaceId} installed={installed} install={install} />}
    </section>
  )
}
