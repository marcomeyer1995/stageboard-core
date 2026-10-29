import type { ShowCue } from 'shared-types'
import type { ClickTimeline } from './beatGrid'

/** A cue this close to a beat sits on it (times are whole ms, the grid's are fractional). */
const ON_BEAT_MS = 1

type Anchor = NonNullable<ShowCue['anchor']>

/** The bar and beat a time sits exactly on (bar 1 or later), or null for a time between beats. */
export function anchorAt(timeline: ClickTimeline, timeMs: number): Anchor | null {
  const beat = timeline.beatAtOrBefore(timeMs + ON_BEAT_MS)
  if (beat < 0 || Math.abs(timeline.timeOfBeat(beat) - timeMs) > ON_BEAT_MS) return null
  const bar = timeline.barOf(beat)
  return bar >= 1 ? { bar, beat: timeline.beatInBar(beat) + 1 } : null
}

/** Where an anchor lies on this grid, in whole ms. */
export function timeOfAnchor(timeline: ClickTimeline, anchor: Anchor): number {
  return Math.max(0, Math.round(timeline.timeOfBeat(timeline.barStartBeat(anchor.bar) + anchor.beat - 1)))
}

const byTime = (a: ShowCue, b: ShowCue) => a.timeMs - b.timeMs

/** Anchored cues at their place on this grid - after the grid or the tempo changed (#483). */
export function applyCueAnchors(cues: readonly ShowCue[], timeline: ClickTimeline): ShowCue[] {
  let changed = false
  const next = cues.map((cue) => {
    if (!cue.anchor) return cue
    const timeMs = timeOfAnchor(timeline, cue.anchor)
    if (timeMs === cue.timeMs) return cue
    changed = true
    return { ...cue, timeMs }
  })
  return changed ? next.sort(byTime) : (cues as ShowCue[])
}

/**
 * One edit of the timeline, settled (#483): a cue that is new or was moved is anchored when it
 * now sits exactly on a beat (snapping puts it there) and free otherwise; an anchored cue that
 * wasn't moved follows the grid. So a cue on bar 17 beat 1 stays there when bar 9 is re-aligned,
 * and nudging it off the beat makes it a free cue.
 */
export function settleCueAnchors(before: readonly ShowCue[], after: readonly ShowCue[], timeline: ClickTimeline): ShowCue[] {
  const previous = new Map(before.map((cue) => [cue.id, cue]))
  let changed = false
  const next = after.map((cue) => {
    const old = previous.get(cue.id)
    if (!old || old.timeMs !== cue.timeMs) {
      const anchor = anchorAt(timeline, cue.timeMs)
      if (!anchor && !cue.anchor) return cue
      if (anchor && cue.anchor && anchor.bar === cue.anchor.bar && anchor.beat === cue.anchor.beat) return cue
      changed = true
      const rest = { ...cue }
      delete rest.anchor
      return anchor ? { ...rest, anchor } : rest
    }
    if (!cue.anchor) return cue
    const timeMs = timeOfAnchor(timeline, cue.anchor)
    if (timeMs === cue.timeMs) return cue
    changed = true
    return { ...cue, timeMs }
  })
  return changed ? next.sort(byTime) : (after as ShowCue[])
}
