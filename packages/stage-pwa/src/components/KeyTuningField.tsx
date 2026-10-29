import i18n from '../i18n'
import { useId, useState } from 'react'
import type { OpenTuning, SongVariant, Tuning } from 'shared-types'
import { parseChordPro } from '../lib/chordpro'
import { isStandard, playTuning, signedSteps, soundingKey, tuningLabel, variantChordShift } from '../lib/pitch'
import { transposeLines } from '../lib/transposeChord'
import { Button, Dialog, IconButton, InfoHint } from './ui'
import { INPUT } from './ui/styles'
import { useTranslation } from 'react-i18next'

/** What this field reads and writes on the editor draft - the stored model stays Transponieren
 * (sound vs. the original) + Stimmung (lib/pitch.ts); only the editing is by intent. */
export type KeyTuningValue = Pick<SongVariant, 'transpose' | 'tuningSpec' | 'chartTuning' | 'tuning' | 'key' | 'chordProContent'>
export type KeyTuningPatch = Pick<SongVariant, 'transpose' | 'tuningSpec'>

/** Whole-neck tuning range: up to 6 half steps down, 2 up (higher tuning is rare and hard on strings). */
const TUNE_MIN = -6
const TUNE_MAX = 2
const TRANSPOSE_LIMIT = 11

type Layout = 'normal' | 'drop' | OpenTuning
const LAYOUTS: { value: Layout; label: string }[] = [
  {
    value: 'normal',
    get label() {
      return i18n.t('editor:kt.normal')
    },
  },
  {
    value: 'drop',
    get label() {
      return i18n.t('editor:kt.drop')
    },
  },
  { value: 'dadgad', label: 'DADGAD' },
  { value: 'open-g', label: 'Open G' },
  { value: 'open-d', label: 'Open D' },
  { value: 'open-e', label: 'Open E' },
]

function layoutOf(tuning: Tuning): Layout {
  return tuning.drop ? 'drop' : (tuning.open ?? 'normal')
}

function withLayout(semitones: number, layout: Layout): Tuning {
  if (layout === 'drop') return { semitones, drop: true }
  if (layout === 'normal') return { semitones }
  return { semitones, open: layout }
}

/** Stored as absent when it's the default - Standard tuning, no transpose. */
function patch(transpose: number, tuning: Tuning): KeyTuningPatch {
  return {
    transpose: transpose === 0 ? undefined : transpose,
    tuningSpec: isStandard(tuning) ? undefined : tuning,
  }
}

/** "Klingt in F (−2) · Stimmung ½ Ton tiefer (Eb) · Akkorde −1" - what the stage gets. */
export function keyTuningSummary(value: KeyTuningValue): string {
  const transpose = value.transpose ?? 0
  const sounding = soundingKey(value)
  const sound =
    transpose === 0
      ? sounding
        ? i18n.t('editor:kt.likeOriginalKey', { key: sounding })
        : i18n.t('editor:kt.likeOriginal')
      : sounding
        ? i18n.t('editor:kt.soundsIn', { key: sounding, steps: signedSteps(transpose) })
        : i18n.t('editor:kt.sounds', { steps: signedSteps(transpose) })
  const tuning = playTuning(value)
  const shift = variantChordShift(value)
  return [sound, i18n.t('editor:kt.tuning', { tuning: tuningLabel(tuning) }), shift === 0 ? i18n.t('editor:kt.asWritten') : i18n.t('editor:kt.chords', { steps: signedSteps(shift) })].join(' · ')
}

/** The first few distinct chords, written -> shown ("G → F#"), so a change can be checked by eye. */
function chordPreview(value: KeyTuningValue, max = 4): string[] {
  const lines = parseChordPro(value.chordProContent)
  const shown = transposeLines(lines, variantChordShift(value), soundingKey(value))
  const pairs: string[] = []
  const seen = new Set<string>()
  lines.forEach((line, i) =>
    line.segments.forEach((segment, j) => {
      const written = segment.chord
      if (!written || seen.has(written) || pairs.length >= max) return
      seen.add(written)
      const now = shown[i]?.segments[j]?.chord ?? written
      pairs.push(now === written ? written : `${written} → ${now}`)
    }),
  )
  return pairs
}

