import { beatsPerBar, type BeatAnchorLike, type BeatGridSegment, type TempoMarkerLike, resolveBeatGrid } from './metronome'

/** How far ahead (ms) each tick schedules oscillators - the standard "look-ahead scheduler"
 * window (per Chris Wilson's "A Tale of Two Clocks", the reference technique for precise Web
 * Audio timing): long enough that a scheduled click is always queued well before it must sound
 * even if the main thread briefly stalls, short enough that a live tempo nudge or a pause takes
 * effect almost immediately rather than after a long queued backlog. */
const LOOKAHEAD_MS = 150
/** How often the scheduler tops up its queue - well under LOOKAHEAD_MS, so two consecutive
 * ticks' windows always overlap and no beat can fall in the gap between them. */
const TICK_INTERVAL_MS = 50
/** Click burst length - short enough to read as a "click", not a sustained tone. */
const CLICK_DURATION_S = 0.03

export interface ClickEngineState {
  /** Null while not playing (paused/stopped) - the engine goes silent and forgets its schedule
   * position, exactly like usePlaybackElapsedMs.ts returning null does for every other
   * elapsed-time consumer. */
  elapsedMs: number | null
  bpm: number
  timeSignature: string
  /** Beat sync points (#25 follow-up, SongVariant.beatAnchors) - each carries its own
   * `beatInBar`, so counting continues from there rather than resetting to "beat 1" at every
   * anchor. See metronome.ts's `resolveBeatGrid` for how these govern the beat grid. Empty
   * reproduces the original (pre-anchor) behavior exactly: beat 0 pinned to elapsedMs 0. */
  beatAnchors: readonly BeatAnchorLike[]
  /** Bars of count-in to play before the first beat anchor (#25 follow-up, resolved from
   * SongVariant.countInEnabled/countInBars) - 0 reproduces the original silent-count-in
   * behavior exactly. */
  countInBars: number
  /** Genuine mid-song tempo changes (#141, SongVariant.tempoMarkers) - see metronome.ts's
   * `resolveBeatGrid` for how these govern which segment's bpm/timeSignature is actually
   * active. Empty reproduces today's single-tempo behavior exactly. A live tempo nudge (#140)
   * only ever affects `bpm` above (segment 0) - a marker's own bpm is used as-is, not nudged. */
  tempoMarkers: readonly TempoMarkerLike[]
  /** How fast `elapsedMs` advances relative to wall time (#61's Speed Trainer: 0.8 = an 80 % pass).
   * Absent means 1. Beat spacing stays in song time; only the wall-clock conversion below uses it. */
  playbackRate?: number
  /** The song-time section a Rehearsal Loop (#61) repeats. Beats are never scheduled past its end -
   * the loop wraps there, so a beat queued beyond it would sound in the wrong place. */
  loop?: { startMs: number; endMs: number } | null
}

let audioContext: AudioContext | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
/** The elapsedMs position of the next not-yet-scheduled beat, and its position within the bar -
 * both owned and incrementally advanced by the scheduler itself, never recomputed from absolute
 * elapsedMs/bpm on every tick the way metronome.ts's beatAt/upcomingBeats deliberately do for a
 * one-shot snapshot query. Recomputing from scratch every tick would re-quantize the ENTIRE
 * elapsed-since-song-start timeline onto a live-nudged (#140) bpm's grid, which can retroactively
 * shift where "the next beat" falls by several beats' worth of time and silence the click for
 * seconds until real elapsed time catches back up to the new grid - see #25 review. Advancing
 * incrementally from the last actually-scheduled beat instead means a tempo change only changes
 * the spacing of beats from here forward. */
let nextBeatOnsetMs: number | null = null
let nextBeatInBar = 0
/** `elapsedMs` as of the last tick - used to detect a large gap between ticks (see
 * RESYNC_GAP_MS below), not to schedule anything itself. */
let lastTickElapsedMs: number | null = null
/** Which anchor origin `nextBeatOnsetMs` is currently anchored to (metronome.ts's
 * `resolveBeatGrid`) - `tick()` compares this against the freshly-resolved origin every tick
 * so crossing into a new beat anchor mid-song re-anchors the schedule exactly there, the same
 * way a stall or a fresh start already does, instead of continuing to extrapolate the old
 * anchor's grid indefinitely. */
