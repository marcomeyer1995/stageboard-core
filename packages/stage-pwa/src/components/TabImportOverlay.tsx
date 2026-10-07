import { useEffect, useRef, useState } from 'react'
import type { LookupResult } from 'shared-types'
import { fetchLookupDetail, searchLookup } from '../lib/lookupClient'
import { useBackHandler } from '../lib/backNavigation'
import { Icon } from './Icon'
import { INPUT_FREE } from './ui/styles'
import { Button } from './ui'

const PROVIDERS = [
  { id: 'ultimate-guitar-scraper', label: 'Ultimate Guitar (Akkorde)' },
  { id: 'metadata-lookup', label: 'MusicBrainz (Metadaten)' },
] as const

/**
 * A real `<iframe>` of the source page won't render here - Ultimate Guitar (like most sites)
 * sends `Content-Security-Policy: frame-ancestors 'self'`, which the browser enforces no
 * matter what this app does. A sized popup window is the practical equivalent: a genuine,
 * live, scrollable copy of the real page, just not embedded inline.
 */
function openSourcePreview(url: string) {
  window.open(url, 'stageboard-source-preview', 'width=720,height=900,noopener,noreferrer')
}

export interface ImportedSongData {
  chordProContent: string
  artist?: string
  key?: string
  tuning?: string
  capo?: number
  bpm?: number
}

interface TabImportOverlayProps {
  /** Only fires for a result that actually carries importable chordProContent - MusicBrainz
   * results are for confirming song identity, not for importing (it has no chord/lyric data). */
  onImport: (data: ImportedSongData) => void
  onClose: () => void
  /** A song title (and artist) already known - prefilled and searched for at once (Marco). */
  initialQuery?: string
}

/** docs/08 Use Case 1.1 "Smarter In-App Tab Import": search, preview, then commit to the
 * editor - the user never has to leave the app to find a chord sheet. */
