import { AnnouncementSettingsSchema, type AnnouncementSettings } from 'shared-types'
import type { ClickTimeline } from './beatGrid'
import { parsePartDirective } from './chordpro'
import { beatsPerBar } from './metronome'
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
 * beat - optionally a countdown on the last pulses before it ("3, 2, 1", by default on the meter's
 * main pulses so the numbers aren't crammed onto every beat), its name on the pulse before the
 * countdown or `nameBarsBefore` bars ahead on the downbeat, and a word on its first beat ("Los").
 * All on the click grid, so tempo and meter changes are followed.
 *
 * The count-in (`countIn`): `announce` treats the part on bar 1 like any other, inside the count-in
 * bars; `count` speaks the count-in instead (countInWords); `click` says nothing before bar 1.
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
  if (opts.countIn === 'count') events.push(...countInWords(timeline, opts, number))
  for (const part of partBlocks(timelineLines(content), Number.POSITIVE_INFINITY)) {
    const text = spoken(part.label)
    if (!text) continue
    const bar = nearestBar(timeline, part.startMs)
    if (bar <= 1 && opts.countIn !== 'announce') continue
    const startBeat = timeline.barStartBeat(bar)
    const words: Announcement[] = []
    let nameMs = timeline.timeOfBeat(timeline.barStartBeat(bar - opts.nameBarsBefore))
    if (opts.countdown.enabled) {
      const pulses = pulsesBefore(timeline, startBeat, opts.countdown.beats + 1, opts.countdown.spacing)
      // pulses[0] is the one before the first number - the name's place by default, and always
      // when "n bars before" would put the name in the middle of the countdown.
      pulses.slice(1).forEach((beat, i) => words.push({ text: number(opts.countdown.beats - i), atMs: timeline.timeOfBeat(beat), bar, kind: 'count' }))
      const beforeCountdownMs = timeline.timeOfBeat(pulses[0]!)
      if (opts.nameAt === 'before-countdown' || nameMs > beforeCountdownMs) nameMs = beforeCountdownMs
    }
    words.push({ text, atMs: nameMs, bar, kind: 'name' })
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

/**
 * The spoken count-in (#63): `half-then-full` counts the earlier count-in bars on the meter's main
 * pulses ("1 – 2 –") and the last one on every beat ("1 2 3 4") - the classic band count-in;
 * `every-beat` counts every beat; `last-bar` only the last count-in bar. The last beat can be
 * silent or a word of its own ("1 2 3 Los").
 */
function countInWords(timeline: ClickTimeline, opts: AnnouncementSettings, number: (n: number) => string): Announcement[] {
  const words: Announcement[] = []
  for (let beat = timeline.firstBeat; beat < 0; beat++) {
    const inBar = timeline.beatInBar(beat)
    let n = inBar + 1
    if (timeline.barOf(beat) < 0) {
      if (opts.countInPattern === 'last-bar') continue
      if (opts.countInPattern === 'half-then-full') {
        const pulses = pulseOffsets(timeline.timeSignatureAt(beat), 'pulse')
        if (!pulses.includes(inBar)) continue
        n = pulses.indexOf(inBar) + 1
      }
    }
    let text = number(n)
    if (beat === -1 && opts.countInEnd === 'silent') continue
    if (beat === -1 && opts.countInEnd === 'word' && opts.countInEndWord.trim()) text = opts.countInEndWord.trim()
    words.push({ text, atMs: timeline.timeOfBeat(beat), bar: 1, kind: 'count-in' })
  }
  return words
}

type Spacing = AnnouncementSettings['countdown']['spacing']

/**
 * The beats inside a bar (0 = downbeat) a countdown lands on. `pulse` = the meter's main pulses,
 * how musicians feel it: 4/4 on 1 and 3, 2/4 and 3/4 once a bar, compound meters (6/8, 9/8, 12/8)
 * every dotted beat, 5/x as 3+2, 7/8 as 2+2+3, other odd meters as twos ending in a three.
 */
export function pulseOffsets(timeSignature: string, spacing: Spacing): number[] {
  const [num, den] = timeSignature.split('/').map((n) => Number.parseInt(n, 10))
  const perBar = beatsPerBar(timeSignature)
  const every = (step: number) => Array.from({ length: Math.ceil(perBar / step) }, (_, i) => i * step)
  if (spacing === 'beat') return every(1)
  if (spacing === 'bar') return [0]
  if (spacing === 'half') return every(2)
  if (den === 8 && num !== undefined && num % 3 === 0) return every(3)
  if (perBar <= 3) return [0]
  if (perBar === 5) return [0, 3]
  if (perBar % 2 === 0) return every(2)
  // Odd: twos, the last group a three (7 = 2+2+3, 9/4 = 2+2+2+3).
  return every(2).slice(0, -1)
}

/** The last `count` countdown pulses before `beat`, earliest first - across bar lines and meter changes. */
function pulsesBefore(timeline: ClickTimeline, beat: number, count: number, spacing: Spacing): number[] {
  const found: number[] = []
  for (let b = beat - 1; found.length < count && b > beat - count * 32; b--) {
    if (pulseOffsets(timeline.timeSignatureAt(b), spacing).includes(timeline.beatInBar(b))) found.unshift(b)
  }
  return found
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
