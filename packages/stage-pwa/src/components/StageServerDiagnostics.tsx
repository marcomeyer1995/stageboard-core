import { useSyncExternalStore } from 'react'
import {
  clearStageServerLog,
  getStageServerLogLines,
  setStageServerDebugEnabled,
  stageServerDebugEnabled,
  subscribeStageServerLog,
} from '../lib/stageServerDebug'
import { useDialogStore } from '../store/useDialogStore'

const SHOWN_LINES = 40

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleTimeString('de-DE')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/**
 * The on-device half of stageServerDebug.ts: a switch that records how long the Stage-Server
 * status requests really take (and why), and shows the log right here - for a tablet with no adb
 * debugging to read a console from. "Neu messen" re-runs the status fetch so a slow case can be
 * reproduced on demand; "Kopieren" is for pasting the lines to whoever is helping.
 */
export function StageServerDiagnostics({ reload }: { reload: () => Promise<void> }) {
  const enabled = useSyncExternalStore(subscribeStageServerLog, stageServerDebugEnabled)
  const lines = useSyncExternalStore(subscribeStageServerLog, getStageServerLogLines)
  const alert = useDialogStore((state) => state.alert)

  async function copy() {
    const text = lines.map((line) => `${formatTime(line.at)} ${line.text}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      void alert('Kopieren nicht möglich - den Text bitte markieren und von Hand kopieren.')
    }
  }

  return (
    <details className="rounded-sb border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink-soft">Diagnose</summary>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={enabled} onChange={(e) => setStageServerDebugEnabled(e.target.checked)} className="h-5 w-5" />
          Timing-Log der Stage-Server-Abfragen aufzeichnen
        </label>

        {enabled && (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void reload()} className="rounded-sb bg-control px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-control-hover">
                Neu messen
              </button>
              <button type="button" onClick={() => void copy()} disabled={lines.length === 0} className="rounded-sb bg-control px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-control-hover disabled:opacity-50">
                Kopieren
              </button>
              <button type="button" onClick={clearStageServerLog} disabled={lines.length === 0} className="rounded-sb bg-control px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-control-hover disabled:opacity-50">
                Leeren
              </button>
            </div>
            {lines.length === 0 ? (
              <p className="text-xs text-ink-faint">Noch keine Einträge - „Neu messen“ tippen.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-auto rounded-sb bg-control p-2 font-mono text-[11px] leading-snug text-ink-soft">
                {lines.slice(-SHOWN_LINES).map((line) => (
                  <li key={line.id}>
                    <span className="text-ink-faint">{formatTime(line.at)}</span> {line.text}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  )
}
