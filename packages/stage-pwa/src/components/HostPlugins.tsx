import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostCapabilities } from 'shared-types'
import { fetchHostCapabilities } from '../lib/fetchHostCapabilities'
import { installableCatalog, pluginName } from '../lib/pluginCatalog'
import { useDialogStore } from '../store/useDialogStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { Badge, Button } from './ui'

/**
 * The server plugins at the host on the stage map (Marco, 2026-11-07, docs/25 §6): download tool,
 * stem separation, voices … - installable only where this host can run them, greyed out with what
 * it lacks where not (an Android host: none of the heavy ones). Installing is the same as in
 * System → Add-ons; only the admin installs.
 */
export function HostPlugins({ canInstall }: { canInstall: boolean }) {
  const { t } = useTranslation('hardware')
  const installed = usePluginsStore((state) => state.installed)
  const install = usePluginsStore((state) => state.install)
  const uninstall = usePluginsStore((state) => state.uninstall)
  const confirm = useDialogStore((state) => state.confirm)
  const [caps, setCaps] = useState<HostCapabilities | null | 'loading'>('loading')
  useEffect(() => {
    let alive = true
    void fetchHostCapabilities().then((c) => alive && setCaps(c))
    return () => {
      alive = false
    }
  }, [])
  if (caps === 'loading') return null
  const catalog = installableCatalog()
  return (
    <div className="flex flex-col gap-2">
      <span className="text-base font-semibold">{t('hostPlugins.title')}</span>
      {caps === null ? (
        <p className="text-base text-ink-muted">{t('hostPlugins.unknown')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {caps.plugins.flatMap((p) => {
            const entry = catalog.find((c) => c.id === p.id)
            if (!entry) return []
            const isInstalled = installed.some((i) => i.id === p.id)
            return [
              <li key={p.id} className={`flex flex-wrap items-center gap-2 ${p.available || isInstalled ? '' : 'opacity-60'}`}>
                <span className="min-w-0 flex-1 text-base">{pluginName(entry)}</span>
                {isInstalled && <Badge tone="accent">{t('hostPlugins.installed')}</Badge>}
                {!p.available && <span className="text-base text-ink-muted">{t('hostPlugins.cannot', { needs: p.needs ?? '?' })}</span>}
                {canInstall && !isInstalled && p.available && <Button onClick={() => void install({ ...entry, enabled: true, installedAt: Date.now() })}>{t('hostPlugins.install')}</Button>}
                {canInstall && isInstalled && (
                  <Button
                    variant="quiet"
                    onClick={async () => {
                      if (await confirm(t('hostPlugins.removeConfirm', { name: pluginName(entry) }), { danger: true, confirmLabel: t('hostPlugins.remove') })) void uninstall(p.id)
                    }}
                  >
                    {t('hostPlugins.remove')}
                  </Button>
                )}
              </li>,
            ]
          })}
        </ul>
      )}
    </div>
  )
}
