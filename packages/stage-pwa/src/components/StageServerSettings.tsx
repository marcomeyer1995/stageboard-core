import { useState } from 'react'
import { getAutomaticStageServerUrl, overrideForTypedUrl } from '../lib/stageServer'
import { useStageServerStore } from '../store/useStageServerStore'
import { isNativeApp } from '../lib/native'
import { NetworkServerList } from './NetworkServerList'
import { INPUT_FREE } from './ui/styles'
import { Button, InfoHint } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * Which Stage-Server this device talks to. Normally nothing to set up: a tablet that opened the
 * app from the Stage-Server uses exactly that address automatically (`getAutomaticStageServerUrl`),
 * so the section just shows it. The manual override (a runtime setting, see the Tier-A
 * local-only-founding follow-up) is behind "Erweitert" - it is only for a device that did *not*
 * load the app from the Stage-Server - and while one is set it is shown openly with a way back
 * to automatic, because a stale override silently breaks every server call on this device.
 * Connecting a solo-founded band for the first time is BandManagementView.tsx's "Verbinden"
 * flow, which writes to this same store.
 */
export function StageServerSettings() {
  const { t } = useTranslation('system')
  const override = useStageServerStore((state) => state.url)
  const setUrl = useStageServerStore((state) => state.setUrl)
  const automatic = getAutomaticStageServerUrl()
  const [draft, setDraft] = useState(override ?? '')

  const effective = override || automatic
  const draftOverride = overrideForTypedUrl(draft)

  function reset() {
    setUrl(null)
    setDraft('')
  }

  // Native app (#348/#351): the address comes from pairing, there is no "automatic" one - show the
  // paired server and the servers on the network instead of the browser's override field.
  if (isNativeApp()) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-ink-soft">
          {override ? (
            <>
              {t('srv.pairedWith')}
              <span className="font-semibold break-all">{override.replace(/^https:\/\//, '')}</span>
            </>
          ) : (
            <span className="text-ink-faint">{t('srv.notPaired')}</span>
          )}
        </p>
        <NetworkServerList />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-soft">
        {effective ? (
          <>
            {t('srv.connectedTo')}
            <span className="font-semibold break-all">{effective}</span>{' '}
            <span className="text-ink-faint">{override ? t('srv.manual') : t('srv.automatic')}</span>
          </>
        ) : (
          <span className="text-ink-faint">{t('srv.unknown')}</span>
        )}
      </p>

      {override && (
        <div className="flex flex-col gap-2 rounded-container border border-line bg-surface p-3 text-sm">
          <p className="text-warn">
            {t('srv.overrideWarn', { automatic: automatic ? ` (${automatic})` : '' })}
          </p>
          <Button className="self-start" onClick={reset}>
            {t('srv.reset')}
          </Button>
        </div>
      )}

      <details className="rounded-control bg-control px-3 py-2 text-sm text-ink-soft">
        <summary className="cursor-pointer select-none py-3 font-medium text-ink-muted">{t('srv.advanced')}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <span className="text-ink-soft">{t('srv.address')}</span>
            <InfoHint
              label={t('srv.addressExplainLabel')}
              text={t('srv.addressExplain')}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('srv.placeholder')}
              aria-label={t('srv.addressAria')}
              className={`h-form min-w-0 flex-1 min-w-0 px-3 ${INPUT_FREE}`}
            />
            <Button className="flex-shrink-0" onClick={() => {
                setUrl(draftOverride)
                setDraft(draftOverride ?? '')
              }} disabled={draftOverride === override}>
              {t('save')}
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}
