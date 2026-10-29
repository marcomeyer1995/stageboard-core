import type { BeatGrid, RigCheckPathScore } from 'shared-types'
import { computeSpectralFlux, detectBeats, detectFirstOnset, detectOnsets, detectTempo } from './audioAnalysis'
import { clickTimeline, gridFromBeats } from './beatGrid'
import { refineGrid } from './gridRefine'
import type { RigCheckSong } from './rigCheckSong'

/**
 * The analysis check of the full Rig-Check run (#464, docs/24 §6): the timeline editor's own
 * analysis on the generated track, compared with the ground truth section by section - so a change
 * that makes the analysis worse shows up at once, as a number, not as a feeling on one real song.
 *
 * Two paths, as the editor offers them:
 * - **Neu erkennen** (SheetEditor "Track analysieren" without a grid): tempo + beats from the
 *   built-in detector, turned into a grid (`gridFromBeats`). Knows nothing about meters.
 * - **Verfeinern** (Timeline "Track analysieren" with a grid, #517-#520): the musician has set bar 1
 *   and the meter changes; the beat tracker adds points where the click leaves the drums.
 */

/** A beat counts as hit within this distance of the truth (docs/24 §6). */
export const HIT_MS = 15

export type PathScore = RigCheckPathScore
export type SectionScore = PathScore['sections'][number]

export interface AnalysisCheck {
  sampleRate: number
  detect: PathScore | null
  refine: PathScore | null
}

/** The rate the check runs at: what Android tablets decode tracks to (their output rate). */
export const ANALYSIS_SAMPLE_RATE = 48000

const round1 = (n: number) => Math.round(n * 10) / 10

const rate = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 1000 : 0)

/**
 * Every truth beat against the nearest beat of the grid - how far the click is from the drums - and
 * whether that grid beat has the truth's number, counted from bar 1 (a slipped count puts the bars
 * in the wrong place even where the click sits on a drum hit). A rest has no sound to compare.
 */
export function scoreGrid(song: RigCheckSong, grid: BeatGrid, bpm: number, timeSignature: string): PathScore {
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  const bar1Beat = timeline.barStartBeat(1)
  const bySection = new Map<string, { off: number; slipped: boolean }[]>()
  song.beats.forEach((truth, index) => {
    if (truth.silent) return
    const before = timeline.beatAtOrBefore(truth.timeMs)
    const nearest = truth.timeMs - timeline.timeOfBeat(before) <= timeline.timeOfBeat(before + 1) - truth.timeMs ? before : before + 1
    const off = Math.abs(timeline.timeOfBeat(nearest) - truth.timeMs)
    bySection.set(truth.section, [...(bySection.get(truth.section) ?? []), { off, slipped: nearest !== bar1Beat + index }])
  })
  const sections = song.sections.map((s): SectionScore => {
    const list = bySection.get(s.name) ?? []
    const offs = list.map((x) => x.off)
    const silent = song.beats.some((b) => b.section === s.name && b.silent)
    const inBarChange = song.approximateBars.some((bar) => bar >= s.bar && bar < s.bar + s.bars)
    return {
      name: s.name,
      label: s.label,
      beats: offs.length,
      hitRate: rate(offs.filter((o) => o <= HIT_MS).length, offs.length),
      meanAbsMs: offs.length ? round1(offs.reduce((a, b) => a + b, 0) / offs.length) : 0,
      maxAbsMs: offs.length ? round1(Math.max(...offs)) : 0,
      slipRate: rate(list.filter((x) => x.slipped).length, list.length),
      knownLimit: inBarChange ? 'change-in-bar' : silent ? 'silent' : null,
    }
  })
  return { bpm: round1(60000 / timeline.periodAfter(bar1Beat)), gridPoints: grid.points.length, sections }
}

/** Runs both paths on the track's samples (mono) and scores them. */
export function analysisCheck(song: RigCheckSong, mono: Float32Array, sampleRate: number): AnalysisCheck {
  const envelope = computeSpectralFlux(mono, sampleRate)

  let detect: PathScore | null = null
  const first = detectFirstOnset(envelope)
  const tempo = detectTempo(envelope.flux, envelope.hopMs)
  if (first && tempo) {
    const bpm = Math.round(tempo.bpm * 10) / 10
    const beats = detectBeats(envelope.flux, envelope.hopMs, bpm, song.timeSignature, first.onsetMs)
    const grid = gridFromBeats(beats, bpm, song.timeSignature)
    if (grid) detect = scoreGrid(song, grid, bpm, song.timeSignature)
  }

  // The musician's start: bar 1 where it is, the meters as in the song, the first tempo.
  const onsets = detectOnsets(envelope).map((o) => o.timeMs)
  const start: BeatGrid = { points: [{ id: 'bar-1', bar: 1, timeMs: Math.round(song.sections[0]!.timeMs) }], meters: song.grid.meters }
  const refined = refineGrid(start, song.bpm, song.timeSignature, onsets)
  const refine = refined ? scoreGrid(song, refined.grid, song.bpm, song.timeSignature) : null

  return { sampleRate, detect, refine }
}

/** Runs the check in a Web Worker (rigCheckAnalysisWorker.ts). */
export function runAnalysisCheck(kind: 'quick' | 'full'): Promise<AnalysisCheck> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./rigCheckAnalysisWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ ok: true; result: AnalysisCheck } | { ok: false; error: string }>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage({ kind })
  })
}