export function TabImportOverlay({ onImport, onClose, initialQuery }: TabImportOverlayProps) {
  useBackHandler(onClose)
  const [provider, setProvider] = useState<string>(PROVIDERS[0].id)
  const [query, setQuery] = useState(initialQuery?.trim() ?? '')
  const [results, setResults] = useState<LookupResult[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState<'searching' | 'loading-detail' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    await search(query)
  }

  // A known title is searched for right away - one tap less in the common case.
  const searchedInitial = useRef(false)
  useEffect(() => {
    if (searchedInitial.current || !initialQuery?.trim()) return
    searchedInitial.current = true
    void search(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function search(text: string) {
    if (!text.trim()) return
    setBusy('searching')
    setError(null)
    setResults([])
    setSelectedId(null)
    setDetail(null)
    const result = await searchLookup(provider, text.trim())
    setBusy(null)
    setSearched(true)
    if (result.status === 'error') {
      setError(result.message)
      return
    }
    setResults(result.data)
  }

  async function handleSelect(item: LookupResult) {
    setSelectedId(item.id)
    setDetail(null)
    setError(null)
    setBusy('loading-detail')
    const result = await fetchLookupDetail(provider, item.id)
    setBusy(null)
    if (result.status === 'error') {
      setError(result.message)
      return
    }
    setDetail(result.data)
  }

  const selected = results.find((r) => r.id === selectedId) ?? null
  const importableContent = typeof detail?.chordProContent === 'string' ? detail.chordProContent : null
  const metaArtist = typeof detail?.artist === 'string' && detail.artist ? detail.artist : undefined
  const metaKey = typeof detail?.key === 'string' && detail.key ? detail.key : undefined
  const metaTuning = typeof detail?.tuning === 'string' && detail.tuning ? detail.tuning : undefined
  const metaCapo = typeof detail?.capo === 'number' ? detail.capo : undefined
  const metaBpm = typeof detail?.bpm === 'number' ? detail.bpm : undefined

  function handleImport() {
    if (!importableContent) return
    onImport({
      chordProContent: importableContent,
      artist: metaArtist,
      key: metaKey,
      tuning: metaTuning,
      capo: metaCapo,
      bpm: metaBpm,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-black/60 sb-pad-safe [--sb-pad:0.75rem]"
      onClick={onClose}
    >
      {/* Own shell (the two panes need a fixed height), but the shared dialog's rules (docs/15
          D6): title row names it, the way out is the bottom row - Abbrechen + Importieren. */}
      <div
        role="dialog"
        aria-label="Song importieren"
        className="flex h-[85vh] w-full max-w-3xl flex-col gap-3 rounded-container border border-line bg-surface p-4 shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="border-b border-line pb-3 text-lg font-bold text-ink">Song importieren</h2>

        <form onSubmit={handleSearch} className="flex gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={`min-h-form px-3 text-base ${INPUT_FREE}`}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Songtitel..."
            className={`min-h-form flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
          />
          <button
            type="submit"
            disabled={busy === 'searching' || !query.trim()}
            className="rounded-control bg-control-strong px-3 min-h-form text-base text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:opacity-40"
          >
            {busy === 'searching' ? 'Suche...' : 'Suchen'}
          </button>
        </form>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden">
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {results.map((r) => (
              <li key={r.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSelect(r)}
                  className={`min-w-0 flex-1 rounded-control px-2 py-1 text-left text-sm ${
                    selectedId === r.id
                      ? 'bg-accent text-accent-ink'
                      : 'bg-control text-ink [@media(hover:hover)]:hover:bg-control-hover'
                  }`}
                >
                  <span className="font-medium">{r.title}</span>
                  {r.subtitle && <span className="block text-xs text-ink-faint">{r.subtitle}</span>}
                  {r.rating !== undefined && <RatingLine rating={r.rating} votes={r.votes} />}
                </button>
                {r.sourceUrl && (
                  <button
                    type="button"
                    onClick={() => openSourcePreview(r.sourceUrl!)}
                    title="Original-Seite öffnen"
                    className="flex-shrink-0 rounded-control px-2 py-1 text-ink-faint [@media(hover:hover)]:hover:bg-control-hover [@media(hover:hover)]:hover:text-ink"
                  >
                    <Icon name="external" />
                  </button>
                )}
              </li>
            ))}
            {results.length === 0 && searched && busy === null && (
              <p className="text-xs text-ink-faint">Keine Ergebnisse.</p>
            )}
          </ul>

          <div className="flex flex-col overflow-y-auto rounded-container bg-control p-2 text-sm">
            {selected?.sourceUrl && (
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-line pb-2">
                <a
                  href={selected.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-xs text-ink-faint [@media(hover:hover)]:hover:text-ink [@media(hover:hover)]:hover:underline"
                >
                  {selected.sourceUrl}
                </a>
                <button
                  type="button"
                  onClick={() => openSourcePreview(selected.sourceUrl!)}
                  className="flex flex-shrink-0 items-center gap-1 rounded-control bg-control-strong px-2 min-h-form text-base text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
                >
                  Original ansehen <Icon name="external" />
                </button>
              </div>
            )}
            {busy === 'loading-detail' && <p className="text-ink-faint">Lädt...</p>}
            {importableContent && (
              <>
                {(metaArtist || metaKey || metaTuning || metaCapo !== undefined || metaBpm !== undefined) && (
                  <dl className="mb-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-xs text-ink-muted">
                    {metaArtist && (
                      <div>
                        <dt className="inline font-bold">Band: </dt>
                        <dd className="inline text-ink">{metaArtist}</dd>
                      </div>
                    )}
                    {metaKey && (
                      <div>
                        <dt className="inline font-bold">Key: </dt>
                        <dd className="inline text-ink">{metaKey}</dd>
                      </div>
                    )}
                    {metaTuning && (
                      <div>
                        <dt className="inline font-bold">Tuning: </dt>
                        <dd className="inline text-ink">{metaTuning}</dd>
                      </div>
                    )}
                    {metaCapo !== undefined && (
                      <div>
                        <dt className="inline font-bold">Capo: </dt>
                        <dd className="inline text-ink">{metaCapo === 0 ? 'kein Capo' : metaCapo}</dd>
                      </div>
                    )}
                    {metaBpm !== undefined && (
                      <div>
                        <dt className="inline font-bold">BPM: </dt>
                        <dd className="inline text-ink">{metaBpm}</dd>
                      </div>
                    )}
                  </dl>
                )}
                <pre className="whitespace-pre-wrap font-sb-mono text-xs text-ink">
                  {importableContent}
                </pre>
              </>
            )}
            {detail && !importableContent && (
              <dl className="space-y-1 text-xs text-ink">
                {Object.entries(detail).map(([key, value]) => (
                  <div key={key}>
                    <dt className="inline font-bold text-ink-muted">{key}: </dt>
                    <dd className="inline">{String(value)}</dd>
                  </div>
                ))}
                <p className="pt-2 text-ink-faint">
                  Keine Akkorde/Text verfügbar - nur zur Bestätigung der Songdaten.
                </p>
              </dl>
            )}
          </div>
        </div>

        <div className="flex justify-between gap-2 border-t border-line pt-3">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={handleImport} disabled={!importableContent}>
            Importieren
          </Button>
        </div>
      </div>
    </div>
  )
}

/** "★ 4,8 · 11.313 Bewertungen" - how much the community trusts this version (results come
 * best-rated first). */
function RatingLine({ rating, votes }: { rating: number; votes?: number }) {
  const stars = rating.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const count = votes !== undefined ? votes.toLocaleString('de-DE') : null
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs" aria-label={`${stars} von 5 Sternen${count ? `, ${count} Bewertungen` : ''}`}>
      <Icon name="rating" />
      <span className="font-semibold">{stars}</span>
      {count && <span className="opacity-70">· {count} Bewertungen</span>}
    </span>
  )
}
