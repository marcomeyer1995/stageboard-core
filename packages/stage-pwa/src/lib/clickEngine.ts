import { upcomingBeats } from './metronome'

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
}

let audioContext: AudioContext | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let lastScheduledBeatIndex = -1

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

/** One scheduler tick: tops up the oscillator queue with any beat that has newly entered the
 * lookahead window since the last tick, skipping anything already scheduled (the two windows
 * deliberately overlap - see TICK_INTERVAL_MS/LOOKAHEAD_MS above). Silent, and resets the
 * dedup cursor, whenever nothing is currently playing. */
function tick(getState: () => ClickEngineState): void {
  const { elapsedMs, bpm, timeSignature } = getState()
  if (elapsedMs === null) {
    lastScheduledBeatIndex = -1
    return
  }
  const ctx = getAudioContext()
  const beats = upcomingBeats(elapsedMs, LOOKAHEAD_MS, bpm, timeSignature)
  for (const beat of beats) {
    if (beat.beatIndex <= lastScheduledBeatIndex) continue
    playClickAt(ctx, ctx.currentTime + beat.msFromNow / 1000, beat.isDownbeat)
    lastScheduledBeatIndex = beat.beatIndex
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
  lastScheduledBeatIndex = -1
}

/** Test-only escape hatch - vitest's jsdom environment has no real AudioContext, and the module
 * otherwise has no way to reset its module-level scheduler state between tests. */
export function __resetClickEngineForTests(): void {
  stopClick()
  audioContext = null
}
