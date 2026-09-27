import type { ClickTimeline } from './beatGrid'

/** Parses a "4/4"/"6/8"-style time signature into its beat count. Anything unparseable (an
 * empty string, a doc predating #25, a typo) falls back to 4/4 rather than throwing - a
 * metronome that assumes straight time is a far better failure mode than a crashed widget. */
export function beatsPerBar(timeSignature: string): number {
  const beats = Number.parseInt(timeSignature.split('/')[0] ?? '', 10)
  return Number.isFinite(beats) && beats > 0 ? beats : 4
}

/** How far a live tempo nudge (#140, TempoNudgeWidget/queue.ts's setLiveTempoAdjustPercent) can
 * push away from the song's own bpm, in percent either direction - generous enough to correct
 * real drift, tight enough that a fat-fingered tap can't turn a ballad into a polka. Lives here
 * rather than in queue.ts since it's a pure domain constant the widget also needs to read for
 * its disabled-at-the-limit buttons, and queue.ts transitively constructs a real PouchDB at
 * import time (workspaceDb.ts) that a plain component-test render can't afford to pull in. */
export const LIVE_TEMPO_ADJUST_LIMIT_PERCENT = 15

/** Applies a live +/- tempo correction (ShowState.liveTempoAdjustPercent, #140) on top of a
 * song's stored bpm - never mutates the stored value, just what the beat clock uses. */
export function adjustedBpm(bpm: number, adjustPercent: number): number {
  return bpm * (1 + adjustPercent / 100)
}

/** Resolves the current song/variant's authored `clickTrackEnabled` default against a live
 * ShowState.clickTrackOverride (#25) - `null` means "use the song's own setting", `'on'`/`'off'`
 * forces it regardless for tonight. */
export function effectiveClickEnabled(songDefault: boolean, override: 'on' | 'off' | null): boolean {
  if (override === null) return songDefault
  return override === 'on'
}

export interface Beat {
  /** 0-indexed position within the bar - 0 is always the downbeat. */
  beatInBar: number
  isDownbeat: boolean
  /** How far into the current beat, in ms - 0 right on the beat, approaching the beat length just
   * before the next one. Drives the pulse's decay rather than a hard on/off flash. */
  msIntoBeat: number
  /** True during the count-in before bar 1. */
  isCountIn: boolean
  /** The tempo of this beat's spacing - what is audible, shown instead of the song's authored bpm. */
  effectiveBpm: number
}

/**
 * The beat at a given elapsed-ms position into a song, locked to the same synced elapsed time
 * every other timeline consumer uses (usePlaybackElapsedMs.ts) - not a local setInterval, so it
 * stays sample-accurate across every tablet (docs/00 §4). `null` before the first click (the
 * count-in's first beat, or bar 1 without a count-in).
 */
export function beatAt(elapsedMs: number, timeline: ClickTimeline): Beat | null {
  const beat = timeline.beatAtOrBefore(elapsedMs)
  if (beat < timeline.firstBeat) return null
  const beatInBar = timeline.beatInBar(beat)
  return {
    beatInBar,
    isDownbeat: beatInBar === 0,
    msIntoBeat: elapsedMs - timeline.timeOfBeat(beat),
    isCountIn: beat < 0,
    effectiveBpm: 60000 / timeline.periodAfter(beat),
  }
}

/** Length of the bar playing at `atMs`, ms - #231's live bar-extend trigger pushes a scheduled end
 * forward by whole bars of what is actually audible there. */
export function barMsAt(atMs: number, timeline: ClickTimeline): number {
  const beat = Math.max(timeline.firstBeat, timeline.beatAtOrBefore(atMs))
  return beatsPerBar(timeline.timeSignatureAt(beat)) * timeline.periodAfter(beat)
}

/**
 * How far before elapsedMs 0 the master clock must start so the count-in fits (always <= 0) -
 * queue.ts/practiceQueue.ts seed the transport's accumulatedMs with this on a fresh Play, so
 * elapsedMs counts up through 0 exactly when the backing track's position 0 should start. 0
 * whenever the count-in fits inside the track's lead-in before bar 1.
 */
export function countInLeadMs(timeline: ClickTimeline): number {
  return Math.min(0, timeline.timeOfBeat(timeline.firstBeat))
}
