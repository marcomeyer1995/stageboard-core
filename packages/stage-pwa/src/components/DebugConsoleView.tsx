import i18n from '../i18n'
import { useMemo, useState } from 'react'
import { Segmented, Switch, Button, InfoHint } from './ui'
import { CueTimingPanel } from './CueTimingPanel'
import { SyncTestPanel } from './SyncTestPanel'
import { DEBUG_FLAGS, debugFlagOn, entriesAsText, setDebugFlag, useDebugLogStore, type LogLevel } from '../lib/debugLog'
import { INPUT_FREE } from './ui/styles'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useTranslation } from 'react-i18next'

const LEVELS: Array<LogLevel | 'all'> = ['all', 'error', 'warn', 'info', 'debug']

const LEVEL_CLASS: Record<LogLevel, string> = {
  error: 'text-danger',
  warn: 'text-warn',
  info: 'text-ink',
  debug: 'text-ink-muted',
}

/**
 * Live-Debug-Console (#14): what this device's app has logged, newest first - filter, search,
 * copy to send it along, clear. Plus the detail-log switches that used to need devtools
 * (`localStorage.setItem('sb:debug:…')`).
 */
export function DebugConsoleView() {
  const { t } = useTranslation('system')
  const entries = useDebugLogStore((state) => state.entries)
  const clear = useDebugLogStore((state) => state.clear)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const phone = useMediaQuery('(max-width: 599px)')
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
      setCopied(t('dbg.copied', { count: entries.length }))
    } catch {
      setCopied(t('dbg.copyFailed'))
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4 p-4">
      <header className="flex items-center gap-1">
        <h2 className="text-xl font-bold text-ink">{t('dbg.title')}</h2>
        <InfoHint label={t('dbg.explainLabel')} text={t('dbg.explain')} />
      </header>

      <Segmented
        label={t('dbg.entries')}
        value={level}
        onChange={setLevel}
        options={LEVELS.map((l) => ({ value: l, label: l === 'all' ? t('dbg.all') : t('dbg.levelCount', { label: t(`dbg.${l}`), count: entries.filter((e) => e.level === l).length }) }))}
        // Five filters don't fit side by side on a phone - the page scrolled sideways (2026-10-20).
        columns={phone ? 3 : undefined}
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('dbg.search')}
          aria-label={t('dbg.searchAria')}
          className={`h-form min-w-0 flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
        />
        <Button onClick={() => void copy()}>
          {t('dbg.copy')}
        </Button>
        <Button onClick={clear}>
          {t('dbg.clear')}
        </Button>
      </div>
      {copied && (
        <p role="status" className="text-sm text-ink-muted">
          {copied}
        </p>
      )}

      <ol className="flex max-h-[55vh] flex-col overflow-y-auto rounded-container border border-line bg-surface font-sb-mono text-sm" aria-label={t('dbg.log')}>
        {shown.length === 0 && <li className="p-3 text-ink-faint">{t('dbg.none')}</li>}
        {shown.map((e) => (
          <li key={e.id} className={`border-b border-line px-3 py-2 ${LEVEL_CLASS[e.level]}`}>
            <span className="mr-2 text-ink-faint">{new Date(e.at).toLocaleTimeString(i18n.language)}</span>
            <span className="break-words">{e.text}</span>
          </li>
        ))}
      </ol>

      <CueTimingPanel />
      <SyncTestPanel />

      <section className="flex flex-col gap-2 rounded-container border border-line bg-surface p-4">
        <div className="flex items-center gap-1">
          <h3 className="text-base font-bold text-ink">{t('dbg.flags')}</h3>
          <InfoHint label={t('dbg.flagsLabel')} text={t('dbg.flagsInfo')} />
        </div>
        {DEBUG_FLAGS.map((flag) => (
          <Switch
            key={flag.key}
            label={t(`dbg.flag.${flag.key.replace('sb:debug:', '') as 'grid' | 'config' | 'clocksync'}`)}
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
