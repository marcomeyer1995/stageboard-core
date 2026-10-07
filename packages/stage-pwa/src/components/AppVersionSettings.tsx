import { useState } from 'react'
import { APP_VERSION_CODE, fetchOfferedAppVersion, installAppUpdate, type AppUpdate } from '../lib/native'

type CheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'current' } | { kind: 'none' } | { kind: 'available'; update: AppUpdate } | { kind: 'error'; message: string }

/**
 * Native app only (#348): which app version is installed, and a manual "Nach Update suchen" -
 * for whoever tapped "Später" on the update bar, or wants to check right now.
 */
export function AppVersionSettings() {
  const [state, setState] = useState<CheckState>({ kind: 'idle' })
  const [installing, setInstalling] = useState(false)

  async function check() {
    setState({ kind: 'checking' })
    const offered = await fetchOfferedAppVersion()
    if (!offered) setState({ kind: 'none' })
    else if (APP_VERSION_CODE > 0 && offered.versionCode <= APP_VERSION_CODE) setState({ kind: 'current' })
    else setState({ kind: 'available', update: offered })
  }

  async function install() {
    setInstalling(true)
    try {
      await installAppUpdate()
    } catch {
      setState({ kind: 'error', message: 'Update konnte nicht geladen werden – später erneut versuchen.' })
    }
    setInstalling(false)
  }

  const button = 'h-form rounded-control bg-control-strong px-4 text-base font-medium text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:opacity-40'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base text-ink">Installiert: {APP_VERSION_CODE > 0 ? `Version 1.${APP_VERSION_CODE}` : 'Entwicklungs-Build'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={state.kind === 'checking'} onClick={() => void check()}>
          {state.kind === 'checking' ? 'Suche…' : 'Nach Update suchen'}
        </button>
        {state.kind === 'available' && (
          <button type="button" className={`${button} !bg-accent !text-accent-ink`} disabled={installing} onClick={() => void install()}>
            {installing ? 'Lädt…' : `Version ${state.update.versionName} installieren`}
          </button>
        )}
      </div>
      {state.kind === 'current' && <p className="text-base text-ink-muted">Aktuell – der Stage-Server hat keine neuere Version.</p>}
      {state.kind === 'none' && <p className="text-base text-ink-muted">Der Stage-Server bietet keine App an (oder ist nicht erreichbar).</p>}
      {state.kind === 'error' && <p className="text-base text-amber-500">{state.message}</p>}
    </div>
  )
}
