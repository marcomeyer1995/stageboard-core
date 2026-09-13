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
  /** The tempo actually governing this beat's spacing right now - the `bpm` passed in (already
   * live-nudged, #140) times whichever segment's `correctionRatio` is active (#25 follow-up).
   * Equal to the plain `bpm` whenever there's no anchor correction in effect (no anchors, or an
   * anchor-to-anchor/tail gap that already divides evenly). VisualMetronomeWidget shows this
   * instead of the song's authored bpm, so what's displayed always matches what's audible. */
  effectiveBpm: number
}

export interface BeatAnchorLike {
  timeMs: number
  /** 0-indexed position within the bar (0 = downbeat) - see `BeatAnchorSchema`'s doc comment.
   * Absent on anchors created before this field existed; every read site below defaults it to
   * 0, reproducing the original "every anchor is beat 1" behavior exactly. */
  beatInBar?: number
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

export interface TempoMarkerLike {
  timeMs: number
  bpm: number
  timeSignature?: string
}

interface TempoSegment {
  startMs: number
  bpm: number
  timeSignature: string
}

/** The full, resolved list of tempo segments for a variant - segment 0 always starts at
 * `startMs: 0` using the variant's own `bpm`/`timeSignature` (#141's "implicit at timeMs: 0"),
 * followed by one entry per `TempoMarker`, sorted by `timeMs`. A marker's own `timeSignature`,
 * when absent, inherits from whichever segment precedes it (most tempo changes don't also
 * change the meter) - not just the variant's base one, so a chain of several markers still
 * resolves correctly. Empty `tempoMarkers` (today's overwhelming majority of songs) produces
 * exactly the one segment-0 entry - every existing call site is byte-identical to before. */
function resolveTempoSegments(tempoMarkers: readonly TempoMarkerLike[], bpm: number, timeSignature: string): TempoSegment[] {
  const sorted = [...tempoMarkers].sort((a, b) => a.timeMs - b.timeMs)
  const segments: TempoSegment[] = [{ startMs: 0, bpm, timeSignature }]
  for (const marker of sorted) {
    const prev = segments[segments.length - 1]!
    segments.push({ startMs: marker.timeMs, bpm: marker.bpm, timeSignature: marker.timeSignature ?? prev.timeSignature })
  }
  return segments
}

/** The segment governing a given point in time - the latest one starting at or before it.
 * `segments` must already be sorted ascending by `startMs` (guaranteed by
 * `resolveTempoSegments`'s own construction). Always returns something: `segments[0]` (segment
 * 0) covers everything before the first real marker, by construction. */
function resolveTempoSegment(segments: readonly TempoSegment[], atMs: number): TempoSegment {
  let best = segments[0]!
  for (const segment of segments) {
    if (segment.startMs <= atMs) best = segment
    else break
  }
  return best
}

/** Ensures no anchor-to-anchor correction segment (`resolveBeatGrid` below) ever straddles two
 * different tempo segments - without this, `segmentRatio`'s "how many nominal beats fit this
 * real gap" would be computed against the WRONG nominal tempo for part of the gap, breaking
 * down badly once the two segments' tempos differ by much (found live, 2026-09-12: a real
 * 150->100 BPM change, a 2/3 ratio, made a real 600ms beat gap get rounded to "2 beats" against
 * a 400ms nominal, inserting a phantom extra click - confirmed mathematically, not just
 * observed). Injects a synthetic anchor at every segment boundary (segment 0's own `startMs: 0`
 * included) that doesn't already have a real one within `MIN_ANCHOR_GAP_MS` of it, defaulting
 * `beatInBar` to 0 (a tempo change coinciding with a downbeat is by far the common case; a real
 * anchor added nearby always takes precedence via the normal dedupe/correction rules if that
 * assumption is wrong for a given song).
 *
 * Deliberately never called to decide *whether* `elapsedMs` is in a count-in state at all
 * (`resolveBeatGrid` resolves that first, against the caller's own unmodified `anchors`) - only
 * once elapsedMs is already known to be past the true origin. Otherwise, injecting a segment-0
 * synthetic anchor here would corrupt `resolveBeatOrigin`'s existing "no anchors at all -> beat
 * 0 pinned to elapsedMs 0, never a count-in" special case for a song that has no real anchors
 * yet but does have a tempo marker (found live, 2026-09-12: without this split, such a song
 * played nothing at all until the marker's own timeMs was reached). */
function anchorsWithTempoBoundaries(anchors: readonly BeatAnchorLike[], segments: readonly TempoSegment[]): BeatAnchorLike[] {
  if (segments.length <= 1) return anchors as BeatAnchorLike[]
  const merged = [...anchors]
  for (const segment of segments) {
    const hasNearbyAnchor = anchors.some((a) => Math.abs(a.timeMs - segment.startMs) < MIN_ANCHOR_GAP_MS)
    if (!hasNearbyAnchor) merged.push({ timeMs: segment.startMs, beatInBar: 0 })
  }
  return merged
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
  /** The active anchor's own `beatInBar` (0 when absent/no anchors) - beat-in-bar counting
   * continues from here rather than resetting to 0 at `originMs`, so a dense anchor list (one
   * per beat) still cycles 1-2-3-4 through the bar instead of announcing "beat 1" every tick. */
  originBeatInBar: number
  /** The nominal bpm/timeSignature governing this segment (#141) - the variant's own top-level
   * values with no tempo markers, or whichever `TempoMarker` is active at `originMs`. Callers
   * (`beatAt`/`upcomingBeats`/clickEngine.ts) use these instead of whatever flat `bpm`/
   * `timeSignature` they were originally called with, so playback actually follows a tempo
   * change instead of only ever using the song's very first tempo everywhere. */
  bpm: number
  timeSignature: string
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
 * The BeatGridSegment a count-in produces - origin exactly `countInBars` bars before the first
 * anchor, at that first segment's own corrected tempo (anchor 1 -> anchor 2, or nominal bpm if
 * there's no anchor 2 yet). Deliberately NOT clamped to elapsedMs >= 0: a count-in longer than
 * the real lead-in silence before the first anchor places this at a genuinely negative time on
 * purpose - the master playback clock itself starts there (queue.ts/practiceQueue.ts's
 * `countInLeadMs` below), counting up through 0 exactly when the backing track's own audio
 * should start (Marco, 2026-09-10: clamping this to fit inside [0, firstAnchorMs) instead, tried
 * first, was the wrong shape - a 2-bar/~4.2s count-in against a mere 346ms of real lead-in has
 * nowhere to clamp *to*). `null` with no anchors at all, or `countInBars <= 0`. */
function resolveCountInGrid(
  deduped: readonly BeatAnchorLike[],
  bpm: number,
  timeSignature: string,
  countInBars: number,
): BeatGridSegment | null {
  if (deduped.length === 0 || countInBars <= 0) return null
  const firstMs = deduped[0]!.timeMs
  const ratio = deduped.length >= 2 ? segmentRatio(firstMs, deduped[1]!.timeMs, bpm) : 1
  const msPerBeat = (60000 / bpm) * ratio
  const originMs = firstMs - countInBars * beatsPerBar(timeSignature) * msPerBeat
  // Whole bars of count-in don't change phase - the count-in starts on the same beat-in-bar the
  // first real anchor itself is.
  return { originMs, originBeatInBar: deduped[0]!.beatInBar ?? 0, bpm, timeSignature, correctionRatio: ratio }
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
 *   configured and elapsedMs has reached `resolveCountInGrid`'s (possibly negative) origin -
 *   phase-continuous into the real first downbeat, since that offset is by construction a whole
 *   number of beats at the same ratio.
 * - **Between two anchors**: unchanged from before - corrected to fit the real gap evenly.
 * - **After the last anchor**: reuses the *previous* segment's corrected ratio (the gap between
 *   the last anchor and the one before it) instead of reverting to the plain nominal bpm, so a
 *   song's outro doesn't silently lose the correction the rest of the song had. Falls back to
 *   `1` only when there's no previous segment either (a single anchor total).
 *
 * `tempoMarkers` (#141) add a fourth wrinkle on top of the three cases above, resolved in two
 * steps: first, whether `elapsedMs` is in a count-in state at all is decided against the
 * caller's own unmodified `anchors` - entirely independent of tempo markers, so a song with
 * markers but no real anchors yet still behaves like "no anchors" today does (beat 0 pinned to
 * elapsedMs 0, never a count-in), not like it's silently waiting for the first marker. Only once
 * that's settled does a synthetic anchor get injected at every tempo-segment boundary that
 * doesn't already have a real one nearby (`anchorsWithTempoBoundaries`), so no anchor-to-anchor
 * correction segment ever straddles two different nominal tempos - each resolved segment then
 * reports its OWN active `bpm`/`timeSignature` (whichever `TempoMarker` governs `originMs`, or
 * the variant's own values with none) instead of always the flat `bpm`/`timeSignature` this
 * function was called with. Empty `tempoMarkers` (the overwhelming majority of songs) makes all
 * of this entirely a no-op - byte-identical to before #141 existed.
 */
export function resolveBeatGrid(
  anchors: readonly BeatAnchorLike[],
  elapsedMs: number,
  bpm: number,
  timeSignature: string = '4/4',
  countInBars: number = 0,
  tempoMarkers: readonly TempoMarkerLike[] = [],
): BeatGridSegment | null {
  const segments = resolveTempoSegments(tempoMarkers, bpm, timeSignature)

  // Whether elapsedMs is in a genuine count-in state is decided against the caller's own
  // unmodified anchors, entirely independent of tempo markers - see anchorsWithTempoBoundaries's
  // own doc comment for why merging synthetic boundary anchors in before this check would
  // corrupt it for a song with tempo markers but no real anchors yet.
  const originalDeduped = dedupeAnchors(anchors)
  if (resolveBeatOrigin(originalDeduped, elapsedMs) === null) {
    // A count-in always precedes the song's very start, so it's always governed by segment 0
    // regardless of what later tempo markers say.
    const countIn = resolveCountInGrid(originalDeduped, segments[0]!.bpm, segments[0]!.timeSignature, countInBars)
    if (countIn === null || elapsedMs < countIn.originMs) return null
    return countIn
  }

  const deduped = dedupeAnchors(anchorsWithTempoBoundaries(anchors, segments))
  // Never actually null here - the check above already established elapsedMs is at/after a real
  // origin, and anchorsWithTempoBoundaries always includes a segment-0 entry - `?? 0` is a purely
  // defensive fallback, not an expected path.
  const originMs = resolveBeatOrigin(deduped, elapsedMs) ?? 0
  const { bpm: activeBpm, timeSignature: activeTimeSignature } = resolveTempoSegment(segments, originMs)
  const idx = deduped.findIndex((anchor) => anchor.timeMs === originMs)
  // idx is -1 with no anchors at all (originMs is the synthetic 0 from resolveBeatOrigin, not a
  // real anchor to look up) - optional chaining, not a non-null assertion, since deduped[-1]
  // (JS's plain out-of-bounds indexing, not deduped.at(-1)) is undefined, not deduped's last
  // element.
  const originBeatInBar = deduped[idx]?.beatInBar ?? 0
  const nextAnchorMs = deduped[idx + 1]?.timeMs
  if (nextAnchorMs !== undefined) {
    return {
      originMs,
      originBeatInBar,
      bpm: activeBpm,
      timeSignature: activeTimeSignature,
      correctionRatio: segmentRatio(originMs, nextAnchorMs, activeBpm),
    }
  }
  const prevAnchorMs = deduped[idx - 1]?.timeMs
  if (prevAnchorMs === undefined) {
    return { originMs, originBeatInBar, bpm: activeBpm, timeSignature: activeTimeSignature, correctionRatio: 1 } // only one anchor total
  }
  return {
    originMs,
    originBeatInBar,
    bpm: activeBpm,
    timeSignature: activeTimeSignature,
    correctionRatio: segmentRatio(prevAnchorMs, originMs, activeBpm),
  }
}

/**
 * How far before elapsedMs 0 a configured count-in needs the master clock to start (always
 * <= 0) - queue.ts/practiceQueue.ts seed the playback transport's accumulatedMs with this on a
 * fresh Play, so elapsedMs itself counts up from a genuine negative time through 0 exactly when
 * the backing track's real position 0 should start. `0` (today's exact pre-count-in behavior,
 * unchanged) whenever the count-in already fits inside [0, firstAnchorMs) - this only genuinely
 * extends the clock earlier when it doesn't.
 */
export function countInLeadMs(anchors: readonly BeatAnchorLike[], bpm: number, timeSignature: string, countInBars: number): number {
  const countIn = resolveCountInGrid(dedupeAnchors(anchors), bpm, timeSignature, countInBars)
  return countIn === null ? 0 : Math.min(0, countIn.originMs)
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
  tempoMarkers: readonly TempoMarkerLike[] = [],
): Beat | null {
  const grid = resolveBeatGrid(anchors, elapsedMs, bpm, timeSignature, countInBars, tempoMarkers)
  if (grid === null) return null
  const msPerBeat = (60000 / grid.bpm) * grid.correctionRatio
  const effectiveMs = elapsedMs - grid.originMs
  const beatIndex = Math.floor(effectiveMs / msPerBeat)
  const beatInBar = (grid.originBeatInBar + beatIndex) % beatsPerBar(grid.timeSignature)
  const first = firstAnchorMs(anchors)
  return {
    beatInBar,
    isDownbeat: beatInBar === 0,
    msIntoBeat: effectiveMs - beatIndex * msPerBeat,
    isCountIn: first !== null && elapsedMs < first,
    effectiveBpm: grid.bpm * grid.correctionRatio,
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
  tempoMarkers: readonly TempoMarkerLike[] = [],
): ScheduledBeat[] {
  const grid = resolveBeatGrid(anchors, elapsedMs, bpm, timeSignature, countInBars, tempoMarkers)
  if (grid === null) return [] // still before the first anchor - nothing to schedule yet
  const msPerBeat = (60000 / grid.bpm) * grid.correctionRatio
  const beats = beatsPerBar(grid.timeSignature)
  const effectiveMs = elapsedMs - grid.originMs
  // Beat index is relative to the active anchor, not song-start - clamped at 0 (the anchor
  // itself is always the earliest valid beat, never a negative index before it).
  const firstIndex = effectiveMs < 0 ? 0 : Math.floor(effectiveMs / msPerBeat) + 1
  const lastIndex = Math.floor((effectiveMs + lookaheadMs) / msPerBeat)
  const result: ScheduledBeat[] = []
  for (let beatIndex = firstIndex; beatIndex <= lastIndex; beatIndex++) {
    result.push({
      beatIndex,
      isDownbeat: (grid.originBeatInBar + beatIndex) % beats === 0,
      msFromNow: grid.originMs + beatIndex * msPerBeat - elapsedMs,
    })
  }
  return result
}
