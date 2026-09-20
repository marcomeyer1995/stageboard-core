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
    if (wrapped && loop) anchorSchedule(Math.max(grid.originMs, loop.startMs), grid, true)
    else anchorSchedule(elapsedMs, grid)
    activeOriginMs = grid.originMs
  }
  lastTickElapsedMs = elapsedMs

  const ctx = getAudioContext()
  const beatCount = beatsPerBar(grid.timeSignature)
  // The lookahead window is wall time, `elapsedMs` is song time - a slowed pass covers less song per ms.
  const lookaheadSongMs = LOOKAHEAD_MS * playbackRate
  while (nextBeatOnsetMs !== null && nextBeatOnsetMs < elapsedMs + lookaheadSongMs) {
    if (loop && nextBeatOnsetMs >= loop.endMs) break
    playClickAt(ctx, ctx.currentTime + (nextBeatOnsetMs - elapsedMs) / 1000 / playbackRate, nextBeatInBar === 0)
    nextBeatOnsetMs += (60000 / grid.bpm) * activeCorrectionRatio
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
