import { useState } from 'react'
import { CUE_BEAT, CUE_NAME, type CuePattern } from 'shared-types'
import { isSilentCue } from '../../lib/partCues'
import { COUNT_IN_CUE_PRESETS, CuePatternEditor, PART_CUE_PRESETS } from '../CuePatternEditor'
import { Button, Dialog, Segmented } from '../ui'

type Mode = 'band' | 'silent' | 'own'

/** "Chorus – – – | 1 2 3 4": a pattern in words, for the band's default shown beside the choice. */
export function describeCuePattern(pattern: CuePattern, name: string): string {
  return pattern.map((bar) => bar.map((cell, i) => (cell === CUE_NAME ? name : cell === CUE_BEAT ? String(i + 1) : cell.trim() || '–')).join(' ')).join(' | ')
}

/**
 * One part's announcement in the timeline (#63 step 2): the band's pattern (Standard), nothing
 * (Stumm) or a pattern of its own, edited with the same cells as the band settings. On the part
 * on bar 1 the band's pattern is the count-in pattern.
 */
export function PartCueDialog({
  name,
  own,
  bandPattern,
  countIn,
  onSave,
  onClose,
}: {
  /** The part's name as spoken (the band's text for it). */
  name: string
  own: CuePattern | null
  bandPattern: CuePattern
  countIn: boolean
  onSave: (pattern: CuePattern | null) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>(own === null ? 'band' : isSilentCue(own) ? 'silent' : 'own')
  const [draft, setDraft] = useState<CuePattern>(own && !isSilentCue(own) ? own : bandPattern)
  return (
    <Dialog
      title={`Ansage: ${name}`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onSave(mode === 'band' ? null : mode === 'silent' ? [['']] : draft)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label="Ansage"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'band', label: 'Standard' },
            { value: 'silent', label: 'Stumm' },
            { value: 'own', label: 'Eigenes Muster' },
          ]}
        />
        {mode === 'band' && (
          <p className="text-base text-ink">
            Wie bei allen Teilen: <span className="font-semibold">{describeCuePattern(bandPattern, name)}</span>
            <span className="block text-sm text-ink-muted">Einstellen unter Plugins → Ansagen der Songteile.</span>
          </p>
        )}
        {mode === 'silent' && <p className="text-base text-ink">Vor diesem Teil wird nichts gesagt.</p>}
        {mode === 'own' && <CuePatternEditor label="Muster" pattern={draft} presets={countIn ? COUNT_IN_CUE_PRESETS : PART_CUE_PRESETS} onChange={setDraft} />}
        <p className="text-sm text-ink-muted">
          {countIn ? 'Dieser Teil beginnt auf Takt 1 - das Muster gilt für die Einzähltakte.' : 'Gilt nur für diese Stelle im Song, nicht für andere Teile mit demselben Namen.'}
        </p>
      </div>
    </Dialog>
  )
}
