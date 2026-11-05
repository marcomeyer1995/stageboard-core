import { ALIGN_SOUND } from './alignByEar'

/** Band filters' Q: narrow enough to keep the two sounds apart, wide enough to ring up fast. */
const Q = 4
/** Two filters in series per band: one let the loud accented reference click through into the
 * target's band strongly enough to count as a target click (Fire quieter at 2000 Hz, 2026-11-05). */
const STAGES = 2

/** Onsets per band: the envelope crossing a share of its recent peak, then quiet for a while - and
 * not where it is only the other sound leaking through this band's filter: a loud click of the
 * other sound was counted as a click here (2026-11-05). Times in the context's seconds. A
 * string module (blob URL) - small, no bundler entry. */
const DETECTOR_SOURCE = `
class Onsets extends AudioWorkletProcessor {
  constructor() { super(); this.env = [0, 0]; this.peak = [0, 0]; this.noise = [1e-4, 1e-4]; this.quietUntil = [0, 0] }
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const a = 1 - Math.exp(-1 / (0.0005 * sampleRate))          // envelope ~0.5 ms
    const peakFall = Math.exp(-1 / (2 * sampleRate))             // peak decays over ~2 s
    const noiseA = 1 - Math.exp(-1 / (0.5 * sampleRate))
    for (let ch = 0; ch < 2; ch++) {
      const x = input[Math.min(ch, input.length - 1)]
      for (let i = 0; i < x.length; i++) {
        const v = Math.abs(x[i])
        this.env[ch] += a * (v - this.env[ch])
        this.peak[ch] = Math.max(this.env[ch], this.peak[ch] * peakFall)
        if (this.env[ch] < this.noise[ch] * 3) this.noise[ch] += noiseA * (this.env[ch] - this.noise[ch])
        const t = currentTime + i / sampleRate
        const threshold = this.noise[ch] + 0.3 * (this.peak[ch] - this.noise[ch])
        // Leakage of the other sound through this band's filter is ~10 % of it; a real click of similar
        // loudness is far above that, also while both sound at once.
        if (t >= this.quietUntil[ch] && this.peak[ch] > this.noise[ch] * 6 && this.env[ch] > threshold && this.env[ch] > 0.3 * this.env[1 - ch]) {
          this.port.postMessage({ band: ch, t })
          this.quietUntil[ch] = t + 0.25
        }
      }
    }
    return true
  }
}
registerProcessor('sb-align-onsets', Onsets)
`

export interface AlignmentMic {
  stop: () => void
}

/**
 * Listens with this device's microphone during "Abgleich nach Gehör" (docs/21 §4): two band
 * filters on the two click sounds (ALIGN_SOUND), onsets of each reported with their time. The
 * microphone's own delay drops out - only the gap between the two clicks counts; the filters' ring-up
 * (≈ Q/(π·f) per stage, longer for the lower sound) is taken off each band. Without echo cancellation, noise
 * suppression and gain control, which would smear the clicks.
 */
export async function startAlignmentMic(onOnset: (band: 'reference' | 'target', timeS: number) => void): Promise<AlignmentMic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const ctx = new AudioContext()
  try {
    const url = URL.createObjectURL(new Blob([DETECTOR_SOURCE], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const source = ctx.createMediaStreamSource(stream)
    const merger = ctx.createChannelMerger(2)
    const bands = (['reference', 'target'] as const).map((role, i) => {
      let node: AudioNode = source
      for (let k = 0; k < STAGES; k++) {
        const filter = ctx.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.value = ALIGN_SOUND[role].hz
        filter.Q.value = Q
        node = node.connect(filter)
      }
      node.connect(merger, 0, i)
      return (STAGES * Q) / (Math.PI * ALIGN_SOUND[role].hz)
    })
    const detector = new AudioWorkletNode(ctx, 'sb-align-onsets', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' })
    const silent = ctx.createGain()
    silent.gain.value = 0
    merger.connect(detector).connect(silent).connect(ctx.destination)
    detector.port.onmessage = (e: MessageEvent<{ band: number; t: number }>) => {
      const band = e.data.band === 0 ? 'reference' : 'target'
      onOnset(band, e.data.t - bands[e.data.band]!)
    }
    await ctx.resume()
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    void ctx.close()
    throw error
  }
  return {
    stop: () => {
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
    },
  }
}

if (typeof window !== 'undefined') (window as unknown as { __sbAlignmentMic: typeof startAlignmentMic }).__sbAlignmentMic = startAlignmentMic
