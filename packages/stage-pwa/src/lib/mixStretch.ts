import type { StretchNode } from 'signalsmith-stretch'

/**
 * The loop trainer's tempo change, pitch kept (#683): ONE time-stretch on the whole practice mix,
 * after the stems' gains and Mein Mix's track bus - whatever plays (track, stem mix, a soloed
 * stem) is stretched as one. The sources themselves play at the slower rate (their pitch drops
 * with it), and Signalsmith Stretch shifts the sum back up by the same amount.
 *
 * Signalsmith over SoundTouch: on the Fire both cost about half a core, Signalsmith sounded much
 * better at 80 and 60 % (Marco's blind test, 2026-11-04). It needs ~3 dB headroom - its peaks run
 * higher than the input's - hence the trim.
 *
 * Only in the chain while a trainer session wants it (`setStretchWanted`): at the song's own
 * tempo the mix goes straight to the output - no load, the original sound. The stretch delays what
 * passes it by `latencyMs()`; the stem engine plays that much earlier, so it is heard on time.
 */

const HEADROOM = 0.7

let node: StretchNode | null = null
let creating: Promise<StretchNode | null> | null = null
let latencyS = 0
let trim: GainNode | null = null

/** Loads the stretcher once (WebAssembly, a moment on the Fire) - call before a slowed start. */
export function prepareStretch(ctx: AudioContext): Promise<StretchNode | null> {
  if (node) return Promise.resolve(node)
  creating ??= import('signalsmith-stretch')
    .then(async ({ default: SignalsmithStretch }) => {
      const created = await SignalsmithStretch(ctx)
      latencyS = await created.latency()
      await created.schedule({ active: true, semitones: 0 })
      trim = ctx.createGain()
      trim.gain.value = HEADROOM
      created.connect(trim)
      node = created
      return created
    })
    .catch((err: unknown) => {
      console.error('Time stretch unavailable', err)
      creating = null
      return null
    })
  return creating
}

/** The input to send the mix into and the output to take it from - null while not loaded. */
export function stretchChain(): { input: AudioNode; output: AudioNode } | null {
  return node && trim ? { input: node, output: trim } : null
}

/** How much later than its input the stretched mix is heard. 0 without the stretcher. */
export function stretchLatencyMs(): number {
  return node ? latencyS * 1000 : 0
}

/** Undoes the pitch of sources played at `rate`, from audio time `at` on. */
export function setStretchRate(rate: number, at: number): void {
  void node?.schedule({ output: at, semitones: -12 * Math.log2(rate) })
}
