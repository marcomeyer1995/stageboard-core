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
  /** How far into the current beat, in ms - 0 right on the beat, approaching msPerBeat just
   * before the next one. Drives the pulse's decay rather than a hard on/off flash. */
  msIntoBeat: number
}

export interface BeatAnchorLike {
  timeMs: number
}

/**
 * Which anchor governs the beat grid right now: the latest one at or before `elapsedMs` (#25
 * follow-up - BeatAnchorSchema's own doc comment explains why an anchor only ever resets
 * *phase*, never spacing). Shared by `beatAt`/`upcomingBeats` below and clickEngine.ts's own
 * scheduler, so both ever agree on which anchor is active right now.
 *
 * `null` (with `anchors` non-empty) means `elapsedMs` is still before the very first anchor -
 * a genuine "count-in, nothing has sounded yet" state, not shoehornable into beat index 0.
 * `0` with an empty `anchors` array reproduces today's pre-#25-follow-up behavior exactly (beat
 * 0 pinned to elapsedMs === 0, as if a single anchor sat at song-start) - every song that has
 * never had an anchor added behaves byte-identically to before this existed.
 */
export function resolveBeatOrigin(anchors: readonly BeatAnchorLike[], elapsedMs: number): number | null {
  if (anchors.length === 0) return 0
  let best: number | null = null
  for (const anchor of anchors) {
    if (anchor.timeMs <= elapsedMs && (best === null || anchor.timeMs > best)) best = anchor.timeMs
  }
  return best
}

/**
 * The beat at a given elapsed-ms position into a song, locked to the same synced elapsed time
 * every other timeline consumer uses (usePlaybackElapsedMs.ts) - not a local setInterval, so
 * it stays sample-accurate to the beat across every tablet in the workspace the same way the
 * Prompter's scroll position does (docs/00 §4). `null` means still before the first beat anchor
 * (see `resolveBeatOrigin`) - a count-in state, not a beat position.
 */
export function beatAt(elapsedMs: number, bpm: number, timeSignature: string, anchors: readonly BeatAnchorLike[] = []): Beat | null {
  const originMs = resolveBeatOrigin(anchors, elapsedMs)
  if (originMs === null) return null
  const msPerBeat = 60000 / bpm
  const effectiveMs = elapsedMs - originMs
  const beatIndex = Math.floor(effectiveMs / msPerBeat)
  const beatInBar = beatIndex % beatsPerBar(timeSignature)
  return {
    beatInBar,
    isDownbeat: beatInBar === 0,
    msIntoBeat: effectiveMs - beatIndex * msPerBeat,
  }
}

export interface ScheduledBeat {
  /** Absolute index since song-elapsed 0, not beat-in-bar - the Click Generator's look-ahead
   * loop uses this (not the value itself) to dedupe against beats an earlier tick already
   * scheduled, since two overlapping lookahead windows will otherwise both list it. */
  beatIndex: number
  isDownbeat: boolean
  /** ms from `elapsedMs` (the "now" passed in) this beat should sound - never negative, and
   * never 0 for the beat sounding at this exact instant (that one already happened; "upcoming"
   * means strictly after `elapsedMs`). The caller adds this to its own present-moment
   * AudioContext.currentTime, not to elapsedMs itself - see clickEngine.ts. */
  msFromNow: number
}

/**
 * Every beat that falls strictly after `elapsedMs` and within the next `lookaheadMs` - the
 * selection logic for a standard look-ahead Web Audio scheduler (clickEngine.ts), kept pure and
 * separate from any AudioContext/timer so it's unit-testable with plain arithmetic. Deliberately
 * takes "now" (elapsedMs) and a duration rather than an absolute song-start timestamp: `elapsedMs`
 * already accounts for pause/resume (usePlaybackElapsedMs.ts), so beats "in the future" are only
 * ever predicted a short, safe distance ahead - a pause landing inside that window simply means
 * the engine stops calling this again until playback resumes, not that a stale absolute
 * prediction plays late.
 */
export function upcomingBeats(
  elapsedMs: number,
  lookaheadMs: number,
  bpm: number,
  timeSignature: string,
  anchors: readonly BeatAnchorLike[] = [],
): ScheduledBeat[] {
  const originMs = resolveBeatOrigin(anchors, elapsedMs)
  if (originMs === null) return [] // still before the first anchor - nothing to schedule yet
  const msPerBeat = 60000 / bpm
  const beats = beatsPerBar(timeSignature)
  const effectiveMs = elapsedMs - originMs
  // Beat index is relative to the active anchor, not song-start - clamped at 0 (the anchor
  // itself is always the earliest valid beat, never a negative index before it).
  const firstIndex = effectiveMs < 0 ? 0 : Math.floor(effectiveMs / msPerBeat) + 1
  const lastIndex = Math.floor((effectiveMs + lookaheadMs) / msPerBeat)
  const result: ScheduledBeat[] = []
  for (let beatIndex = firstIndex; beatIndex <= lastIndex; beatIndex++) {
    result.push({
      beatIndex,
      isDownbeat: beatIndex % beats === 0,
      msFromNow: originMs + beatIndex * msPerBeat - elapsedMs,
    })
  }
  return result
}
