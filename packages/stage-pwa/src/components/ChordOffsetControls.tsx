import type { ChordOffsets } from '../lib/useChordOffsets'
import { MAX_CAPO_FRET, MAX_TRANSPOSE } from '../lib/useChordOffsets'

function Stepper({
  label,
  value,
  canDecrease,
  canIncrease,
  onStep,
}: {
  label: string
  value: string
  canDecrease: boolean
  canIncrease: boolean
  onStep: (delta: number) => void
}) {
  const buttonClass =
    'flex h-9 w-9 items-center justify-center rounded-sb-sm bg-control-strong text-lg font-bold text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-faint">{label}</span>
      <button type="button" aria-label={`${label} verringern`} disabled={!canDecrease} onClick={() => onStep(-1)} className={buttonClass}>
        −
      </button>
      <span className="min-w-8 text-center font-bold text-ink">{value}</span>
      <button type="button" aria-label={`${label} erhöhen`} disabled={!canIncrease} onClick={() => onStep(1)} className={buttonClass}>
        +
      </button>
    </div>
  )
}

/** Transpose + Capo steppers for the Prompter (#59). Local to this tablet - see useChordOffsetStore. */
export function ChordOffsetControls({ offsets, authoredCapo }: { offsets: ChordOffsets; authoredCapo: number }) {
  const { transposeOffset, effectiveCapo } = offsets
  const dirty = transposeOffset !== 0 || offsets.capoOffset !== 0
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm uppercase tracking-widest">
      <Stepper
        label="Transpose"
        value={transposeOffset > 0 ? `+${transposeOffset}` : String(transposeOffset)}
        canDecrease={transposeOffset > -MAX_TRANSPOSE}
        canIncrease={transposeOffset < MAX_TRANSPOSE}
        onStep={offsets.stepTranspose}
      />
      <Stepper
        label="Capo"
        value={String(effectiveCapo)}
        canDecrease={effectiveCapo > 0}
        canIncrease={effectiveCapo < MAX_CAPO_FRET}
        onStep={offsets.stepCapo}
      />
      {dirty && (
        <button type="button" onClick={offsets.reset} className="rounded-sb-sm px-2 py-1 text-ink-faint underline hover:text-ink">
          Zurücksetzen
        </button>
      )}
      {authoredCapo > 0 && <span className="text-xs text-ink-faint">Akkorde sind für Capo {authoredCapo} notiert</span>}
    </div>
  )
}
