import type { ClickTimeline } from './beatGrid'
import { partBlocks, timelineLines } from './timelineText'

/** One spoken section announcement (#63): what is said, and when (song time). */
export interface Announcement {
  text: string
  /** Song time the voice starts: the downbeat `LEAD_BARS` before the section's bar. */
  atMs: number
  /** Bar the section starts on. */
  bar: number
}

/** Announced a bar ahead - what Prime does, and time enough to hear it and get ready. */
export const LEAD_BARS = 1

/**
 * The spoken announcements of a song: one per part with a name (`{start_of_chorus}`,
 * `{part: Bridge}` …, docs/14 §6) whose first line has a time. The part start is rounded to the
 * nearest bar line - sung lines often begin just before the beat - and the voice starts on the
 * downbeat one bar earlier, on the click grid (tempo changes included). An announcement that would
 * fall before the first click (a part on bar 1 without a count-in) is left out.
 */
export function sectionAnnouncements(content: string, timeline: ClickTimeline): Announcement[] {
  const firstClickMs = timeline.timeOfBeat(timeline.firstBeat)
  const out: Announcement[] = []
  for (const part of partBlocks(timelineLines(content), Number.POSITIVE_INFINITY)) {
    const text = part.label?.trim()
    if (!text) continue
    const bar = nearestBar(timeline, part.startMs)
    const atMs = timeline.timeOfBeat(timeline.barStartBeat(bar - LEAD_BARS))
    if (atMs < firstClickMs - 1e-6) continue
    if (out.length > 0 && out[out.length - 1]!.bar === bar) continue // two parts snapped onto one bar: the first one
    out.push({ text, atMs, bar })
  }
  return out
}

function nearestBar(timeline: ClickTimeline, timeMs: number): number {
  const bar = timeline.barOf(timeline.beatAtOrBefore(timeMs))
  const here = timeline.timeOfBeat(timeline.barStartBeat(bar))
  const next = timeline.timeOfBeat(timeline.barStartBeat(bar + 1))
  return timeMs - here <= next - timeMs ? bar : bar + 1
}

/** A voice may still start this late (song ms) - a word 150 ms late is still useful, later it
 * collides with the section it announces. */
export const ANNOUNCEMENT_LATE_TOLERANCE_MS = 150

/**
 * Which announcements to hand to Web Audio now: those starting before `elapsedMs + lookaheadMs`
 * that weren't handed over yet. Ones already more than ANNOUNCEMENT_LATE_TOLERANCE_MS in the past
 * (joined mid-song, a stalled tab) are marked done without playing. `done` is updated in place.
 */
export function announcementsDue(items: readonly Announcement[], elapsedMs: number, lookaheadMs: number, done: Set<number>): { index: number; inMs: number }[] {
  const due: { index: number; inMs: number }[] = []
  items.forEach((item, index) => {
    if (done.has(index) || item.atMs >= elapsedMs + lookaheadMs) return
    done.add(index)
    if (item.atMs < elapsedMs - ANNOUNCEMENT_LATE_TOLERANCE_MS) return
    due.push({ index, inMs: item.atMs - elapsedMs })
  })
  return due
}
