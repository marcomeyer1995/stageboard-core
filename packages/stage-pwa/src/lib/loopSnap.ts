import type { ClickTimeline } from './beatGrid'
import { formatLoopTime } from './loopSections'

/** What A and B of a practice loop snap to (#683, Marco 2026-11-03): the grid's bars, its beats,
 * or nothing. Off the grid the loop joint is off again, so bars is the default. */
export type LoopSnap = 'bars' | 'beats' | 'free'

/** One −/+ step in free mode. */
export const FREE_STEP_MS = 100

/** Within this a time counts as on a grid line - stored points are rounded to whole ms. */
const ON_LINE_MS = 1

/** The grid lines around `ms`: the last one at or before it and the next one after it. */
function linesAround(timeline: ClickTimeline, ms: number, snap: 'bars' | 'beats'): [number, number] {
  const beat = timeline.beatAtOrBefore(ms)
  if (snap === 'beats') return [timeline.timeOfBeat(beat), timeline.timeOfBeat(beat + 1)]
  const bar = timeline.barOf(beat)
  return [timeline.timeOfBeat(timeline.barStartBeat(bar)), timeline.timeOfBeat(timeline.barStartBeat(bar + 1))]
}

/** `ms` moved to the nearest line of `snap` - a point set by tapping a little late still lands
 * on the downbeat. Without a grid (no tempo) every mode is free. */
export function snapLoopPoint(timeline: ClickTimeline | null, ms: number, snap: LoopSnap): number {
  if (snap === 'free' || !timeline) return Math.max(0, Math.round(ms))
  const [before, after] = linesAround(timeline, ms, snap)
  return Math.max(0, Math.round(ms - before <= after - ms ? before : after))
}

/** `ms` moved one step of `snap` in `direction` - from a line to the next one, from between two
 * lines to the nearer one in that direction. */
export function stepLoopPoint(timeline: ClickTimeline | null, ms: number, snap: LoopSnap, direction: 1 | -1): number {
  if (snap === 'free' || !timeline) return Math.max(0, Math.round(ms + direction * FREE_STEP_MS))
  const [before, after] = linesAround(timeline, ms, snap)
  const onLine = ms - before < ON_LINE_MS ? before : after - ms < ON_LINE_MS ? after : null
  let next: number
  if (onLine === null) next = direction > 0 ? after : before
  else next = linesAround(timeline, onLine + direction * ON_LINE_MS * 2, snap)[direction > 0 ? 1 : 0]
  return Math.max(0, Math.round(next))
}

/** The readout for a loop point: its bar ("12"), bar and beat ("12.3") or time ("1:23.4"). */
export function formatLoopPoint(timeline: ClickTimeline | null, ms: number, snap: LoopSnap): string {
  if (snap === 'free' || !timeline) return formatLoopTime(ms)
  const beat = timeline.beatAtOrBefore(ms + ON_LINE_MS)
  const bar = timeline.barOf(beat)
  if (snap === 'bars') return String(bar)
  return `${bar}.${timeline.beatInBar(beat) + 1}`
}
