/**
 * Click onsets in a mono 16-bit microphone stream (docs/21 §4) - the same detector that measured
 * the click latencies on 2026-10-13 (scripts/midi-timing-probe/sync-receiver.py): a crude high-pass
 * (sample difference - the click is 1-1.5 kHz, room noise mostly lower), an adaptive noise floor,
 * a threshold well above it, and a refractory time so one click is one onset. Stateful across
 * chunks, so a live stream can be fed as it arrives.
 */
export class OnsetDetector {
  private prev = 0
  private noise = 200
  private frame = 0
  private lastOnset = -Infinity
  readonly onsets: number[] = []

  constructor(
    private readonly sampleRate: number,
    private readonly refractoryS = 0.3,
    private readonly ignoreFirstS = 0.2,
  ) {}

  /** Feeds samples; returns the frame indices of onsets found in them. */
  feed(samples: Int16Array): number[] {
    const found: number[] = []
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!
      const hp = Math.abs(s - this.prev)
      this.prev = s
      this.noise = 0.9995 * this.noise + 0.0005 * hp
      const frame = this.frame++
      if (frame > this.sampleRate * this.ignoreFirstS && hp > Math.max(8 * this.noise, 600) && frame - this.lastOnset > this.sampleRate * this.refractoryS) {
        this.lastOnset = frame
        found.push(frame)
      }
    }
    this.onsets.push(...found)
    return found
  }
}
