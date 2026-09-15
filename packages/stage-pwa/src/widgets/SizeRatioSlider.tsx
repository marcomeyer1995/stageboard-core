import { useDeferredSliderValue } from '../lib/useDeferredSliderValue'

/** min/max/step in percent of the anchor "Text" size - 25%-400% covers everything from a
 * barely-there secondary element up to several times the anchor size, without letting the
 * slider's own range feel arbitrary. Shared by every widget with one or more functional
 * elements sized relative to the device-wide default (originally Prompter-only, generalized
 * once every other widget moved off useAutoFitFontSize onto this same pattern, Marco
 * 2026-09-14: "Lets take the approach from the prompter widget for all other widgets"). */
const RATIO_MIN_PERCENT = 25
const RATIO_MAX_PERCENT = 400
const RATIO_STEP_PERCENT = 5

export function SizeRatioSlider({
  label,
  ratio,
  onChange,
}: {
  label: string
  ratio: number
  onChange: (next: number) => void
}) {
  // Debounced commit (useDeferredSliderValue.ts) - committing straight through on every
  // drag tick round-trips through a real PouchDB write each time, which is what made this
  // stutter (Marco, 2026-09-14).
  const [displayRatio, onDrag, flush] = useDeferredSliderValue(ratio, onChange, label)
  const percent = Math.round(displayRatio * 100)
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-ink-faint">{percent}%</span>
      </div>
      <input
        type="range"
        min={RATIO_MIN_PERCENT}
        max={RATIO_MAX_PERCENT}
        step={RATIO_STEP_PERCENT}
        value={percent}
        onChange={(e) => onDrag(Number(e.target.value) / 100)}
        onPointerUp={flush}
        className="w-full accent-accent"
      />
    </label>
  )
}
