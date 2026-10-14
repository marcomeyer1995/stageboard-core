import { AnnouncementSettingsSchema, CUE_BEAT, CUE_NAME, type AnnouncementSettings } from 'shared-types'
import type { ClickTimeline } from './beatGrid'
import { parsePartDirective } from './chordpro'
import { partHeads } from './partCues'
import { partBlocks, timelineLines } from './timelineText'

/** One spoken word or phrase (#63): what is said, and when (song time). */
export interface Announcement {
  text: string
  /** Song time the voice starts - always on a beat of the click grid. */
  atMs: number
  /** Bar the announced part starts on (count-in words: 1). */
  bar: number
}

/**
 * The spoken announcements of a song, from the band's cue patterns (AnnouncementSettings): for
 * every part (`{start_of_chorus}`, `{part: Bridge}` …, docs/14 §6) whose first line has a time - the
 * part start rounded to the nearest bar line, sung lines often begin just before the beat - the
 * part pattern laid over the bars right before it, one cell per beat; bar 1 gets the count-in
 * pattern over the count-in bars instead. Cells follow the real bars (meter and tempo changes), a
 * cell before the previous part's start is left out - the earlier announcement finishes first -
 * and so is anything before the first click. A muted part (`texts: null`) says nothing at all. A
 * part with its own pattern (`{x_announce}` in the text, partCues.ts) uses that one instead - also
 * on bar 1, in place of the count-in pattern.
 */
export function sectionAnnouncements(content: string, timeline: ClickTimeline, settings: Partial<AnnouncementSettings> = {}): Announcement[] {
  const opts = AnnouncementSettingsSchema.parse(settings)
  const spoken = spokenTexts(opts.texts)
  const number = (n: number) => opts.numberWords[n - 1]?.trim() || String(n)

  const own = new Map(partHeads(content).map((head) => [head.partIndex, head.cue]))
  const parts = partBlocks(timelineLines(content), Number.POSITIVE_INFINITY)
    .map((part) => ({ text: spoken(part.label), bar: nearestBar(timeline, part.startMs), named: !!part.label?.trim(), cue: own.get(part.partIndex) ?? null }))
    .filter((part) => part.named)
    .sort((a, b) => a.bar - b.bar)
  const events: Announcement[] = []
  let previousStartBeat = timeline.firstBeat
  const countInAt = parts.find((part) => part.bar <= 1)
  // Bar 1: the count-in pattern, also without a part there (a plain count-in).
  // A part's own pattern wins over the band's mute of its name - only its name cells stay silent.
  const starts = [
    { text: countInAt ? countInAt.text : null, bar: 1, pattern: countInAt?.cue ?? opts.countInCue, muted: countInAt !== undefined && countInAt.text === null && !countInAt.cue },
  ]
  for (const part of parts) if (part.bar > 1) starts.push({ text: part.text, bar: part.bar, pattern: part.cue ?? opts.partCue, muted: part.text === null && !part.cue })
  for (const start of starts) {
    const startBeat = timeline.barStartBeat(start.bar)
    if (!start.muted) {
      start.pattern.forEach((cells, i) => {
        const bar = start.bar - (start.pattern.length - i)
        const first = timeline.barStartBeat(bar)
        const beats = timeline.barStartBeat(bar + 1) - first
        for (let k = 0; k < Math.min(beats, cells.length); k++) {
          const beat = first + k
          if (beat < previousStartBeat || beat < timeline.firstBeat) continue
          const text = cellText(cells[k]!, start.text, number(k + 1))
          if (text) events.push({ text, atMs: timeline.timeOfBeat(beat), bar: start.bar })
        }
      })
    }
    previousStartBeat = Math.max(previousStartBeat, startBeat)
  }
  return events
}

function cellText(cell: string, name: string | null, beatNumber: string): string | null {
  const value = cell.trim()
  if (!value) return null
  if (value === CUE_NAME) return name
  if (value === CUE_BEAT) return beatNumber
  return value
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

/** The bar a part starts on: its first line's time rounded to the nearest bar line. */
export function nearestBar(timeline: ClickTimeline, timeMs: number): number {
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
