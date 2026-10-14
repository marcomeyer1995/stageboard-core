import type { ClickTimeline } from './beatGrid'

/**
 * MIDI beat clock from the click grid (#478) - the pure part: which ticks lie where in song time,
 * and the Song Position Pointer. Beat 0 of the timeline is bar 1's downbeat, so song position 0 is
 * bar 1 and the count-in lies before it.
 */
export const TICKS_PER_BEAT = 24
export const MIDI_TIMING_CLOCK = 0xf8
export const MIDI_START = 0xfa
export const MIDI_CONTINUE = 0xfb
export const MIDI_STOP = 0xfc

/** Song times (ms) of every clock tick in [fromMs, toMs): 24 per beat, evenly spaced inside each
 * beat of the grid - a tempo change or a tapped tempo curve (#354) is followed beat by beat. */
export function clockTicksBetween(timeline: ClickTimeline, fromMs: number, toMs: number): number[] {
  const ticks: number[] = []
  for (let beat = timeline.beatAtOrBefore(fromMs); ticks.length < 10_000; beat++) {
    const start = timeline.timeOfBeat(beat)
    if (start >= toMs) break
    const period = timeline.periodAfter(beat)
    for (let k = 0; k < TICKS_PER_BEAT; k++) {
      const t = start + (k * period) / TICKS_PER_BEAT
      if (t >= fromMs && t < toMs) ticks.push(t)
    }
  }
  return ticks
}

/** The first 16th note at or after `songMs` - where a Song Position Pointer + Continue can resume
 * (SPP counts 16ths from bar 1; nothing before bar 1). */
export function songPositionAt(timeline: ClickTimeline, songMs: number): { sixteenths: number; atMs: number } {
  if (songMs <= timeline.timeOfBeat(0)) return { sixteenths: 0, atMs: timeline.timeOfBeat(0) }
  let beat = timeline.beatAtOrBefore(songMs)
  const start = timeline.timeOfBeat(beat)
  let sub = Math.ceil(((songMs - start) / timeline.periodAfter(beat)) * 4 - 1e-9)
  if (sub >= 4) {
    beat++
    sub -= 4
  }
  return {
    sixteenths: beat * 4 + sub,
    atMs: timeline.timeOfBeat(beat) + (sub * timeline.periodAfter(beat)) / 4,
  }
}

/** Song Position Pointer message: 14-bit 16th count, LSB first. */
export function songPositionPointer(sixteenths: number): number[] {
  const value = Math.max(0, Math.min(0x3fff, Math.round(sixteenths)))
  return [0xf2, value & 0x7f, (value >> 7) & 0x7f]
}

/** Tick spacing while no song plays: the song's tempo at bar 1 (Marco: the clock always runs,
 * so delays already have the next song's tempo before Play). */
export function freeRunTickMs(timeline: ClickTimeline): number {
  return timeline.periodAfter(0) / TICKS_PER_BEAT
}
