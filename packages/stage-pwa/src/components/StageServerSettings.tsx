import { useState } from 'react'
import { getAutomaticStageServerUrl, overrideForTypedUrl } from '../lib/stageServer'
import { useStageServerStore } from '../store/useStageServerStore'
import { isNativeApp } from '../lib/native'
import { NetworkServerList } from './NetworkServerList'
import { INPUT_FREE } from './ui/styles'

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
              Gekoppelt mit <span className="font-semibold break-all">{override.replace(/^https:\/\//, '')}</span>
            </>
          ) : (
            <span className="text-ink-faint">Noch mit keinem Stage-Server gekoppelt.</span>
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
            Verbunden mit <span className="font-semibold break-all">{effective}</span>{' '}
            <span className="text-ink-faint">{override ? '(manuell eingetragen)' : '(automatisch)'}</span>
          </>
        ) : (
          <span className="text-ink-faint">Kein Stage-Server bekannt.</span>
        )}
      </p>

      {override && (
        <div className="flex flex-col gap-2 rounded-container border border-line bg-surface p-3 text-sm">
          <p className="text-amber-500">
            Diese manuelle Adresse ersetzt auf diesem Gerät die automatische
            {automatic ? ` (${automatic})` : ''}. Stimmt sie nicht mehr, erreicht dieses Gerät den Stage-Server
            nicht.
          </p>
          <button
            type="button"
            onClick={reset}
            className="h-form self-start rounded-control bg-control px-4 font-semibold text-ink-soft [@media(hover:hover)]:hover:bg-control-hover"
          >
            Zurücksetzen auf automatisch
          </button>
        </div>
      )}

      <details className="rounded-control bg-control px-3 py-2 text-sm text-ink-soft">
        <summary className="cursor-pointer select-none py-3 font-medium text-ink-muted">Erweitert: andere Adresse verwenden</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-ink-faint">
            Nur nötig, wenn dieses Gerät die App nicht vom Stage-Server geladen hat. Leer lassen oder die
            automatische Adresse eintragen = automatisch.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="z.B. https://stageboard.local"
              aria-label="Stage-Server-Adresse"
              className={`h-12 min-w-0 flex-1 px-3 ${INPUT_FREE}`}
            />
            <button
              type="button"
              onClick={() => {
                setUrl(draftOverride)
                setDraft(draftOverride ?? '')
              }}
              disabled={draftOverride === override}
              className="h-form flex-shrink-0 rounded-control bg-control-strong px-4 font-semibold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}