let activeOriginMs: number | null = null
/** The `correctionRatio` (metronome.ts's `resolveBeatGrid`) the running schedule is currently
 * using to space beats - set whenever `activeOriginMs` is (re)established, and applied fresh to
 * whatever `bpm` is live on every tick's while-loop iteration below, so a live tempo nudge (#140)
 * still takes effect instantly within a segment; only the *ratio* is fixed per-segment, not an
 * absolute ms value. */
let activeCorrectionRatio = 1
/** The AudioContext time `nextBeatOnsetMs` is scheduled at. Converted from song time only when
 * the schedule (re)anchors; every following beat is placed exactly one beat length later in
 * audio time. Converting each beat on its own - `currentTime + (onset - elapsed)` sampled per
 * tick - scattered clicks by up to ±25 ms on the band's tablet, whose audio clock only advances
 * in ~20 ms steps (measured 2026-09-27: 438-513 ms between count-in clicks meant to be 480 ms
 * apart, heard as a stumbling click). Null = convert at the next beat. */
let nextBeatAudioTime: number | null = null
/** How far the incrementally advanced audio time may disagree with a fresh conversion before it
 * is re-derived - above the audio clock's step jitter, below anything audible as a "late" click.
 * Catches real discontinuities the stall/wrap checks don't, e.g. a clock-sync offset update. */
const AUDIO_TIME_TOLERANCE_S = 0.05
/** The last click actually scheduled: its song time and audio time. Crossing into the next beat
 * anchor (with a fitted grid, every beat) continues from here by the grid distance instead of
 * reading the audio clock again - each fresh reading carried the clock's remaining uncertainty,
 * measured on the Fire tablet as ±25 ms scatter in the first seconds of a song (2026-09-27). */
let lastScheduled: { onsetMs: number; audioTime: number } | null = null

/** Recent readings of `currentTime - wall clock`, s. The band's Fire tablet advances
 * `currentTime` in 64 ms steps (sometimes 128/192 ms - measured 2026-09-27, output latency
 * 260 ms), so a single reading can be up to ~130 ms behind the real audio clock: converting with
 * it tripped AUDIO_TIME_TOLERANCE_S every few beats, and each re-derivation was an audible jump.
 * Right after a step the reading is exact, so the upper edge of the recent readings tracks the
 * true clock; the window keeps the edge current if the clock pauses or drifts. */
const clockOffsets: number[] = []
const CLOCK_WINDOW = 40 // ticks, ~2 s
/** The previous reading and whether the clock moved within the window - a clock that isn't
 * running (a context not resumed yet) is read as-is, not extrapolated along the wall clock. */
let lastClockReading: number | null = null
let ticksSinceClockMoved = Infinity

/** The audio clock's current time, smoothed over its step size (see `clockOffsets`). */
function smoothedAudioNow(ctx: AudioContext): number {
  const now = ctx.currentTime
  ticksSinceClockMoved = lastClockReading !== null && now > lastClockReading ? 0 : ticksSinceClockMoved + 1
  lastClockReading = now
  if (ticksSinceClockMoved > CLOCK_WINDOW) {
    clockOffsets.length = 0
    return now
  }
  const wall = Date.now() / 1000
  clockOffsets.push(now - wall)
  if (clockOffsets.length > CLOCK_WINDOW) clockOffsets.shift()
  return Math.max(now, wall + Math.max(...clockOffsets))
}

/** How large a jump in `elapsedMs` between two consecutive ticks counts as "the browser stalled
 * this tab's timers," not just normal scheduling - comfortably above the ~TICK_INTERVAL_MS gap a
 * healthy tick sees, comfortably below the length of a real beat at any reasonable tempo (so a
 * single genuinely slow tick never gets mistaken for a stall). Backgrounding a tab throttles
 * `setInterval` far below TICK_INTERVAL_MS (found live, 2026-09-10: the click "fully out of
 * rhythm" after the tab lost focus) - without this, `tick()`'s while loop would fire every beat
 * that fell due during the whole stall in one instant burst once the tab is foregrounded again,
 * instead of just resuming cleanly from wherever elapsedMs actually is now. */
const RESYNC_GAP_MS = 500

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext()
  return audioContext
}

/** One click burst: a short, fast-decaying oscillator tone - higher-pitched and louder on the
 * downbeat, exactly the same accent Visual Metronome draws visually (metronome.ts's
 * Beat.isDownbeat), so the two are recognizably "the same beat" to anyone comparing them. */
