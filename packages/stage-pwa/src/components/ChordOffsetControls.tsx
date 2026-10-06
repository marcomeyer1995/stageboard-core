import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/backNavigation'
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
    'flex h-touch w-touch items-center justify-center rounded-sb-sm bg-control-strong text-2xl font-bold text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40'
  // One grid row per stepper (label column of fixed width), so the buttons of both rows line up
  // whatever the label's length (#410: "Transpose" pushed its buttons further right than "Capo").
  return (
    <>
      <span className="text-sm uppercase tracking-widest text-ink-faint">{label}</span>
      <button type="button" aria-label={`${label} verringern`} disabled={!canDecrease} onClick={() => onStep(-1)} className={buttonClass}>
        −
      </button>
      <span className="text-center text-lg font-bold text-ink">{value}</span>
      <button type="button" aria-label={`${label} erhöhen`} disabled={!canIncrease} onClick={() => onStep(1)} className={buttonClass}>
        +
      </button>
    </>
  )
}

/** "+2 · Capo 3" - what is changed right now, empty when nothing is. */
function offsetSummary(offsets: ChordOffsets): string {
  const parts: string[] = []
  if (offsets.transposeOffset !== 0) parts.push(offsets.transposeOffset > 0 ? `+${offsets.transposeOffset}` : String(offsets.transposeOffset))
  if (offsets.capoOffset !== 0) parts.push(`Capo ${offsets.effectiveCapo}`)
  return parts.join(' · ')
}

/**
 * Transpose + Capo for the Prompter (#59), behind one "Tonart" button (#410, Marco): changing them
 * is the exception, so the lyrics keep the room - the button shows what is changed, the steppers
 * open in a popup. Local to this tablet - see useChordOffsetStore.
 */
export function ChordOffsetControls({ offsets, authoredCapo }: { offsets: ChordOffsets; authoredCapo: number }) {
  const [open, setOpen] = useState(false)
  const summary = offsetSummary(offsets)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`min-h-12 flex-shrink-0 rounded-sb-sm px-4 text-sm font-semibold ${
          summary ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink hover:bg-control-strong-hover'
        }`}
      >
        Tonart{summary && ` ${summary}`}
      </button>
      {open && <ChordOffsetDialog offsets={offsets} authoredCapo={authoredCapo} onClose={() => setOpen(false)} />}
    </>
  )
}

function ChordOffsetDialog({ offsets, authoredCapo, onClose }: { offsets: ChordOffsets; authoredCapo: number; onClose: () => void }) {
  useBackHandler(onClose)
  const { transposeOffset, effectiveCapo } = offsets
  const dirty = transposeOffset !== 0 || offsets.capoOffset !== 0
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Tonart"
        className="flex w-full max-w-sm flex-col gap-4 rounded-sb border border-line bg-surface p-4 shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-ink">Tonart</h2>
        <div className="grid grid-cols-[7rem_auto_3rem_auto] items-center gap-3">
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
        </div>
        {authoredCapo > 0 && <p className="text-sm text-ink-faint">Akkorde sind für Capo {authoredCapo} notiert.</p>}
        <p className="text-sm text-ink-faint">Gilt nur auf diesem Gerät und nur für diesen Song.</p>
        <div className="flex justify-end gap-2">
          {dirty && (
            <button type="button" onClick={offsets.reset} className="min-h-12 rounded-sb-sm bg-control px-4 text-base text-ink-soft hover:bg-control-hover">
              Zurücksetzen
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-12 rounded-sb-sm bg-accent px-6 text-base font-bold text-accent-ink hover:bg-accent-hover">
            Fertig
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
