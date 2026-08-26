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

  it('still detects a quiet, decaying note whose peak never reaches the old fixed 0.2 trim threshold', () => {
    // A real held note well into its decay - clearly above the RMS gate (0.01), but with
    // a peak far below what a fixed absolute trim threshold of 0.2 would ever catch.
    const quiet = sineWave(440, 44100, 2048).map((sample) => sample * 0.05)
    const detected = detectPitch(quiet, 44100)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(440, -1)
  })

  it('honors a lower minRms to catch an even quieter note', () => {
    const veryQuiet = sineWave(440, 44100, 2048).map((sample) => sample * 0.008)
    expect(detectPitch(veryQuiet, 44100)).toBeNull() // below the default gate
    const detected = detectPitch(veryQuiet, 44100, 0.003)
    expect(detected).not.toBeNull()
    expect(detected as number).toBeCloseTo(440, -1)
  })
})
