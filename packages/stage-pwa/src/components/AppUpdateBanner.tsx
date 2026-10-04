import { useEffect, useState } from 'react'
import { checkForAppUpdate, installAppUpdate, type AppUpdate } from '../lib/native'
import { useStageServerStore } from '../store/useStageServerStore'

/**
 * Native app only (#348): when the Stage-Server offers a newer app build than this one, a bar at
 * the bottom offers the update - downloaded from the server and handed to Android's installer.
 * Checked on start and whenever the paired server changes; "Später" hides it until the next start.
 */
export function AppUpdateBanner() {
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
    <div className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-3 text-accent-ink shadow-sb" role="status">
      <span className="text-base font-semibold">{error ?? `Neue App-Version ${update.versionName} auf dem Stage-Server`}</span>
      <button
        type="button"
        disabled={busy}
        className="min-h-12 rounded-sb-sm bg-black/80 px-4 text-base font-bold text-white disabled:opacity-60"
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await installAppUpdate()
          } catch {
            setError('Update konnte nicht geladen werden – später erneut versuchen.')
          }
          setBusy(false)
        }}
      >
        {busy ? 'Lädt…' : 'Aktualisieren'}
      </button>
      <button type="button" className="min-h-12 rounded-sb-sm px-4 text-base font-semibold underline" onClick={() => setDismissed(true)}>
        Später
      </button>
    </div>
  )
}