/**
 * "Tonart" in the song editor (Marco, 2026-10-18): one line with what the stage gets, and a dialog
 * that changes it by intent - Umstimmen (tuning and sound move together, the chords on the sheet
 * stay) or Akkorde verschieben (the chords and the sound move, the tuning stays).
 */
export function KeyTuningField({ value, onChange }: { value: KeyTuningValue; onChange: (next: KeyTuningPatch) => void }) {
  const { t } = useTranslation('editor')
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1 text-sm text-ink-muted">
      <span>{t('kt.title')}</span>
      <div className="flex min-h-form flex-wrap items-center justify-between gap-2 rounded-control bg-control px-3 py-2">
        <span className="min-w-0 text-base text-ink">{keyTuningSummary(value)}</span>
        <Button onClick={() => setOpen(true)}>{t('kt.change')}</Button>
      </div>
      {open && <KeyTuningDialog value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  )
}

function StepRow({ label, info, valueLabel, canDown, canUp, onStep }: { label: string; info: string; valueLabel: string; canDown: boolean; canUp: boolean; onStep: (delta: number) => void }) {
  const { t } = useTranslation('editor')
  const labelId = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <span id={labelId} className="text-base font-semibold text-ink">
          {label}
        </span>
        <InfoHint text={info} label={t('kt.explain', { label })} />
      </div>
      <div className="flex items-center gap-2" role="group" aria-labelledby={labelId}>
        <IconButton icon="decrease" label={t('kt.lower', { label })} onClick={() => onStep(-1)} disabled={!canDown} />
        <output className="min-w-[9rem] text-center text-base font-semibold text-ink" aria-live="polite">
          {valueLabel}
        </output>
        <IconButton icon="increase" label={t('kt.higher', { label })} onClick={() => onStep(1)} disabled={!canUp} />
      </div>
    </div>
  )
}

function KeyTuningDialog({ value, onChange, onClose }: { value: KeyTuningValue; onChange: (next: KeyTuningPatch) => void; onClose: () => void }) {
  const { t } = useTranslation('editor')
  const layoutId = useId()
  const transpose = value.transpose ?? 0
  const tuning = playTuning(value)
  const layout = layoutOf(tuning)
  const shift = variantChordShift(value)
  const preview = chordPreview(value)
  const canTranspose = (delta: number) => Math.abs(transpose + delta) <= TRANSPOSE_LIMIT

  // Umstimmen: the tuning and the sound move together - the chords on the sheet stay.
  const retune = (delta: number) => onChange(patch(transpose + delta, withLayout(tuning.semitones + delta, layout)))
  // Akkorde verschieben: the chords and the sound move - the tuning stays.
  const shiftChords = (delta: number) => onChange(patch(transpose + delta, tuning))

  return (
    <Dialog
      title={t('kt.title')}
      size="m"
      onClose={onClose}
      actions={
        <>
          {transpose !== 0 || !isStandard(tuning) ? (
            <Button onClick={() => onChange({ transpose: undefined, tuningSpec: undefined })}>{t('kt.reset')}</Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={onClose}>
            {t('kt.done')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="rounded-control bg-control px-3 py-2 text-base text-ink">{keyTuningSummary(value)}</p>

        <StepRow
          label={t('kt.retune')}
          info={t('kt.retuneInfo')}
          valueLabel={tuningLabel(withLayout(tuning.semitones, 'normal'))}
          canDown={tuning.semitones > TUNE_MIN && canTranspose(-1)}
          canUp={tuning.semitones < TUNE_MAX && canTranspose(1)}
          onStep={retune}
        />

        <StepRow
          label={t('kt.shift')}
          info={t('kt.shiftInfo')}
          valueLabel={shift === 0 ? t('kt.notated') : t('kt.semis', { steps: signedSteps(shift) })}
          canDown={canTranspose(-1)}
          canUp={canTranspose(1)}
          onStep={shiftChords}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={layoutId} className="text-base font-semibold text-ink">
            {t('kt.strings')}
          </label>
          <select
            id={layoutId}
            className={`min-h-form px-3 text-base ${INPUT}`}
            value={layout}
            onChange={(e) => onChange(patch(transpose, withLayout(tuning.semitones, e.target.value as Layout)))}
          >
            {LAYOUTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-ink-faint">{t('kt.dropHint')}</span>
        </div>

        {preview.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-ink">{t('kt.sheetChords')}</span>
            <span className="text-base text-ink-soft">{preview.join(' · ')}</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
