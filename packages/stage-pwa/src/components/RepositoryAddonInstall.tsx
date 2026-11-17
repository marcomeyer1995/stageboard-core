import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginInstallation } from 'shared-types'
import { installRepositoryAddon, isKnownPublisher, permissionLabel, previewRepositoryAddon, RepositoryAddonError, type RepositoryAddonPreview } from '../lib/addonRepository'
import { catalogEntry } from '../lib/pluginCatalog'
import { Badge, Button, Dialog, Field } from './ui'

/**
 * "Aus Repository installieren" (docs/32 §12 step 3, #852) - only the admin sees it. A GitHub
 * address → the host reads the latest release → the details (permissions, publisher with a warning
 * when unknown, source, size, where it runs, what is new) → "Installieren": the host downloads and
 * checks every file, this device writes the band's documents.
 */
export function RepositoryAddonInstall({
  workspaceId,
  installed,
  install,
}: {
  workspaceId: string
  installed: readonly PluginInstallation[]
  install: (installation: PluginInstallation) => Promise<void>
}) {
  const { t } = useTranslation('addons')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RepositoryAddonPreview | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const errorText = (code: string) => t(`repo.err.${code}`, { defaultValue: t('repo.err.other', { code }) })

  async function check() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      setPreview(await previewRepositoryAddon(workspaceId, address.trim()))
    } catch (err) {
      setError(errorText(err instanceof RepositoryAddonError ? err.code : 'other'))
    } finally {
      setBusy(false)
    }
  }

  const existing = preview ? installed.find((p) => p.id === preview.manifest.id) : undefined
  const known = preview ? isKnownPublisher(preview.publisher) : true

  async function confirm() {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const result = await installRepositoryAddon(workspaceId, preview, existing, !known, install)
      setDone(t('repo.installed', { name: result.name, version: result.version }))
      setPreview(null)
      setAddress('')
    } catch (err) {
      setError(errorText(err instanceof RepositoryAddonError ? err.code : 'other'))
    } finally {
      setBusy(false)
    }
  }

  const m = preview?.manifest
  const runs = m ? t(`repo.runs.${m.runtime}`) : ''
  const helpers = m?.helpers ? [m.helpers.android ? t('repo.helperAndroid', { name: m.helpers.android.package }) : null, m.helpers.desktop ? t('repo.helperDesktop', { name: m.helpers.desktop.program }) : null].filter(Boolean) : []

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-ink-muted">{t('repo.title')}</h3>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (address.trim()) void check()
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label={t('repo.address')} placeholder="github.com/…/stageboard-addon-…" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit" disabled={busy || !address.trim()}>
          {busy && !preview ? '…' : t('repo.check')}
        </Button>
      </form>
      {error && !preview && <p className="mt-2 text-sm text-danger">{error}</p>}
      {done && <p className="mt-2 text-sm text-ink-muted">{done}</p>}

      {preview && m && (
        <Dialog
          title={`${m.name} v${m.version}`}
          onClose={() => setPreview(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
                {t('repo.cancel')}
              </Button>
              <Button variant={known ? 'primary' : 'danger'} onClick={() => void confirm()} disabled={busy}>
                {busy ? '…' : existing ? t('repo.update') : known ? t('repo.install') : t('repo.installAnyway')}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-base">
            <p>
              <span className="text-ink-muted">{t('repo.publisher')}:</span> <span className="font-semibold">{preview.publisher}</span>{' '}
              {!known && <Badge tone="warning">{t('repo.unknownPublisher')}</Badge>}
            </p>
            {!known && <p className="rounded-control bg-warn/15 p-3 text-sm text-warn">{t('repo.unknownWarning')}</p>}
            <p className="break-all">
              <span className="text-ink-muted">{t('repo.source')}:</span> {preview.repository} · {preview.release}
            </p>
            <p>
              <span className="text-ink-muted">{t('repo.size')}:</span> {Math.max(1, Math.round(preview.downloadBytes / 1024))} kB
            </p>
            <p>
              <span className="text-ink-muted">{t('repo.runsLabel')}:</span> {runs}
              {helpers.length > 0 && ` · ${helpers.join(', ')}`}
            </p>
            <div>
              <p className="text-ink-muted">{t('repo.permissions')}:</p>
              {(m.permissions ?? []).length === 0 ? (
                <p>{t('repo.noPermissions')}</p>
              ) : (
                <ul className="ml-5 list-disc">
                  {(m.permissions ?? []).map((p) => (
                    <li key={p}>{permissionLabel(p, t as (key: string, values?: Record<string, string>) => string)}</li>
                  ))}
                </ul>
              )}
            </div>
            {m.changes && (
              <p>
                <span className="text-ink-muted">{t('repo.changes')}:</span> {m.changes}
              </p>
            )}
            {existing ? (
              <p className="text-sm text-ink-muted">{catalogEntry(m.id) && !existing.clientSource?.startsWith('/addons/') ? t('repo.replacesBuiltIn') : t('repo.updateFrom', { from: existing.version, to: m.version })}</p>
            ) : null}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        </Dialog>
      )}
    </div>
  )
}
