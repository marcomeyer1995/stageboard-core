import { describe, expect, it } from 'vitest'
import { detectPitch } from './pitchDetection'

function sineWave(frequency: number, sampleRate: number, length: number): Float32Array {
  const buffer = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    buffer[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  }
  return buffer
}

describe('detectPitch', () => {
  it('detects a 440 Hz sine wave (A4)', () => {
    const detected = detectPitch(sineWave(440, 44100, 2048), 44100)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(440, -1)
  })

  it('detects a 220 Hz sine wave (A3)', () => {
    const detected = detectPitch(sineWave(220, 44100, 2048), 44100)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(220, -1)
  })

  it('detects a 110 Hz sine wave (A2)', () => {
    const detected = detectPitch(sineWave(110, 44100, 4096), 44100)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(110, -1)
  })

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(2048), 44100)).toBeNull()
  })

  it('returns null for near-silent noise below the RMS threshold', () => {
    const buffer = new Float32Array(2048).map((_, i) => (i % 2 === 0 ? 0.001 : -0.001))
    expect(detectPitch(buffer, 44100)).toBeNull()
  })
})
