import { describe, expect, it } from 'vitest'
import { readWav16Mono, trimSpeech, writeWav16Mono } from './wavTrim.js'

const fs = 22050
function clip(leadMs: number, voiceMs: number, tailMs: number, level = 1): Float32Array {
  const n = (ms: number) => Math.round((ms / 1000) * fs)
  const samples = new Float32Array(n(leadMs) + n(voiceMs) + n(tailMs))
  for (let i = 0; i < n(voiceMs); i++) samples[n(leadMs) + i] = level * Math.sin(i / 3)
  return samples
}

describe('speech clip trimming (#63)', () => {
  it('cuts the lead silence to 5 ms, so the voice starts when scheduled', () => {
    const out = trimSpeech({ sampleRate: fs, samples: clip(200, 300, 400) })
    const firstLoud = out.samples.findIndex((s) => Math.abs(s) > 0.1)
    expect((firstLoud / fs) * 1000).toBeGreaterThan(3)
    expect((firstLoud / fs) * 1000).toBeLessThan(7)
    expect((out.samples.length / fs) * 1000).toBeLessThan(5 + 300 + 41)
  })

  it('sets the peak to -3 dBFS', () => {
    const out = trimSpeech({ sampleRate: fs, samples: clip(10, 100, 10, 0.2) })
    const peak = Math.max(...out.samples.map(Math.abs))
    expect(peak).toBeCloseTo(0.708, 2)
  })

  it('round-trips through 16-bit WAV', () => {
    const samples = clip(0, 50, 0, 0.5)
    const back = readWav16Mono(writeWav16Mono({ sampleRate: fs, samples }))
    expect(back.sampleRate).toBe(fs)
    expect(back.samples.length).toBe(samples.length)
    expect(back.samples[10]).toBeCloseTo(samples[10]!, 3)
  })
})
