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
  /** A queued section jump (#479): from server time `at` on, the song continues at `toMs`. */
  jump?: { at: number; toMs: number } | null
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
  /** The section jump the ticks already followed (#479) - its later fold into the transport anchor
   * is the same song clock, no seek: no Stop/Continue. */
  private followedJump: { at: number; toMs: number } | null = null

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
    const { transport, timeline, jump = null } = input
    if (transport.status === 'playing' && transport.startedAt !== null && timeline) {
      const { startedAt, accumulatedMs } = transport
      const toServer = (song: number) => startedAt + (song - accumulatedMs)
      const toSong = (t: number) => accumulatedMs + (t - startedAt)
      const folded = this.followedJump !== null && this.followedJump.at === startedAt && this.followedJump.toMs === accumulatedMs
      if (folded) {
        // The master folded the jump we already followed into the anchor - same clock, carry on.
        this.anchor = { startedAt, accumulatedMs }
        this.followedJump = null
      }
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
      const tickAt = (at: number) => {
        if (this.pending && at >= this.pending.at - 0.01) {
          // Right before the tick it belongs to: after Start/Continue the next clock is that position.
          this.pending.messages.forEach((message, i) => emit(message, at - (this.pending!.messages.length - i) * 0.5))
          this.pending = null
          this.running = true
        }
        emit([MIDI_TIMING_CLOCK], at)
        this.lastTick = at
      }
      // A queued section jump (#479): the ticks run on across it without a stop, from the target's
      // bar line on (both bar lines, so the beat stays even); right at it the gear is told the new
      // position (Song Position Pointer) - a loop pedal or drum machine follows, a delay just keeps
      // the tempo.
      const jumpAt = jump && jump.at > from ? jump.at : null
      const pastFollowedJump = jump !== null && jumpAt === null && this.followedJump?.at === jump.at
      const until = jumpAt !== null ? Math.min(horizon, jumpAt - 0.01) : horizon
      if (!pastFollowedJump) for (const song of clockTicksBetween(timeline, toSong(from), toSong(until))) tickAt(toServer(song))
      if (jump && jumpAt !== null && horizon >= jumpAt) {
        if (this.running && (!this.followedJump || this.followedJump.at !== jump.at)) emit(songPositionPointer(songPositionAt(timeline, jump.toMs).sixteenths), jumpAt - 0.5)
        this.followedJump = { at: jump.at, toMs: jump.toMs }
        const toServerAfter = (song: number) => jump.at + (song - jump.toMs)
        for (const song of clockTicksBetween(timeline, jump.toMs, jump.toMs + (horizon - jump.at))) tickAt(toServerAfter(song))
      } else if (jump && pastFollowedJump) {
        // Past the boundary, before the fold: keep counting in the target's time.
        const toServerAfter = (song: number) => jump.at + (song - jump.toMs)
        const toSongAfter = (t: number) => jump.toMs + (t - jump.at)
        for (const song of clockTicksBetween(timeline, toSongAfter(from), toSongAfter(horizon))) tickAt(toServerAfter(song))
      }
      return
    }

    // Not playing: Stop once, then free-run at the song's tempo.
    if (this.anchor) {
      this.anchor = null
      this.pending = null
      this.followedJump = null
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
