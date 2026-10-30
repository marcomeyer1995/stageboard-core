import type { BeatGrid, ShowCue } from 'shared-types'
import { clickTimeline, scaleGridTempo, type ClickTimeline } from './beatGrid'
import { anchorAt } from './cueAnchors'
import { formatBarDirective, parseBarDirective } from './partStart'

interface TempoScalable {
  bpm: number
  beatGrid?: BeatGrid
  timeSignature: string
  cues: ShowCue[]
  chordProContent: string
}

/** The bar a moment lies in (bar 1 or later). */
function barAt(timeline: ClickTimeline, timeMs: number): number {
  return Math.max(1, timeline.barOf(timeline.beatAtOrBefore(timeMs + 1)))
}

/**
 * Tempo ×2 / ÷2 (#654) for a whole song, not just its grid: what is anchored to a bar number keeps
 * its moment in the track. A cue anchored to bar 33 stayed "bar 33" before - after ×2 that bar lies
 * at half the time, so a "Track normal" cue jumped in front of the "Track stumm" before it and the
 * track stayed silent (2026-10-29). Cues keep their time and take the bar and beat they sit on in
 * the new grid (none, between two beats after ÷2: then they are free cues); a section start set by
 * hand (`{x_bar: n}`) becomes the bar it lies in.
 */
export function scaleSongTempo<T extends TempoScalable>(song: T, factor: 2 | 0.5): Pick<T, 'bpm' | 'beatGrid' | 'cues' | 'chordProContent'> {
  const scaled = song.beatGrid ? scaleGridTempo(song.beatGrid, song.bpm, factor) : { beatGrid: undefined, bpm: Math.round(song.bpm * factor * 10) / 10 }
  const before = clickTimeline({ beatGrid: song.beatGrid, bpm: song.bpm, timeSignature: song.timeSignature })
  const after = clickTimeline({ beatGrid: scaled.beatGrid, bpm: scaled.bpm, timeSignature: song.timeSignature })
  const cues = song.cues.map((cue) => {
    if (!cue.anchor) return cue
    const anchor = anchorAt(after, cue.timeMs)
    const rest = { ...cue }
    delete rest.anchor
    return anchor ? { ...rest, anchor } : rest
  })
  const chordProContent = song.chordProContent
    .split('\n')
    .map((line) => {
      const bar = parseBarDirective(line)
      if (bar === null || bar < 1) return line
      return formatBarDirective(barAt(after, before.timeOfBeat(before.barStartBeat(bar))))
    })
    .join('\n')
  return { bpm: scaled.bpm, beatGrid: scaled.beatGrid, cues, chordProContent } as Pick<T, 'bpm' | 'beatGrid' | 'cues' | 'chordProContent'>
}
