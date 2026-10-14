import { AnnouncementSettingsSchema, type AnnouncementSettings } from 'shared-types'
import type { ClickTimeline } from './beatGrid'
import { parsePartDirective } from './chordpro'
import { partBlocks, timelineLines } from './timelineText'

/** One spoken word or phrase (#63): what is said, and when (song time). */
export interface Announcement {
  text: string
  /** Song time the voice starts - always on a beat of the click grid. */
  atMs: number
  /** Bar the announced part starts on (count-in words: 1). */
  bar: number
  /** The part's name, a countdown number, the word on the part's first beat, or a spoken count-in beat. */
  kind: 'name' | 'count' | 'go' | 'count-in'
}

const KIND_ORDER: Record<Announcement['kind'], number> = { 'count-in': 0, name: 1, count: 2, go: 3 }

/**
 * The spoken announcements of a song, from the band's settings (AnnouncementSettings): for every
 * part with a name (`{start_of_chorus}`, `{part: Bridge}` …, docs/14 §6) whose first line has a
 * time - the part start rounded to the nearest bar line, sung lines often begin just before the
 * beat - its name `nameBarsBefore` bars ahead on the downbeat, optionally a countdown on the last
 * beats before it ("3, 2, 1") and a word on its first beat ("Los"). All on the click grid, so
 * tempo changes and curves are followed.
 *
 * The count-in (`countIn`): `announce` treats the part on bar 1 like any other, inside the count-in
 * bars; `count` speaks the count-in beats instead ("1, 2, 3, 4"); `click` says nothing before bar 1.
 * Nothing is said before the first click. Words never pile up: one that would not come strictly
 * after the word before it is left out - parts close together lose their name first, then
 * countdown numbers.
 */
export function sectionAnnouncements(content: string, timeline: ClickTimeline, settings: Partial<AnnouncementSettings> = {}): Announcement[] {
  const opts = AnnouncementSettingsSchema.parse(settings)
  const firstClickMs = timeline.timeOfBeat(timeline.firstBeat) - 1e-6
  const bar1Ms = timeline.timeOfBeat(0) - 1e-6
  const spoken = spokenTexts(opts.texts)
  const number = (n: number) => opts.countdown.words[n - 1]?.trim() || String(n)

  const events: Announcement[] = []
  if (opts.countIn === 'count') {
    for (let beat = timeline.firstBeat; beat < 0; beat++) {
      events.push({ text: number(timeline.beatInBar(beat) + 1), atMs: timeline.timeOfBeat(beat), bar: 1, kind: 'count-in' })
    }
  }
  for (const part of partBlocks(timelineLines(content), Number.POSITIVE_INFINITY)) {
    const text = spoken(part.label)
    if (!text) continue
    const bar = nearestBar(timeline, part.startMs)
    if (bar <= 1 && opts.countIn !== 'announce') continue
    const startBeat = timeline.barStartBeat(bar)
    const words: Announcement[] = [{ text, atMs: timeline.timeOfBeat(timeline.barStartBeat(bar - opts.nameBarsBefore)), bar, kind: 'name' }]
    if (opts.countdown.enabled) {
      for (let n = opts.countdown.beats; n >= 1; n--) words.push({ text: number(n), atMs: timeline.timeOfBeat(startBeat - n), bar, kind: 'count' })
    }
    const go = opts.countdown.enabled ? opts.countdown.go?.trim() : undefined
    if (go) words.push({ text: go, atMs: timeline.timeOfBeat(startBeat), bar, kind: 'go' })
    words.sort((a, b) => a.atMs - b.atMs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    for (const word of words) {
      if (word.atMs < firstClickMs) continue
      if (opts.countIn !== 'announce' && word.atMs < bar1Ms) continue
      events.push(word)
    }
  }
  const out: Announcement[] = []
  for (const event of events) {
    const last = out[out.length - 1]
    if (last && event.atMs <= last.atMs + 1e-6) continue
    out.push(event)
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
