import type { BeatAnchorLike, TempoMarkerLike } from '../lib/metronome'
import { tempoMapFor, type TempoMapQuality } from '../lib/tempoMap'

const VERDICT: Record<TempoMapQuality['verdict'], { label: string; className: string }> = {
  good: { label: 'Klick-Raster: gut', className: 'border-green-600 text-green-500' },
  check: { label: 'Klick-Raster: bitte prüfen', className: 'border-amber-500 text-amber-500' },
  poor: { label: 'Klick-Raster: unzuverlässig', className: 'border-red-600 text-red-500' },
}

const number = (value: number) => value.toLocaleString('de-DE', { maximumFractionDigits: 1 })

/**
 * What playback makes of a variant's beat anchors (lib/tempoMap.ts, docs/13): the fitted tempo,
 * how much per-beat scatter gets smoothed away, and what looks wrong in the anchors themselves -
 * so a song that needs re-anchoring shows up while editing, not as a stumbling click on stage.
 */
export function TempoMapQualityNote({
  anchors,
  bpm,
  timeSignature,
  tempoMarkers,
  onAdoptBpm,
}: {
  anchors: readonly BeatAnchorLike[]
  bpm: number
  timeSignature: string
  tempoMarkers: readonly TempoMarkerLike[]
  onAdoptBpm: (bpm: number) => void
}) {
  const { beats, quality } = tempoMapFor({ beatAnchors: anchors, bpm, timeSignature, tempoMarkers })
  if (!quality) return null
  const verdict = VERDICT[quality.verdict]
  const issues: string[] = []
  if (quality.duplicates > 0) issues.push(`${quality.duplicates} doppelte Anker werden ignoriert (weniger als 2/3 Schlag Abstand)`)
  if (quality.outliers > 0) issues.push(`${quality.outliers} Anker liegen weit neben dem Raster und werden ignoriert`)
  if (quality.ambiguousGaps > 0) issues.push(`${quality.ambiguousGaps} Lücken lassen sich nicht sauber in Schläge teilen - Takt dort prüfen`)
  if (quality.longestGapBeats > 16) issues.push(`Längste Strecke ohne Anker: ${quality.longestGapBeats} Schläge`)
  if (quality.beatInBarConflicts > 0) issues.push(`${quality.beatInBarConflicts} Anker haben eine abweichende Taktposition - die Mehrheit bestimmt die Eins`)
  const bpmOff = Math.abs(quality.nominalOffPercent) >= 2

  return (
    <div role="status" className={`flex flex-col gap-1 rounded-sb border-l-4 bg-control px-3 py-2 text-sm ${verdict.className}`}>
      <span className="font-bold">{verdict.label}</span>
      <span className="text-ink-soft">
        {quality.observations} Anker → {beats.length} Schläge, gemessen {number(quality.bpm)} BPM
        {quality.bpmHigh - quality.bpmLow >= 0.5 ? ` (${number(quality.bpmLow)}-${number(quality.bpmHigh)})` : ''}. Streuung der
        Anker ±{quality.noiseMs} ms - der Klick folgt dem geglätteten Raster, nicht jedem einzelnen Anker.
      </span>
      {bpmOff && (
        <span className="flex flex-wrap items-center gap-2 text-ink-soft">
          Eingetragenes Tempo {number(bpm)} BPM liegt {number(Math.abs(quality.nominalOffPercent))} %{' '}
          {quality.nominalOffPercent < 0 ? 'unter' : 'über'} dem gemessenen.
          <button
            type="button"
            onClick={() => onAdoptBpm(quality.bpm)}
            className="min-h-12 rounded-sb-sm bg-control-strong px-3 font-semibold text-ink hover:bg-control-strong-hover"
          >
            {number(quality.bpm)} BPM übernehmen
          </button>
        </span>
      )}
      {issues.length > 0 && (
        <ul className="list-disc pl-5 text-ink-soft">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
