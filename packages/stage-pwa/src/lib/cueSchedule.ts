import type { PlaybackStatus, ShowCue } from 'shared-types'

/**
 * How far ahead (server-time ms) the cue scheduler hands cues over (#477). A MIDI cue handed to
 * WebMIDI with a timestamp leaves the device at exactly that moment, independent of the main
 * thread - but it can't be taken back: `MIDIOutput.clear()` exists on none of our devices (measured
 * 2026-10-13), so Pause/Stop inside this window still lets it out.
 *
 * A cue comes late only when the main thread stalls longer than this minus one tick. Measured
 * 2026-10-13 (docs/21 §8.2): real stalls up to 93 ms on the Fire, as display and as audio device -
 * 100 ms (limit 75) let a few through per run. Marco chose 200 ms (limit 175) for margin over
 * unknown worse cases; the Diagnose tab keeps measuring stalls at every rehearsal.
 */
export const CUE_LOOKAHEAD_MS = 200
/** How often the scheduler looks ahead - well under CUE_LOOKAHEAD_MS, so a single late tick
 * (a busy main thread) still hands every cue over before its time. */
export const CUE_TICK_MS = 25

export interface CueTransport {
  status: PlaybackStatus
  /** Server time the current play stretch started (in the future during the Play lead, docs/19). */
  startedAt: number | null
  accumulatedMs: number
}

/** Song time at server time `now` - unlike computeActiveMs (playbackTransport.ts), not clamped at
 * the stretch start, so it is negative during the Play lead. */
export function songTimeAt(transport: CueTransport, now: number): number {
  if (transport.status === 'playing' && transport.startedAt !== null) return transport.accumulatedMs + (now - transport.startedAt)
  return transport.accumulatedMs
}

/** Server time at which the song reaches `timeMs` - null unless playing (a paused song never
 * reaches it until resumed, which gives a new startedAt). */
export function cueDueAt(transport: CueTransport, timeMs: number): number | null {
  if (transport.status !== 'playing' || transport.startedAt === null) return null
  return transport.startedAt + (timeMs - transport.accumulatedMs)
}

/** Cues already behind the song position - for a device that joins mid-song (reconnect, master
 * handoff, reload): those must never fire late. A cue exactly at the current position, or at 0
 * during the Play lead, is still ahead. */
export function passedCueIds(cues: readonly ShowCue[], transport: CueTransport, now: number): string[] {
  const position = songTimeAt(transport, now)
  return cues.filter((cue) => cue.timeMs < position).map((cue) => cue.id)
}

/** The not-yet-fired cues to send within the lookahead window, in send order. `sendAt` is the
 * server-time due moment minus the output's latency (`latencyMs`, docs/21 §3) - a lamp that
 * needs 30 ms to light is sent 30 ms early. A cue whose send moment already passed (a late tick)
 * is included - better a few ms late than never; WebMIDI sends a past timestamp at once. */
export function cuesToSchedule(
  cues: readonly ShowCue[],
  transport: CueTransport,
  now: number,
  fired: ReadonlySet<string>,
  lookaheadMs = CUE_LOOKAHEAD_MS,
  latencyMs: (cue: ShowCue) => number = () => 0,
): { cue: ShowCue; dueAt: number; sendAt: number }[] {
  const due: { cue: ShowCue; dueAt: number; sendAt: number }[] = []
  for (const cue of cues) {
    if (fired.has(cue.id)) continue
    const dueAt = cueDueAt(transport, cue.timeMs)
    if (dueAt === null) continue
    const sendAt = dueAt - latencyMs(cue)
    if (sendAt <= now + lookaheadMs) due.push({ cue, dueAt, sendAt })
  }
  return due.sort((a, b) => a.sendAt - b.sendAt)
}
