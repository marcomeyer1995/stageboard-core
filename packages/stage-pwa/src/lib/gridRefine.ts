import type { BeatGrid } from 'shared-types'
import { beatsBetween, clickTimeline, setPoint } from './beatGrid'
import { trackBeats } from './beatTrack'
import { barQuality } from './timeline'
import { randomId } from './id'

/**
 * "Track analysieren" on a grid that already exists (Marco, 2026-10-15): the musician's points stay
 * and new ones are added only where the click leaves the drums. Before, the analysis replaced the
 * whole grid with one built from noisy detections - many points, a jumpy tempo line, the
 * musician's own points gone.
 *
 * The beats come from a beat tracker (beatTrack.ts) started on the grid's first point, which
 * follows a tempo that wanders as a band without a click does (All the small things: 146-150.5
 * BPM, bars 16-45 half a beat off with one tempo). Then, greedily: the bar where the grid is
 * furthest from the tracked downbeat gets a point - at least `MIN_BARS_APART` from every other
 * point, so the tempo line steps rarely - until every bar is within `TOLERANCE_MS`. A point the
 * musician set stays where it is when the tracked beat agrees with it; one that is clearly off is
 * moved onto the tracked beat (and reported), since a grid hung on a wrong point is wrong
 * around it.
 */

/** A bar is fine within this distance of its tracked downbeat. */
const TOLERANCE_MS = 30
/** A musician's point within this distance of the tracked beat stays exactly where they put it. */
const AGREE_MS = 60
const MIN_BARS_APART = 6
const MAX_POINTS = 40

export interface RefineResult {
  grid: BeatGrid
  /** Bars that got a new point. */
  addedBars: number[]
  /** Bars whose existing point was moved onto the tracked beat. */
  movedBars: number[]
  /** Bars marked red (poor) before and after, against the same onsets as the timeline. */
  poorBefore: number
  poorAfter: number
}

function poorBars(grid: BeatGrid, bpm: number, timeSignature: string, onsets: readonly number[], toMs: number): number {
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  return barQuality(beatsBetween(timeline, 0, toMs), onsets).filter((b) => b.level === 'poor').length
}

export function refineGrid(grid: BeatGrid, bpm: number, timeSignature: string, onsetsMs: readonly number[]): RefineResult | null {
  const onsets = [...onsetsMs].sort((a, b) => a - b)
  const sortedPoints = [...grid.points].sort((a, b) => a.bar - b.bar)
  const anchor = sortedPoints[0]
  if (!anchor || onsets.length < 8) return null
  const endMs = onsets[onsets.length - 1]!
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature })
  const anchorBeat = timeline.barStartBeat(anchor.bar)
  const beats = trackBeats(onsets, anchor.timeMs, timeline.periodAfter(anchorBeat), endMs)

  // Tracked downbeat per bar, counted in the grid's own bars (meter changes included).
  const downbeat = new Map<number, number>()
  beats.forEach((timeMs, k) => {
    const beat = anchorBeat + k
    if (timeline.beatInBar(beat) === 0) downbeat.set(timeline.barOf(beat), timeMs)
  })
  const lastBar = Math.max(...downbeat.keys())

  // The musician's points: kept when the tracked beat agrees, else moved onto it.
  const movedBars: number[] = []
  let current: BeatGrid = { ...grid, points: [anchor] }
  for (const point of sortedPoints.slice(1)) {
    const tracked = downbeat.get(point.bar)
    const keep = tracked === undefined || Math.abs(tracked - point.timeMs) <= AGREE_MS
    if (!keep) movedBars.push(point.bar)
    current = { ...current, points: [...current.points, { ...point, timeMs: keep ? point.timeMs : Math.round(tracked!) }] }
  }

  const addedBars: number[] = []
  while (current.points.length < MAX_POINTS) {
    const tl = clickTimeline({ beatGrid: current, bpm, timeSignature })
    const taken = current.points.map((p) => p.bar)
    let worst: { bar: number; off: number } | null = null
    for (const [bar, timeMs] of downbeat) {
      if (taken.some((t) => Math.abs(t - bar) < MIN_BARS_APART)) continue
      const off = Math.abs(tl.timeOfBeat(tl.barStartBeat(bar)) - timeMs)
      if (off > TOLERANCE_MS && (!worst || off > worst.off)) worst = { bar, off }
    }
    // Bars near the song's end can only be held by a point on the last bar itself.
    if (!worst && !taken.includes(lastBar) && taken.every((t) => t < lastBar)) {
      const off = Math.abs(tl.timeOfBeat(tl.barStartBeat(lastBar)) - downbeat.get(lastBar)!)
      if (off > TOLERANCE_MS) worst = { bar: lastBar, off }
    }
    if (!worst) break
    const next = setPoint(current, worst.bar, downbeat.get(worst.bar)!, timeSignature)
    if (!next) break
    current = next
    addedBars.push(worst.bar)
  }
  // New points get ids of their own; kept ones keep theirs.
  current = { ...current, points: current.points.map((p) => (p.id ? p : { ...p, id: randomId() })) }
  return {
    grid: current,
    addedBars: addedBars.sort((a, b) => a - b),
    movedBars,
    poorBefore: poorBars(grid, bpm, timeSignature, onsets, endMs),
    poorAfter: poorBars(current, bpm, timeSignature, onsets, endMs),
  }
}
