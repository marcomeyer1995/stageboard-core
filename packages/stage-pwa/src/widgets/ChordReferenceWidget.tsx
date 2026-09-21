import { useState } from 'react'
import { GuitarChordDiagram } from '../components/GuitarChordDiagram'
import { PianoChordDiagram } from '../components/PianoChordDiagram'
import { CHORD_QUALITIES, lookUpChord, rootName, type ChordQualityId } from '../lib/chordReference'
import { guitarShapeFor } from '../lib/guitarShapes'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type ChordReferenceConfig } from './chordReferenceConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

const chip = (selected: boolean) =>
  `rounded-sb-sm px-2 py-1 text-sm font-medium ${selected ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink hover:bg-control-strong-hover'}`

/**
 * Chord Cheat Sheet (#24): pick a root and a quality, see the notes, the intervals, a guitar
 * shape and the piano keys - without leaving the Live Dashboard. Works offline (all computed
 * locally) and needs no capability, so it can never grey out. The selection is this widget's own
 * transient state: a lookup, not a setting worth a PouchDB write.
 */
export function ChordReferenceWidget({ config }: { config: ChordReferenceConfig }) {
  const naming = config.noteNaming ?? 'sharp'
  const [root, setRoot] = useState(0)
  const [qualityId, setQualityId] = useState<ChordQualityId>('maj')
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  const chord = lookUpChord(root, qualityId, naming)
  const shape = guitarShapeFor(root, qualityId)
  const showGuitar = config.showGuitar ?? true
  const showPiano = config.showPiano ?? true

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto text-ink-soft">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Grundton">
        {Array.from({ length: 12 }, (_, pitchClass) => (
          <button key={pitchClass} type="button" aria-pressed={root === pitchClass} onClick={() => setRoot(pitchClass)} className={chip(root === pitchClass)}>
            {rootName(pitchClass, naming)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Akkordart">
        {CHORD_QUALITIES.map((quality) => (
          <button key={quality.id} type="button" aria-pressed={qualityId === quality.id} onClick={() => setQualityId(quality.id)} className={chip(qualityId === quality.id)}>
            {quality.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-start gap-1">
        <span data-testid="chord-symbol" style={{ fontSize }} className="font-bold leading-none text-ink">
          {chord.symbol}
        </span>
        <span className="font-sb-mono text-ink" style={{ fontSize: fontSize * 0.6 }}>
          {chord.notes.join('  ')}
        </span>
        <span className="font-sb-mono text-ink-faint" style={{ fontSize: fontSize * 0.45 }}>
          {chord.intervals.join('  ')}
        </span>
      </div>

      {(showGuitar || showPiano) && (
        <div className="flex flex-wrap items-start gap-4">
          {showGuitar && (shape ? <GuitarChordDiagram shape={shape} /> : <span className="text-sm text-ink-faint">Kein Griffbild</span>)}
          {showPiano && <PianoChordDiagram rootPitchClass={root} semitones={chord.semitones} />}
        </div>
      )}
    </div>
  )
}

export function ChordReferenceConfigPanel({
  config,
  onChange,
}: {
  config: ChordReferenceConfig
  onChange: (next: ChordReferenceConfig) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Notenname
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.noteNaming ?? 'sharp'}
          onChange={(e) => onChange({ ...config, noteNaming: e.target.value as ChordReferenceConfig['noteNaming'] })}
        >
          <option value="sharp">Kreuz (F#)</option>
          <option value="flat">B (Gb)</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={config.showGuitar ?? true} onChange={(e) => onChange({ ...config, showGuitar: e.target.checked })} />
        Gitarren-Griffbild
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={config.showPiano ?? true} onChange={(e) => onChange({ ...config, showPiano: e.target.checked })} />
        Klaviatur
      </label>
      <SizeRatioSlider label="Akkordname" ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO} onChange={(sizeRatio) => onChange({ ...config, sizeRatio })} />
    </div>
  )
}
