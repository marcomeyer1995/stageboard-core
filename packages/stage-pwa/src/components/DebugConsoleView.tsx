import { useMemo, useState } from 'react'
import { DEBUG_FLAGS, debugFlagOn, entriesAsText, setDebugFlag, useDebugLogStore, type LogLevel } from '../lib/debugLog'

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

      <div className="flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={level === l.id}
            onClick={() => setLevel(l.id)}
            className={`min-h-12 rounded-sb-sm px-4 text-sm font-semibold ${level === l.id ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'}`}
          >
            {l.label}
            {l.id !== 'all' && ` (${entries.filter((e) => e.level === l.id).length})`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen…"
          aria-label="Log durchsuchen"
          className="h-12 min-w-0 flex-1 rounded-sb-sm bg-control px-3 text-base text-ink"
        />
        <button type="button" onClick={() => void copy()} className="min-h-12 rounded-sb-sm bg-control-strong px-4 font-semibold text-ink hover:bg-control-strong-hover">
          Kopieren
        </button>
        <button type="button" onClick={clear} className="min-h-12 rounded-sb-sm bg-control px-4 font-semibold text-ink-soft hover:bg-control-hover">
          Leeren
        </button>
      </div>
      {copied && (
        <p role="status" className="text-sm text-ink-muted">
          {copied}
        </p>
      )}

      <ol className="flex max-h-[55vh] flex-col overflow-y-auto rounded-sb border border-line bg-surface font-sb-mono text-sm" aria-label="Log">
        {shown.length === 0 && <li className="p-3 text-ink-faint">Keine Einträge.</li>}
        {shown.map((e) => (
          <li key={e.id} className={`border-b border-line px-3 py-2 ${LEVEL_CLASS[e.level]}`}>
            <span className="mr-2 text-ink-faint">{new Date(e.at).toLocaleTimeString('de-DE')}</span>
            <span className="break-words">{e.text}</span>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-2 rounded-sb border border-line bg-surface p-4">
        <h3 className="text-base font-bold text-ink">Detail-Protokolle</h3>
        <p className="text-sm text-ink-muted">Schreiben zusätzlich ausführliche Einträge - nur zum Fehlersuchen einschalten.</p>
        {DEBUG_FLAGS.map((flag) => (
          <label key={flag.key} className="flex min-h-12 cursor-pointer items-center gap-3 text-base text-ink">
            <input
              type="checkbox"
              checked={debugFlagOn(flag.key)}
              onChange={(e) => {
                setDebugFlag(flag.key, e.target.checked)
                rerender((n) => n + 1)
              }}
              className="h-6 w-6"
            />
            {flag.label}
          </label>
        ))}
      </section>
    </div>
  )
}
