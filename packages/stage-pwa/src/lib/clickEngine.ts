import type { ClickTimeline } from './beatGrid'

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
  /** The song's click grid with its count-in (beatGrid.ts `clickTimeline`) - rebuilt by the
   * caller from live values, so a tempo nudge (#140) on a grid without fixed tempo takes effect
   * on the next tick. */
  timeline: ClickTimeline
  /** How fast `elapsedMs` advances relative to wall time (#61's Speed Trainer: 0.8 = an 80 % pass).
   * Absent means 1. Beat spacing stays in song time; only the wall-clock conversion below uses it. */
  playbackRate?: number
  /** The song-time section a Rehearsal Loop (#61) repeats. Beats are never scheduled past its end -
   * the loop wraps there, so a beat queued beyond it would sound in the wrong place. */
  loop?: { startMs: number; endMs: number } | null
}

let audioContext: AudioContext | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
/** The next not-yet-scheduled beat (its number on the timeline) and its song time. On a rigid
 * grid (≥ 2 points) the time is read from the grid for every beat - exact, and a grid edited
 * while playing takes effect at once. With a single point the time advances by the live beat
 * length instead: recomputing it from bar 1 would re-quantize the whole song onto a nudged
 * (#140) tempo and move "the next beat" by seconds (#25 review) - advancing means a nudge only
 * changes the spacing from here on. */
let nextBeat: number | null = null
let nextBeatOnsetMs = 0
/** `elapsedMs` as of the last tick - used to detect a large gap between ticks (see
 * RESYNC_GAP_MS below), not to schedule anything itself. */
let lastTickElapsedMs: number | null = null
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

/** Points the schedule at the first beat after `fromMs` - or at it, for a loop restart (#61),
 * where a beat exactly on the loop start begins the new pass - never before the first click. */
function anchorSchedule(timeline: ClickTimeline, fromMs: number, inclusive: boolean): void {
  let beat = timeline.beatAtOrBefore(fromMs)
  if (!(inclusive && timeline.timeOfBeat(beat) === fromMs)) beat++
  nextBeat = Math.max(timeline.firstBeat, beat)
  nextBeatOnsetMs = timeline.timeOfBeat(nextBeat)
  nextBeatAudioTime = null
}

/** One scheduler tick: tops up the oscillator queue with every beat that has newly entered the
 * lookahead window since the last tick (the windows deliberately overlap - see
 * TICK_INTERVAL_MS/LOOKAHEAD_MS above - and the cursor makes sure no beat is queued twice).
 * Silent, and resets the cursor, whenever nothing is playing. Re-anchors
 * (instead of bursting through a backlog) when `elapsedMs` jumped by more than RESYNC_GAP_MS
 * since the last tick (a throttled/backgrounded tab), or went backwards (a loop wrap or seek). */
function tick(getState: () => ClickEngineState): void {
  const { elapsedMs, timeline, playbackRate = 1, loop = null } = getState()
  if (elapsedMs === null) {
    nextBeat = null
    nextBeatAudioTime = null
    lastTickElapsedMs = null
    return
  }
  const stalled = lastTickElapsedMs !== null && elapsedMs - lastTickElapsedMs > RESYNC_GAP_MS
  const wrapped = lastTickElapsedMs !== null && elapsedMs < lastTickElapsedMs
  if (nextBeat === null || stalled || wrapped) {
    if (wrapped && loop) anchorSchedule(timeline, Math.max(timeline.timeOfBeat(timeline.firstBeat), loop.startMs), true)
    else anchorSchedule(timeline, elapsedMs, false)
  }
  lastTickElapsedMs = elapsedMs

  const ctx = getAudioContext()
  const audioNow = smoothedAudioNow(ctx)
  // The lookahead window is wall time, `elapsedMs` is song time - a slowed pass covers less song per ms.
  const lookaheadSongMs = LOOKAHEAD_MS * playbackRate
  while (nextBeat !== null) {
    if (timeline.rigid) nextBeatOnsetMs = timeline.timeOfBeat(nextBeat)
    if (nextBeatOnsetMs >= elapsedMs + lookaheadSongMs) break
    if (loop && nextBeatOnsetMs >= loop.endMs) break
    const converted = audioNow + (nextBeatOnsetMs - elapsedMs) / 1000 / playbackRate
    if (nextBeatAudioTime === null || Math.abs(converted - nextBeatAudioTime) > AUDIO_TIME_TOLERANCE_S) {
      nextBeatAudioTime = converted
    }
    playClickAt(ctx, nextBeatAudioTime, timeline.beatInBar(nextBeat) === 0)
    const beatMs = timeline.periodAfter(nextBeat)
    nextBeat++
    nextBeatOnsetMs += beatMs
    nextBeatAudioTime += beatMs / 1000 / playbackRate
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
  nextBeat = null
  nextBeatAudioTime = null
  clockOffsets.length = 0
  lastClockReading = null
  ticksSinceClockMoved = Infinity
  lastTickElapsedMs = null
}

/** Test-only escape hatch - vitest's jsdom environment has no real AudioContext, and the module
 * otherwise has no way to reset its module-level scheduler state between tests. */
export function __resetClickEngineForTests(): void {
  stopClick()
  audioContext = null
}
