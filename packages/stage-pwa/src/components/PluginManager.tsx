import { pluginName } from '../lib/pluginCatalog'
import { useState, type ComponentType } from 'react'
import { HEALTH_TIMEOUT_MS, type PluginInstallation } from 'shared-types'
import { usePluginsStore } from '../store/usePluginsStore'
import { capabilitiesLabel, installableCatalog, isTestPlugin, pluginKind, type PluginKind } from '../lib/pluginCatalog'
import { useDialogStore } from '../store/useDialogStore'
import { useNow } from '../lib/useNow'
import { AnnouncementTextsDialog } from './AnnouncementTextsDialog'
import { SpeechVoiceDialog } from './SpeechVoiceDialog'
import { ActionMenu, Badge, Button, Switch, InfoHint } from './ui'
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
  const now = useNow()
  const [settingsOf, setSettingsOf] = useState<string | null>(null)
  const Settings = settingsOf ? SETTINGS[settingsOf] : undefined

  function healthLabel(plugin: PluginInstallation): string {
    if (plugin.runtime === 'client') return t('onTablet')
    const entry = health.plugins[plugin.id]
    if (!entry) return t('noHeartbeat')
    if (entry.status !== 'online') return entry.message ?? entry.status
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
          <div key={plugin.id} className="flex flex-col gap-3 rounded-container border border-line bg-surface px-4 py-3 shadow-sb">
            {/* Name and ⋯ on top - the ⋯ always top right, on every card (2026-10-20: beside the
                switch it wandered into the middle once "Einstellungen" wrapped). Text keeps the full
                width otherwise; the controls go in one row below (Marco, 2026-10-07). */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {pluginName(plugin)} <span className="text-sm font-normal text-ink-faint">v{plugin.version}</span>{' '}
                  {/* A stand-in that only logs (lib/pluginCatalog.ts TEST_PLUGIN_IDS) - never mistaken for the real thing. */}
                  {isTestPlugin(plugin.id) && <Badge tone="warning">{t('testBadge')}</Badge>}
                </p>
                <p className="text-sm text-ink-muted">
                  {capabilitiesLabel(plugin.capabilities) || t('noFunctions')} · {healthLabel(plugin)}
                </p>
              </div>
              {/* Entfernen behind ⋯ like every list row - a red button on every card was nine red
                  buttons on one page (System cleanup, 2026-10-16). */}
              <ActionMenu
                title={pluginName(plugin)}
                actions={[
                  {
                    label: t('remove'),
                    danger: true,
                    onClick: async () => {
                      if (await confirm(t('removeConfirm', { name: pluginName(plugin) }), { confirmLabel: t('remove'), danger: true })) void uninstall(plugin.id)
                    },
                  },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* On/off = a switch (docs/15 D5), never a button whose text flips. */}
              <Switch layout="inline" label={t('active')} checked={plugin.enabled} onChange={(on) => void setEnabled(plugin.id, on)} />
              {SETTINGS[plugin.id] && <Button onClick={() => setSettingsOf(plugin.id)}>{t('settings')}</Button>}
            </div>
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
    </section>
  )
}
