import { useMemo, useState } from 'react'
import { UiPreview } from './UiPreview'
import { Button, Segmented, Switch } from './ui'
import { DEBUG_FLAGS, debugFlagOn, entriesAsText, setDebugFlag, useDebugLogStore, type LogLevel } from '../lib/debugLog'
import { INPUT_FREE } from './ui/styles'

const LEVELS: Array<{ id: LogLevel | 'all'; label: string }> = [
  { id: 'all', label: 'Alles' },
  { id: 'error', label: 'Fehler' },
  { id: 'warn', label: 'Warnungen' },
  { id: 'info', label: 'Info' },
  { id: 'debug', label: 'Details' },
]

const LEVEL_CLASS: Record<LogLevel, string> = {
  error: 'text-red-400',
  warn: 'text-amber-500',
  info: 'text-ink',
  debug: 'text-ink-muted',
}

/**
 * Live-Debug-Console (#14): what this device's app has logged, newest first - filter, search,
 * copy to send it along, clear. Plus the detail-log switches that used to need devtools
 * (`localStorage.setItem('sb:debug:…')`).
 */
export function DebugConsoleView() {
  const [showUiPreview, setShowUiPreview] = useState(false)
  const entries = useDebugLogStore((state) => state.entries)
  const clear = useDebugLogStore((state) => state.clear)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [, rerender] = useState(0)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => (level === 'all' || e.level === level) && (!q || e.text.toLowerCase().includes(q))).slice().reverse()
  }, [entries, level, query])

  async function copy() {
    const text = entriesAsText(entries)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(`${entries.length} Einträge kopiert.`)
    } catch {
      setCopied('Kopieren nicht erlaubt - Text unten markieren.')
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-ink">Diagnose</h2>
        <p className="text-sm text-ink-muted">Was die App auf diesem Gerät protokolliert hat (die letzten 500 Einträge seit dem Laden) - ohne Kabel und Entwicklerwerkzeuge.</p>
      </header>

      {/* UI system (docs/15, phase 3): the new building blocks to look at before screens move over. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setShowUiPreview(true)}>UI-Vorschau öffnen</Button>
        <span className="text-sm text-ink-faint">Neue Bedienelemente in allen Themes ansehen.</span>
      </div>
      {showUiPreview && <UiPreview onClose={() => setShowUiPreview(false)} />}

      <Segmented
        label="Einträge"
        value={level}
        onChange={setLevel}
        options={LEVELS.map((l) => ({ value: l.id, label: l.id === 'all' ? l.label : `${l.label} (${entries.filter((e) => e.level === l.id).length})` }))}
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen…"
          aria-label="Log durchsuchen"
          className={`h-form min-w-0 flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
        />
        <button type="button" onClick={() => void copy()} className="min-h-form rounded-control bg-control-strong px-4 font-semibold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover">
          Kopieren
        </button>
        <button type="button" onClick={clear} className="min-h-form rounded-control bg-control px-4 font-semibold text-ink-soft [@media(hover:hover)]:hover:bg-control-hover">
          Leeren
        </button>
      </div>
      {copied && (
        <p role="status" className="text-sm text-ink-muted">
          {copied}
        </p>
      )}

      <ol className="flex max-h-[55vh] flex-col overflow-y-auto rounded-container border border-line bg-surface font-sb-mono text-sm" aria-label="Log">
        {shown.length === 0 && <li className="p-3 text-ink-faint">Keine Einträge.</li>}
        {shown.map((e) => (
          <li key={e.id} className={`border-b border-line px-3 py-2 ${LEVEL_CLASS[e.level]}`}>
            <span className="mr-2 text-ink-faint">{new Date(e.at).toLocaleTimeString('de-DE')}</span>
            <span className="break-words">{e.text}</span>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-2 rounded-container border border-line bg-surface p-4">
        <h3 className="text-base font-bold text-ink">Detail-Protokolle</h3>
        <p className="text-sm text-ink-muted">Schreiben zusätzlich ausführliche Einträge - nur zum Fehlersuchen einschalten.</p>
        {DEBUG_FLAGS.map((flag) => (
          <Switch
            key={flag.key}
            label={flag.label}
            checked={debugFlagOn(flag.key)}
            onChange={(on) => {
              setDebugFlag(flag.key, on)
              rerender((n) => n + 1)
            }}
          />
        ))}
      </section>
    </div>
  )
}
