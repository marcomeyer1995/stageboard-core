const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const
/** Black key pitch class -> the white key (index within an octave) it sits to the right of. */
const BLACK_AFTER_WHITE: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }
const OCTAVES = 2
const WHITE_WIDTH = 12
const WHITE_HEIGHT = 46
const BLACK_WIDTH = 7.5
const BLACK_HEIGHT = 28

/** Two octaves of keys with the chord tones lit (#24): the root in the accent colour, the rest in
 * the secondary one. `semitones` are the ascending offsets above the root (lookUpChord). */
export function PianoChordDiagram({ rootPitchClass, semitones }: { rootPitchClass: number; semitones: number[] }) {
  const lit = new Map<number, 'root' | 'tone'>(semitones.map((offset, index) => [rootPitchClass + offset, index === 0 ? 'root' : 'tone']))
  const fill = (absolute: number, base: string) => (lit.get(absolute) === 'root' ? 'fill-accent' : lit.get(absolute) === 'tone' ? 'fill-accent-2' : base)
  const whiteKeys = OCTAVES * WHITE_PITCH_CLASSES.length
  return (
    <svg viewBox={`0 0 ${whiteKeys * WHITE_WIDTH} ${WHITE_HEIGHT + 2}`} role="img" aria-label="Klaviatur" className="w-full max-w-xs">
      {Array.from({ length: whiteKeys }, (_, key) => {
        const octave = Math.floor(key / 7)
        const absolute = octave * 12 + WHITE_PITCH_CLASSES[key % 7]
        return <rect key={`white-${key}`} x={key * WHITE_WIDTH} y={1} width={WHITE_WIDTH} height={WHITE_HEIGHT} className={`${fill(absolute, 'fill-ink')} stroke-ink-faint`} strokeWidth={0.8} />
      })}
      {Array.from({ length: OCTAVES }, (_, octave) =>
        Object.entries(BLACK_AFTER_WHITE).map(([pitchClass, whiteIndex]) => {
          const absolute = octave * 12 + Number(pitchClass)
          const x = (octave * 7 + whiteIndex + 1) * WHITE_WIDTH - BLACK_WIDTH / 2
          return <rect key={`black-${absolute}`} x={x} y={1} width={BLACK_WIDTH} height={BLACK_HEIGHT} className={`${fill(absolute, 'fill-control')} stroke-ink-faint`} strokeWidth={0.8} />
        }),
      )}
    </svg>
  )
}
