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
  /** True while elapsedMs is still before the variant's real first beat anchor - i.e. this beat
   * is part of a configured count-in (#25 follow-up), not the song's actual first bar. Always
   * false with no anchors, or once elapsedMs reaches the first anchor. */
  isCountIn: boolean
}

export interface BeatAnchorLike {
  timeMs: number
}

/** Anchors closer together than this collapse into just the earlier one - guards the beat grid
 * against a near-duplicate anchor turning into an audible burst of near-instantaneous "beats"
 * (found live, 2026-09-10: a key-repeat bug let holding Space while tapping insert anchors as
 * little as 28ms apart; `resolveBeatGrid` below then correctly, but disastrously, tried to
 * divide that near-zero gap into beats). Comfortably below any real sub-beat spacing at even a
 * very fast tempo (600 BPM is 100ms/beat), comfortably above human tap jitter - and matters
 * beyond just this one bug, since a future automatic beat-detection pass (#25 follow-up,
 * `detectBeatAnchors`) is expected to occasionally produce noisy anchors too. */
const MIN_ANCHOR_GAP_MS = 150

/** Collapses any run of anchors closer together than `MIN_ANCHOR_GAP_MS` down to just the
 * earliest of each run - the input order doesn't matter, the *result* is always sorted by time. */
function dedupeAnchors(anchors: readonly BeatAnchorLike[]): BeatAnchorLike[] {
  const sorted = [...anchors].sort((a, b) => a.timeMs - b.timeMs)
  const result: BeatAnchorLike[] = []
  for (const anchor of sorted) {
    const prev = result[result.length - 1]
    if (prev === undefined || anchor.timeMs - prev.timeMs >= MIN_ANCHOR_GAP_MS) result.push(anchor)
  }
  return result
}

/** The earliest anchor's timestamp, after collapsing near-duplicates - null with no anchors at
 * all. Used to tell whether a given elapsedMs falls in a count-in window before the song's real
 * first downbeat, vs the song itself (see `beatAt`'s `isCountIn`). */
function firstAnchorMs(anchors: readonly BeatAnchorLike[]): number | null {
  const deduped = dedupeAnchors(anchors)
  return deduped.length > 0 ? deduped[0]!.timeMs : null
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
  const deduped = dedupeAnchors(anchors)
  if (deduped.length === 0) return 0
  let best: number | null = null
  for (const anchor of deduped) {
    if (anchor.timeMs <= elapsedMs && (best === null || anchor.timeMs > best)) best = anchor.timeMs
  }
  return best
}

export interface BeatGridSegment {
  originMs: number
  /** Multiplier applied to whatever `60000 / bpm` is live right now, so this segment's beats
   * divide its real (anchor-to-anchor) duration evenly instead of accumulating a small error
   * over the segment that gets released as an audible jump right at the next anchor (found
   * live, 2026-09-10: heard as jitter, sometimes an outright duplicated click, right at a
   * crossing). Always 1 with no next anchor to lock onto yet (the open-ended final segment) -
   * nothing to divide evenly against. Deliberately reads as a *ratio*, not an absolute
   * millisecond value: a live tempo nudge (#140) still applies to `bpm` and takes effect
   * immediately, every tick - this just rides on top of whatever that produces, rather than
   * being a fixed value that would only update at the next anchor crossing. */
  correctionRatio: number
}

/** The stretch/compression ratio that makes the nearest whole number of nominal-bpm beats
 * divide the real `fromMs`-to-`toMs` gap exactly - the shared formula behind every
 * `resolveBeatGrid` case below (forward, tail, and count-in). */
function segmentRatio(fromMs: number, toMs: number, bpm: number): number {
  const nominalMsPerBeat = 60000 / bpm
  const gapMs = toMs - fromMs
  const beatsBetween = Math.max(1, Math.round(gapMs / nominalMsPerBeat))
  return gapMs / beatsBetween / nominalMsPerBeat
}

/**
 * The active anchor origin (`resolveBeatOrigin`) plus the locally-corrected spacing to use from
 * it forward. The song's own `bpm` is a rounded nominal value that will essentially never divide
 * the real gap between two anchors into a whole number of exact-length beats - `segmentRatio`
 * infers that whole number by rounding via the nominal bpm, then returns whatever small
 * stretch/compression makes that many beats fit the real gap exactly. This is *not* a tempo map
 * (#141): nothing new is authored or stored, it's a pure scheduling-time refinement of the same
 * bpm + beatAnchors data already entered, and it only ever nudges spacing by a hair - the
 * rounding error a fixed-point bpm number would otherwise have anyway.
 *
 * Three cases:
 * - **Before the first anchor**: `null` (a true count-in/silence state) unless `countInBars` is
 *   configured, in which case a virtual origin is placed exactly `countInBars` bars before the
 *   first anchor, at the *first segment's own* corrected tempo (anchor 1 -> anchor 2, or nominal
 *   bpm if there's no anchor 2 yet) - phase-continuous into the real first downbeat, since that
 *   offset is by construction a whole number of bars at the same ratio.
 * - **Between two anchors**: unchanged from before - corrected to fit the real gap evenly.
 * - **After the last anchor**: reuses the *previous* segment's corrected ratio (the gap between
 *   the last anchor and the one before it) instead of reverting to the plain nominal bpm, so a
 *   song's outro doesn't silently lose the correction the rest of the song had. Falls back to
 *   `1` only when there's no previous segment either (a single anchor total).
 */
