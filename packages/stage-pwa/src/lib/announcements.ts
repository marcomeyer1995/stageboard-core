import type { ClickTimeline } from './beatGrid'
import { parsePartDirective } from './chordpro'
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
export function sectionAnnouncements(content: string, timeline: ClickTimeline, texts: Readonly<Record<string, string | null>> = {}): Announcement[] {
  const firstClickMs = timeline.timeOfBeat(timeline.firstBeat)
  const spoken = spokenTexts(texts)
  const out: Announcement[] = []
  for (const part of partBlocks(timelineLines(content), Number.POSITIVE_INFINITY)) {
    const text = spoken(part.label)
    if (!text) continue
    const bar = nearestBar(timeline, part.startMs)
    const atMs = timeline.timeOfBeat(timeline.barStartBeat(bar - LEAD_BARS))
    if (atMs < firstClickMs - 1e-6) continue
    if (out.length > 0 && out[out.length - 1]!.bar === bar) continue // two parts snapped onto one bar: the first one
    out.push({ text, atMs, bar })
  }
  return out
}

/**
 * What is said for a part name, from the band's list (AnnouncementSettings): its own text, `null`
 * = not announced, no entry or an empty text = the name as written. Matched ignoring case and
 * surrounding spaces, so "chorus" in one song and "Chorus" in another share one entry.
 */
export function spokenTexts(texts: Readonly<Record<string, string | null>>): (label: string | null) => string | null {
  const byName = new Map(Object.entries(texts).map(([name, text]) => [name.trim().toLowerCase(), text]))
  return (label) => {
    const name = label?.trim()
    if (!name) return null
    const entry = byName.get(name.toLowerCase())
    if (entry === null) return null
    return entry?.trim() || name
  }
}

/** Every part name used in these songs, as first written - the rows of the band's list. */
export function partNames(contents: Iterable<string>): string[] {
  const names = new Map<string, string>()
  for (const content of contents) {
    for (const line of content.split('\n')) {
      const label = parsePartDirective(line)?.label?.trim()
      if (label && !names.has(label.toLowerCase())) names.set(label.toLowerCase(), label)
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'de'))
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
