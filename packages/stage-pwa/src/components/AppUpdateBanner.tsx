import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { checkForAppUpdate, installAppUpdate, updateFailureReason, type AppUpdate } from '../lib/native'
import { useStageServerStore } from '../store/useStageServerStore'

/**
 * Native app only (#348): when the Stage-Server offers a newer app build than this one, a bar at
 * the bottom offers the update - downloaded from the server and handed to Android's installer.
 * Checked on start and whenever the paired server changes; "Später" hides it until the next start.
 */
export function AppUpdateBanner() {
  const { t } = useTranslation('common')
  const serverUrl = useStageServerStore((state) => state.url)
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void checkForAppUpdate().then((offered) => {
      if (!cancelled) setUpdate(offered)
    })
    return () => {
      cancelled = true
    }
  }, [serverUrl])

  if (!update || dismissed) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-menu flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-3 sb-pad-safe-x sb-pad-safe-bottom text-accent-ink shadow-sb" role="status">
      <span className="text-base font-semibold">{error ?? t('up.available', { version: update.versionName })}</span>
      <button
        type="button"
        disabled={busy}
        className="min-h-form rounded-control bg-scrim/80 px-4 text-base font-bold text-scrim-ink disabled:opacity-40"
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await installAppUpdate()
          } catch (err) {
            setError(t('up.failed', { reason: updateFailureReason(err) }))
          }
          setBusy(false)
        }}
      >
        {busy ? t('up.loading') : t('up.update')}
      </button>
      <button type="button" className="min-h-form rounded-control px-4 text-base font-semibold underline" onClick={() => setDismissed(true)}>
        {t('up.later')}
      </button>
    </div>
  )
}