export function resolveBeatGrid(
  anchors: readonly BeatAnchorLike[],
  elapsedMs: number,
  bpm: number,
  timeSignature: string = '4/4',
  countInBars: number = 0,
): BeatGridSegment | null {
  const deduped = dedupeAnchors(anchors)
  const originMs = resolveBeatOrigin(deduped, elapsedMs)
  if (originMs === null) {
    if (countInBars <= 0) return null
    const firstMs = deduped[0]!.timeMs // non-null: resolveBeatOrigin only returns null when at
    // least one anchor exists
    const ratio = deduped.length >= 2 ? segmentRatio(firstMs, deduped[1]!.timeMs, bpm) : 1
    const msPerBeat = (60000 / bpm) * ratio
    const countInOriginMs = firstMs - countInBars * beatsPerBar(timeSignature) * msPerBeat
    if (elapsedMs < countInOriginMs) return null // still earlier than the count-in window
    return { originMs: countInOriginMs, correctionRatio: ratio }
  }
  const idx = deduped.findIndex((anchor) => anchor.timeMs === originMs)
  const nextAnchorMs = deduped[idx + 1]?.timeMs
  if (nextAnchorMs !== undefined) return { originMs, correctionRatio: segmentRatio(originMs, nextAnchorMs, bpm) }
  const prevAnchorMs = deduped[idx - 1]?.timeMs
  if (prevAnchorMs === undefined) return { originMs, correctionRatio: 1 } // only one anchor total
  return { originMs, correctionRatio: segmentRatio(prevAnchorMs, originMs, bpm) }
}

/**
 * The beat at a given elapsed-ms position into a song, locked to the same synced elapsed time
 * every other timeline consumer uses (usePlaybackElapsedMs.ts) - not a local setInterval, so
 * it stays sample-accurate to the beat across every tablet in the workspace the same way the
 * Prompter's scroll position does (docs/00 §4). `null` means still before the first beat anchor
 * (see `resolveBeatOrigin`) - a count-in state, not a beat position.
 */
export function beatAt(
  elapsedMs: number,
  bpm: number,
  timeSignature: string,
  anchors: readonly BeatAnchorLike[] = [],
  countInBars: number = 0,
): Beat | null {
  const grid = resolveBeatGrid(anchors, elapsedMs, bpm, timeSignature, countInBars)
  if (grid === null) return null
  const msPerBeat = (60000 / bpm) * grid.correctionRatio
  const effectiveMs = elapsedMs - grid.originMs
  const beatIndex = Math.floor(effectiveMs / msPerBeat)
  const beatInBar = beatIndex % beatsPerBar(timeSignature)
  const first = firstAnchorMs(anchors)
  return {
    beatInBar,
    isDownbeat: beatInBar === 0,
    msIntoBeat: effectiveMs - beatIndex * msPerBeat,
    isCountIn: first !== null && elapsedMs < first,
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
  countInBars: number = 0,
): ScheduledBeat[] {
  const grid = resolveBeatGrid(anchors, elapsedMs, bpm, timeSignature, countInBars)
  if (grid === null) return [] // still before the first anchor - nothing to schedule yet
  const msPerBeat = (60000 / bpm) * grid.correctionRatio
  const beats = beatsPerBar(timeSignature)
  const effectiveMs = elapsedMs - grid.originMs
  // Beat index is relative to the active anchor, not song-start - clamped at 0 (the anchor
  // itself is always the earliest valid beat, never a negative index before it).
  const firstIndex = effectiveMs < 0 ? 0 : Math.floor(effectiveMs / msPerBeat) + 1
  const lastIndex = Math.floor((effectiveMs + lookaheadMs) / msPerBeat)
  const result: ScheduledBeat[] = []
  for (let beatIndex = firstIndex; beatIndex <= lastIndex; beatIndex++) {
    result.push({
      beatIndex,
      isDownbeat: beatIndex % beats === 0,
      msFromNow: grid.originMs + beatIndex * msPerBeat - elapsedMs,
    })
  }
  return result
}