function playClickAt(ctx: AudioContext, time: number, isDownbeat: boolean): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = isDownbeat ? 1500 : 1000
  // Fast attack, exponential decay to near-silence - a "click", not a beep. Starting the decay
  // ramp from a moment after `time` (not exactly at it) avoids the near-zero-to-target jump
  // exponentialRampToValueAtTime rejects as invalid at time 0.
  gain.gain.setValueAtTime(isDownbeat ? 0.5 : 0.35, time)
  gain.gain.exponentialRampToValueAtTime(0.001, time + CLICK_DURATION_S)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(time)
  osc.stop(time + CLICK_DURATION_S)
}

/** Anchors the running schedule to the next beat boundary at or after `elapsedMs`, using `grid`
 * (metronome.ts's `resolveBeatGrid` - `originMs` 0 and `correctionRatio` 1 with no beat anchors
 * configured, exactly reproducing the original song-start-relative grid). `elapsedMs >=
 * grid.originMs` always holds here - `tick()` only ever calls this once it has already confirmed
 * `resolveBeatGrid` returned non-null, which only happens for an anchor at or before `elapsedMs`.
 * Called when playback (re)starts (nextBeatOnsetMs is null), on a detected stall, or when the
 * active anchor has just changed - never otherwise, so a live tempo nudge alone never
 * resets/re-anchors the already-running cursor (`correctionRatio` stays fixed for the segment;
 * `grid.bpm` itself is re-read live every tick instead, in `tick()`'s while-loop below - for
 * segment 0 that's the live-nudged (#140) value, since `resolveBeatGrid` uses whatever `bpm` it
 * was called with for segment 0 verbatim; a tempo-marker (#141) segment's own bpm is fixed and
 * not nudge-able). */
function anchorSchedule(elapsedMs: number, grid: BeatGridSegment, includeBeatAtPosition = false): void {
  const msPerBeat = (60000 / grid.bpm) * grid.correctionRatio
  const effectiveMs = elapsedMs - grid.originMs
  // Normally the next beat strictly AFTER `elapsedMs`; a loop restart (#61) wants a beat sitting
  // exactly on the loop start included, since that is where the new pass begins.
  const beatIndex = includeBeatAtPosition ? Math.ceil(effectiveMs / msPerBeat) : Math.floor(effectiveMs / msPerBeat) + 1
  nextBeatOnsetMs = grid.originMs + beatIndex * msPerBeat
  nextBeatInBar = (grid.originBeatInBar + beatIndex) % beatsPerBar(grid.timeSignature)
  nextBeatAudioTime = null
  activeCorrectionRatio = grid.correctionRatio
}

/** One scheduler tick: tops up the oscillator queue with every beat that has newly entered the
 * lookahead window since the last tick, then advances the cursor by the *current* bpm's beat
 * length - so a live tempo nudge (#140) changes spacing only from here forward, and a beat
 * already committed to the queue is never retroactively skipped or duplicated (the two windows
 * deliberately overlap - see TICK_INTERVAL_MS/LOOKAHEAD_MS above). Silent, and resets the
 * cursor, whenever nothing is currently playing, or while still before the first beat anchor
 * (metronome.ts's `resolveBeatOrigin` returning null - a count-in state). Re-anchors (instead of
 * bursting through a backlog) whenever `elapsedMs` jumped by more than RESYNC_GAP_MS since the
 * last tick (a throttled/backgrounded tab, not a normal gap between beats), or whenever the
 * active beat anchor has changed - crossing into a new anchor's territory mid-song resets phase
 * there exactly the same way a stall or a fresh start already does. This is also what makes a
 * tempo-marker (#141) boundary work with no separate handling here at all: `resolveBeatGrid`
 * always ensures a (real or synthetic) anchor sits exactly at every marker's `timeMs`, so
 * crossing into a new tempo segment IS crossing into a new anchor, as far as this function
 * can tell. */
