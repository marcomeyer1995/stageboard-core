import { useState } from 'react'
import { APP_VERSION_CODE, fetchOfferedAppVersion, installAppUpdate, updateFailureReason, type AppUpdate } from '../lib/native'
import { useTranslation } from 'react-i18next'

type CheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'current' } | { kind: 'none' } | { kind: 'available'; update: AppUpdate } | { kind: 'error'; message: string }

/**
 * Native app only (#348): which app version is installed, and a manual "Nach Update suchen" -
 * for whoever tapped "Später" on the update bar, or wants to check right now.
 */
export function AppVersionSettings() {
  const { t } = useTranslation('system')
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
    } catch (err) {
      setState({ kind: 'error', message: t('app.updateFailed', { reason: updateFailureReason(err) }) })
    }
    setInstalling(false)
  }

  const button = 'h-form rounded-control bg-control-strong px-4 text-base font-medium text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:opacity-40'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base text-ink">{t('app.installed', { version: APP_VERSION_CODE > 0 ? t('app.version', { code: APP_VERSION_CODE }) : t('app.devBuild') })}</p>
      {APP_VERSION_CODE === 0 ? (
        // The dev app ("StageBoard Dev", a debug build) is a separate app: the Stage-Server's APK
        // would install as the real app beside it, never as its update.
        <p className="text-base text-ink-muted">{t('app.devUpdates')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button} disabled={state.kind === 'checking'} onClick={() => void check()}>
            {state.kind === 'checking' ? t('app.searching') : t('app.check')}
          </button>
          {state.kind === 'available' && (
            <button type="button" className={`${button} !bg-accent !text-accent-ink`} disabled={installing} onClick={() => void install()}>
              {installing ? t('app.loading') : t('app.install', { version: state.update.versionName })}
            </button>
          )}
        </div>
      )}
      {state.kind === 'current' && <p className="text-base text-ink-muted">{t('app.current')}</p>}
      {state.kind === 'none' && <p className="text-base text-ink-muted">{t('app.none')}</p>}
      {state.kind === 'error' && <p className="text-base text-warn">{state.message}</p>}
    </div>
  )
}
