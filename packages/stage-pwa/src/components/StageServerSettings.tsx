import { useState } from 'react'
import { useStageServerStore } from '../store/useStageServerStore'

/**
 * Which Stage-Server this device talks to - a runtime setting (see the Tier-A
 * local-only-founding follow-up), not just the build-time `VITE_STAGE_SERVER_URL` default
 * (`stageServer.ts`'s `getStageServerUrl()` prefers this when set). Editing it here is purely
 * for visibility/troubleshooting ("which server am I even pointed at") - actually *connecting*
 * a solo-founded band to a server for the first time is BandManagementView.tsx's "Verbinden"
 * flow, which writes to this same store as part of that action.
 */
export function StageServerSettings() {
  const url = useStageServerStore((state) => state.url)
  const setUrl = useStageServerStore((state) => state.setUrl)
  const [draft, setDraft] = useState(url ?? '')

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Server-Adresse (z.B. https://192.168.1.50:3001)"
        className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-ink-soft"
      />
      <button
        type="button"
        onClick={() => setUrl(draft.trim() || null)}
        disabled={draft.trim() === (url ?? '')}
        className="h-12 flex-shrink-0 rounded-sb bg-control px-4 font-semibold text-ink-soft hover:bg-control-hover disabled:opacity-50"
      >
        Speichern
      </button>
    </div>
  )
}
