import type { ClickTimeline } from './beatGrid'
import { parseChordPro } from './chordpro'
import { partStartBars } from './partStart'

/** One section of the song for jumping and looping in the show (#479). */
export interface ShowSection {
  label: string
  /** On a bar line of the click grid - a jump lands on a downbeat. */
  startMs: number
  /** Where the next section starts, or the track's end for the last one; null when unknown. */
  endMs: number | null
}

/** When a queued jump happens (#479, Marco 2026-10-17: selectable per jump, like Prime). */
export type JumpWhen = 'bar' | 'section'

/** The bar line nearest to `ms`. */
export function snapToBar(timeline: ClickTimeline, ms: number): number {
  const bar = timeline.barOf(timeline.beatAtOrBefore(ms))
  const before = timeline.timeOfBeat(timeline.barStartBeat(bar))
  const after = timeline.timeOfBeat(timeline.barStartBeat(bar + 1))
  return ms - before <= after - ms ? before : after
}

/** From this far into a bar a singer's entry is a pickup to the next one (Marco, 2026-10-17: the
 * last quarter - otherwise the section starts with the bar the entry falls in). */
export const PICKUP_FROM = 0.75

/** Where a part whose first line comes in at `entryMs` starts as a section: the bar the entry falls
 * in, or the next one for an entry in the bar's last quarter (a pickup). */
export function sectionStartForEntry(timeline: ClickTimeline, entryMs: number): number {
  const bar = timeline.barOf(timeline.beatAtOrBefore(entryMs))
  const start = timeline.timeOfBeat(timeline.barStartBeat(bar))
  const next = timeline.timeOfBeat(timeline.barStartBeat(bar + 1))
  return (entryMs - start) / (next - start) >= PICKUP_FROM ? next : start
}

/** A part's start as a section: its bar, the time, and whether it was set by hand. */
export interface PartSectionStart {
  partIndex: number
  label: string
  bar: number
  startMs: number
  manual: boolean
}

/** Every named part with a start - set by hand in the timeline (`{x_bar}`, partStart.ts), or from
 * its first timed line (sectionStartForEntry). In part order. */
export function partSectionStarts(content: string, timeline: ClickTimeline): PartSectionStart[] {
  const bars = partStartBars(content)
  const firstLine = new Map<number, { label: string | null; timeMs: number | null }>()
  for (const line of parseChordPro(content)) {
    const known = firstLine.get(line.partIndex)
    if (!known) firstLine.set(line.partIndex, { label: line.partLabel, timeMs: line.timeMs })
    else if (known.timeMs === null && line.timeMs !== null) firstLine.set(line.partIndex, { ...known, timeMs: line.timeMs })
  }
  const result: PartSectionStart[] = []
  for (const [partIndex, part] of firstLine) {
    if (part.label === null) continue
    const manualBar = bars.get(partIndex)
    if (manualBar !== undefined) {
      result.push({ partIndex, label: part.label, bar: manualBar, startMs: timeline.timeOfBeat(timeline.barStartBeat(manualBar)), manual: true })
      continue
    }
    if (part.timeMs === null) continue
    const startMs = sectionStartForEntry(timeline, part.timeMs)
    result.push({ partIndex, label: part.label, bar: timeline.barOf(timeline.beatAtOrBefore(startMs + 1)), startMs, manual: false })
  }
  return result
}

/**
 * The song's sections from its timeline parts (Marco, 2026-10-17: the parts already in the
 * timeline, no extra lane), in time order, each ending where the next starts. Parts on the same bar
 * keep the first.
 */
export function showSections(content: string, timeline: ClickTimeline, trackDurationMs: number | null): ShowSection[] {
  const starts: { label: string; startMs: number }[] = []
  for (const part of partSectionStarts(content, timeline)) {
    const startMs = Math.max(0, part.startMs)
    if (starts.some((s) => s.startMs === startMs)) continue
    starts.push({ label: part.label, startMs })
  }
  starts.sort((a, b) => a.startMs - b.startMs)
  return starts.map(({ label, startMs }, index) => ({ label, startMs, endMs: starts[index + 1]?.startMs ?? trackDurationMs }))
}

/** The section playing at `ms` - the last one starting at or before it; -1 before the first. */
export function sectionIndexAt(sections: readonly ShowSection[], ms: number): number {
  let index = -1
  sections.forEach((section, i) => {
    if (section.startMs <= ms) index = i
  })
  return index
}

/** The first bar line after `ms`. */
export function nextBarStart(timeline: ClickTimeline, ms: number): number {
  const bar = timeline.barOf(timeline.beatAtOrBefore(ms))
  return timeline.timeOfBeat(timeline.barStartBeat(bar + 1))
}

/**
 * Where a jump queued now leaves the song: the next bar line, or the end of the section playing -
 * both at or after `earliestMs` (now plus the notice every device needs). Null when the section has
 * no known end (the last one, without a track length).
 */
export function jumpBoundary(when: JumpWhen, earliestMs: number, sections: readonly ShowSection[], timeline: ClickTimeline): number | null {
  if (when === 'bar') return nextBarStart(timeline, earliestMs)
  const current = sections[sectionIndexAt(sections, earliestMs)]
  if (!current) return sections[0]?.startMs ?? null
  return current.endMs !== null && current.endMs > earliestMs ? current.endMs : null
}
