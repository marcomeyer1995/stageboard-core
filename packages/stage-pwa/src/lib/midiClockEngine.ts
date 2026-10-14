import type { ClickTimeline } from './beatGrid'
import type { CueTransport } from './cueSchedule'
import { clockTicksBetween, freeRunTickMs, MIDI_CONTINUE, MIDI_START, MIDI_STOP, MIDI_TIMING_CLOCK, songPositionAt, songPositionPointer } from './midiClock'

/** One MIDI-Clock output: where to send, and its stored latency (docs/21 §3) - sent that much earlier. */
export interface ClockOutput {
  send: (data: number[], timestamp: number) => void
  latencyMs: number
}

export interface MidiClockInput {
  /** The current song's click grid; null without a song (the clock then keeps its last tempo). */
  timeline: ClickTimeline | null
  transport: CueTransport
  /** Changes with every new take (activeEntryStartedAt) - a fresh take gets Start, not Continue. */
  takeKey: number | null
}

/** How far ahead ticks are handed to WebMIDI (same as cues, #477: survives main-thread stalls). */
const LOOKAHEAD_MS = 200
/** A resume must lie at least this far in the future - time to send SPP before Continue. */
const RESUME_MARGIN_MS = 30
const DEFAULT_TICK_MS = 500 / 24

/**
 * MIDI beat clock (#478), Marco's decisions of 2026-10-13: the clock **always** runs - between
 * songs at the selected song's tempo, so delays are already right before Play; it runs through the
 * count-in and Start goes on bar 1's downbeat (the grid's first downbeat, not the file start);
 * Pause/Stop send Stop; a resume or a jump sends Song Position Pointer + Continue on the next 16th.
 * Every message is timestamped LOOKAHEAD_MS ahead (#477) and sent its output's latency early.
 */
export class MidiClockEngine {
  private lastTick: number | null = null
  private anchor: { startedAt: number; accumulatedMs: number } | null = null
  private takeKey: number | null = null
  /** Whether the gear's sequencer was told to run (Start/Continue sent, no Stop since). */
  private running = false
  private pending: { at: number; messages: number[][] } | null = null

  constructor(
    private readonly serverNow: () => number,
    private readonly perfNow: () => number = () => performance.now(),
  ) {}

  tick(input: MidiClockInput, outputs: readonly ClockOutput[]): void {
    const now = this.serverNow()
    const horizon = now + LOOKAHEAD_MS
    const emit = (data: number[], at: number) => {
      for (const out of outputs) out.send(data, this.perfNow() + (at - now) - out.latencyMs)
    }
    const { transport, timeline } = input
    if (transport.status === 'playing' && transport.startedAt !== null && timeline) {
      const { startedAt, accumulatedMs } = transport
      const toServer = (song: number) => startedAt + (song - accumulatedMs)
      const toSong = (t: number) => accumulatedMs + (t - startedAt)
      if (!this.anchor || this.anchor.startedAt !== startedAt || this.anchor.accumulatedMs !== accumulatedMs) {
        const freshTake = input.takeKey !== this.takeKey
        this.anchor = { startedAt, accumulatedMs }
        this.takeKey = input.takeKey
        if (this.running) {
          emit([MIDI_STOP], now)
          this.running = false
        }
        // Free-running ticks may already be handed over up to LOOKAHEAD_MS ahead - the new position
        // starts after them, never between.
        const earliest = toSong(Math.max(now, this.lastTick ?? now)) + RESUME_MARGIN_MS
        const bar1 = timeline.timeOfBeat(0)
        if (freshTake && bar1 >= earliest) {
          this.pending = { at: toServer(bar1), messages: [[MIDI_START]] }
        } else {
          const { sixteenths, atMs } = songPositionAt(timeline, earliest)
          this.pending = {
            at: toServer(atMs),
            messages: [songPositionPointer(sixteenths), [MIDI_CONTINUE]],
          }
        }
      }
      const from = this.lastTick !== null ? Math.max(this.lastTick + 0.5, now - 1) : now
      for (const song of clockTicksBetween(timeline, toSong(from), toSong(horizon))) {
        const at = toServer(song)
        if (this.pending && at >= this.pending.at - 0.01) {
          // Right before the tick it belongs to: after Start/Continue the next clock is that position.
          this.pending.messages.forEach((message, i) => emit(message, at - (this.pending!.messages.length - i) * 0.5))
          this.pending = null
          this.running = true
        }
        emit([MIDI_TIMING_CLOCK], at)
        this.lastTick = at
      }
      return
    }

    // Not playing: Stop once, then free-run at the song's tempo.
    if (this.anchor) {
      this.anchor = null
      this.pending = null
      if (this.running) {
        emit([MIDI_STOP], now)
        this.running = false
      }
    }
    if (transport.status === 'stopped') this.takeKey = null
    const period = timeline ? freeRunTickMs(timeline) : DEFAULT_TICK_MS
    let at = this.lastTick !== null ? this.lastTick + period : now
    if (at < now - period) at = now // after a stalled tab: resume, don't burst through the gap
    for (; at <= horizon; at += period) {
      emit([MIDI_TIMING_CLOCK], at)
      this.lastTick = at
    }
  }

  /** The clock device went away: tell the gear to stop if it was running. */
  stop(outputs: readonly ClockOutput[]): void {
    if (this.running) for (const out of outputs) out.send([MIDI_STOP], this.perfNow())
    this.running = false
    this.anchor = null
    this.pending = null
    this.lastTick = null
  }
}