function tick(getState: () => ClickEngineState): void {
  const { elapsedMs, bpm, timeSignature, beatAnchors, countInBars, tempoMarkers, playbackRate = 1, loop = null } = getState()
  if (elapsedMs === null) {
    nextBeatOnsetMs = null
    nextBeatAudioTime = null
    lastScheduled = null
    lastTickElapsedMs = null
    activeOriginMs = null
    activeCorrectionRatio = 1
    return
  }
  const grid = resolveBeatGrid(beatAnchors, elapsedMs, bpm, timeSignature, countInBars, tempoMarkers)
  if (grid === null) {
    // Still before the first anchor - a count-in, nothing should sound yet.
    lastTickElapsedMs = elapsedMs
    return
  }

  const stalled = lastTickElapsedMs !== null && elapsedMs - lastTickElapsedMs > RESYNC_GAP_MS
  // A backwards jump is a loop wrapping (or a seek): the cursor is still out near the old position,
  // so re-anchor - at the loop start, inclusive, so a beat sitting exactly there still sounds.
  const wrapped = lastTickElapsedMs !== null && elapsedMs < lastTickElapsedMs
  if (nextBeatOnsetMs === null || stalled || wrapped || grid.originMs !== activeOriginMs) {
    // Only a start, a stall or a jump needs a fresh reading of the audio clock; crossing into the
    // next anchor keeps the audio-time chain going.
    const continuous = nextBeatOnsetMs !== null && !stalled && !wrapped
    if (!continuous) lastScheduled = null
    if (wrapped && loop) anchorSchedule(Math.max(grid.originMs, loop.startMs), grid, true)
    else anchorSchedule(elapsedMs, grid)
    if (continuous && lastScheduled && nextBeatOnsetMs !== null) {
      nextBeatAudioTime = lastScheduled.audioTime + (nextBeatOnsetMs - lastScheduled.onsetMs) / 1000 / playbackRate
    }
    activeOriginMs = grid.originMs
  }
  lastTickElapsedMs = elapsedMs

  const ctx = getAudioContext()
  const audioNow = smoothedAudioNow(ctx)
  const beatCount = beatsPerBar(grid.timeSignature)
  // The lookahead window is wall time, `elapsedMs` is song time - a slowed pass covers less song per ms.
  const lookaheadSongMs = LOOKAHEAD_MS * playbackRate
  while (nextBeatOnsetMs !== null && nextBeatOnsetMs < elapsedMs + lookaheadSongMs) {
    if (loop && nextBeatOnsetMs >= loop.endMs) break
    const converted = audioNow + (nextBeatOnsetMs - elapsedMs) / 1000 / playbackRate
    if (nextBeatAudioTime === null || Math.abs(converted - nextBeatAudioTime) > AUDIO_TIME_TOLERANCE_S) {
      nextBeatAudioTime = converted
    }
    playClickAt(ctx, nextBeatAudioTime, nextBeatInBar === 0)
    lastScheduled = { onsetMs: nextBeatOnsetMs, audioTime: nextBeatAudioTime }
    const beatMs = (60000 / grid.bpm) * activeCorrectionRatio
    nextBeatOnsetMs += beatMs
    nextBeatAudioTime += beatMs / 1000 / playbackRate
    nextBeatInBar = (nextBeatInBar + 1) % beatCount
  }
}

/**
 * Starts the look-ahead click scheduler if it isn't already running - safe to call repeatedly
 * (e.g. on every render of whichever widget owns it) since a second call while already running
 * is a no-op. `getState` is polled every tick rather than passed as static values, so a live
 * tempo nudge (#140) or a pause takes effect on the very next tick without needing to
 * restart/re-anchor anything.
 */
export function startClick(getState: () => ClickEngineState): void {
  if (intervalId !== null) return
  // AudioContext can start `suspended` until a user gesture resumes it (autoplay policy) -
  // resume() is a safe no-op if it's already running.
  void getAudioContext().resume()
  intervalId = setInterval(() => tick(getState), TICK_INTERVAL_MS)
}

/** Stops scheduling new clicks. Already-scheduled oscillators (up to LOOKAHEAD_MS out) still
 * fire - an audio scheduler always has a small stop tail, the same way a real drum machine's
 * last triggered hit finishes playing after you hit stop. */
export function stopClick(): void {
  if (intervalId !== null) clearInterval(intervalId)
  intervalId = null
  nextBeatOnsetMs = null
  nextBeatAudioTime = null
  lastScheduled = null
  clockOffsets.length = 0
  lastClockReading = null
  ticksSinceClockMoved = Infinity
  lastTickElapsedMs = null
  activeOriginMs = null
  activeCorrectionRatio = 1
}

/** Test-only escape hatch - vitest's jsdom environment has no real AudioContext, and the module
 * otherwise has no way to reset its module-level scheduler state between tests. */
export function __resetClickEngineForTests(): void {
  stopClick()
  audioContext = null
}
