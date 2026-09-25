import { useState } from 'react'
import { getAutomaticStageServerUrl, overrideForTypedUrl } from '../lib/stageServer'
import { useStageServerStore } from '../store/useStageServerStore'

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
        <div className="flex flex-col gap-2 rounded-sb border border-line bg-surface p-3 text-sm">
          <p className="text-amber-500">
            Diese manuelle Adresse ersetzt auf diesem Gerät die automatische
            {automatic ? ` (${automatic})` : ''}. Stimmt sie nicht mehr, erreicht dieses Gerät den Stage-Server
            nicht.
          </p>
          <button
            type="button"
            onClick={reset}
            className="h-12 self-start rounded-sb bg-control px-4 font-semibold text-ink-soft hover:bg-control-hover"
          >
            Zurücksetzen auf automatisch
          </button>
        </div>
      )}

      <details className="rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft">
        <summary className="cursor-pointer select-none font-medium text-ink-muted">Erweitert: andere Adresse verwenden</summary>
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
              className="h-12 min-w-0 flex-1 rounded-sb bg-surface px-3 text-ink-soft"
            />
            <button
              type="button"
              onClick={() => {
                setUrl(draftOverride)
                setDraft(draftOverride ?? '')
              }}
              disabled={draftOverride === override}
              className="h-12 flex-shrink-0 rounded-sb bg-control-strong px-4 font-semibold text-ink hover:bg-control-strong-hover disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}
