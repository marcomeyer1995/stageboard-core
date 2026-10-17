import type { ClickTimeline } from './beatGrid'
import type { ChordProLine } from './chordpro'
import { loopSections } from './loopSections'

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

/** The bar line nearest to `ms` - a part's first time tag may sit a few ms off the grid. */
export function snapToBar(timeline: ClickTimeline, ms: number): number {
  const bar = timeline.barOf(timeline.beatAtOrBefore(ms))
  const before = timeline.timeOfBeat(timeline.barStartBeat(bar))
  const after = timeline.timeOfBeat(timeline.barStartBeat(bar + 1))
  return ms - before <= after - ms ? before : after
}

/**
 * The song's sections from its timeline parts (Marco, 2026-10-17: the parts already in the
 * timeline, no extra lane) - each start snapped to its bar line. Parts that snap onto the same bar
 * keep the first.
 */
export function showSections(lines: readonly ChordProLine[], timeline: ClickTimeline, trackDurationMs: number | null): ShowSection[] {
  const starts: { label: string; startMs: number }[] = []
  for (const section of loopSections(lines, trackDurationMs)) {
    const startMs = Math.max(0, snapToBar(timeline, section.startMs))
    if (starts.some((s) => s.startMs === startMs)) continue
    starts.push({ label: section.label, startMs })
  }
  starts.sort((a, b) => a.startMs - b.startMs)
  return starts.map((section, index) => ({ ...section, endMs: starts[index + 1]?.startMs ?? trackDurationMs }))
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
