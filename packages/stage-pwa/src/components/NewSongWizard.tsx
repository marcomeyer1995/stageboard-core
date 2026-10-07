import { useState } from 'react'
import type { Song, SongVariant } from 'shared-types'
import { useBackHandler } from '../lib/backNavigation'
import { randomId } from '../lib/id'
import { Icon } from './Icon'
import { TabImportOverlay, type ImportedSongData } from './TabImportOverlay'

const STEP_TITLE = { 1: 'Name', 2: 'Inhalt', 3: 'Grundeinstellungen' } as const
type Step = keyof typeof STEP_TITLE
const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4', '12/8']

interface NewSongWizardProps {
  onCancel: () => void
  /** The new song and its default variant - written by the caller only now, at the end. */
  onFinish: (song: Song, variant: SongVariant) => void
}

/**
 * "Neuer Song" as a guided flow (#182), like DeviceSetupWizard: Name → Inhalt (import from
 * Ultimate Guitar or start empty) → Grundeinstellungen (BPM, Takt, Key - pre-filled from an
 * import). Nothing is written until "Song anlegen"; abandoning leaves nothing behind. Afterwards
 * the song opens in the normal editor, indistinguishable from any other song.
 */
export function NewSongWizard({ onCancel, onFinish }: NewSongWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [imported, setImported] = useState<ImportedSongData | null>(null)
  const [importing, setImporting] = useState(false)
  const [bpm, setBpm] = useState('120')
  const [timeSignature, setTimeSignature] = useState('4/4')
  const [key, setKey] = useState('')
  useBackHandler(importing ? null : step === 1 ? onCancel : () => setStep((step - 1) as Step))

  const bpmValue = Number(bpm.replace(',', '.'))
  const bpmValid = Number.isFinite(bpmValue) && bpmValue >= 20 && bpmValue <= 400

  function takeImport(data: ImportedSongData) {
    setImported(data)
    setImporting(false)
    if (data.artist && !artist.trim()) setArtist(data.artist)
    if (data.bpm) setBpm(String(data.bpm))
    if (data.key) setKey(data.key)
    setStep(3)
  }

  function finish() {
    if (!title.trim() || !bpmValid) return
    const content = imported?.chordProContent ?? ''
    const song: Song = {
      id: randomId(),
      title: title.trim(),
      artist: artist.trim() || undefined,
      bpm: Math.round(bpmValue * 10) / 10,
      timeSignature,
      clickTrackEnabled: false,
      chordProContent: content,
      timecodes: [],
    }
    const variant: SongVariant = {
      id: randomId(),
      songId: song.id,
      label: 'Original',
      isDefault: true,
      bpm: song.bpm,
      timeSignature,
      clickTrackEnabled: false,
      chordProContent: content,
      timecodes: [],
      tracks: [],
      cues: [],
      countInEnabled: false,
      countInBars: 1,
      key: key.trim() || undefined,
      tuning: imported?.tuning,
      capo: imported?.capo,
    }
    onFinish(song, variant)
  }

  const field = 'h-form w-full rounded-control bg-control px-3 text-base text-ink'
  const secondary = 'min-h-form rounded-control bg-control px-4 font-semibold text-ink-soft [@media(hover:hover)]:hover:bg-control-hover'
  const primary = 'min-h-form rounded-control bg-accent px-5 font-bold text-accent-ink disabled:opacity-40'

  return (
    <div
      role="dialog"
      aria-label="Neuer Song"
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-6"
      onKeyDown={(e) => e.key === 'Escape' && !importing && onCancel()}
    >
      <div className="flex max-h-[min(90vh,90dvh)] w-full max-w-xl flex-col overflow-hidden rounded-container border border-line bg-surface text-ink shadow-sb">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div>
            <h2 className="text-lg font-bold">Neuer Song</h2>
            <p className="text-sm text-ink-muted">
              Schritt {step}/3 · {STEP_TITLE[step]}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="flex h-form w-12 items-center justify-center rounded-control text-ink-muted [@media(hover:hover)]:hover:bg-control-hover [@media(hover:hover)]:hover:text-ink" aria-label="Fenster schließen">
            <Icon name="close" size="1.5rem" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {step === 1 && (
            <form
              id="new-song-step"
              onSubmit={(e) => {
                e.preventDefault()
                if (title.trim()) setStep(2)
              }}
              className="flex flex-col gap-3"
            >
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Titel
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-muted">
                Band / Interpret (optional)
                <input value={artist} onChange={(e) => setArtist(e.target.value)} className={field} />
              </label>
            </form>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-base text-ink-soft">Woher kommt der Text?</p>
              <button type="button" onClick={() => setImporting(true)} className="flex min-h-16 flex-col items-start justify-center rounded-control bg-control-strong px-4 py-3 text-left [@media(hover:hover)]:hover:bg-control-strong-hover">
                <span className="text-base font-bold text-ink">Von Ultimate Guitar importieren</span>
                <span className="text-sm text-ink-muted">Suchen, Vorschau ansehen, übernehmen - Akkorde, Text, Key und Tempo.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImported(null)
                  setStep(3)
                }}
                className="flex min-h-16 flex-col items-start justify-center rounded-control bg-control-strong px-4 py-3 text-left [@media(hover:hover)]:hover:bg-control-strong-hover"
              >
                <span className="text-base font-bold text-ink">Leer beginnen</span>
                <span className="text-sm text-ink-muted">Text später im Editor schreiben oder einfügen.</span>
              </button>
            </div>
          )}

          {step === 3 && (
            <form
              id="new-song-step"
              onSubmit={(e) => {
                e.preventDefault()
                finish()
              }}
              className="flex flex-col gap-3"
            >
              <p className="text-sm text-ink-muted">
                {imported
                  ? `Importiert: ${imported.chordProContent.split('\n').filter((l) => l.trim()).length} Zeilen${imported.key ? `, Key ${imported.key}` : ''}${imported.bpm ? `, ${imported.bpm} BPM` : ''}.`
                  : 'Leerer Song.'}{' '}
                Alles lässt sich später im Editor ändern.
              </p>
              <div className="grid grid-cols-3 gap-2 [&>label]:min-w-0">
                <label className="flex flex-col gap-1 text-sm text-ink-muted">
                  BPM
                  <input inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value)} className={field} aria-invalid={!bpmValid} />
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-muted">
                  Takt
                  <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} className={field}>
                    {TIME_SIGNATURES.map((ts) => (
                      <option key={ts} value={ts}>
                        {ts}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-muted">
                  Key
                  <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="z. B. Am" className={field} />
                </label>
              </div>
              {!bpmValid && <p className="text-sm text-amber-500">BPM zwischen 20 und 400 eingeben.</p>}
            </form>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={step === 1 ? onCancel : () => setStep((step - 1) as Step)} className={secondary}>
            {step === 1 ? 'Abbrechen' : 'Zurück'}
          </button>
          {step === 1 && (
            <button type="submit" form="new-song-step" disabled={!title.trim()} className={primary}>
              Weiter
            </button>
          )}
          {step === 3 && (
            <button type="submit" form="new-song-step" disabled={!title.trim() || !bpmValid} className={primary}>
              Song anlegen
            </button>
          )}
        </div>
      </div>
      {importing && <TabImportOverlay onImport={takeImport} onClose={() => setImporting(false)} initialQuery={[title, artist].filter((part) => part.trim()).join(' ')} />}
    </div>
  )
}
