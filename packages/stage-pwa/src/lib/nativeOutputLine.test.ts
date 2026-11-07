import { describe, expect, it } from 'vitest'
import { lineAudioPerWall, pushLine } from './nativeOutput'

/** Line readings every 40 ms from `from` to `to` (ms), the audio clock `ppm` slow, `shift` added. */
function feed(history: { at: number; line: number }[], from: number, to: number, ppm: number, shift = 0) {
  for (let at = from; at <= to; at += 40) pushLine(history, at, 1_000_000 + (at * ppm) / 1e6 + shift)
}

describe('the native output line as the audio clock rate', () => {
  it('reads a slow audio clock (the Redmi, -247 ppm)', () => {
    const history: { at: number; line: number }[] = []
    feed(history, 0, 30_000, 247)
    expect(lineAudioPerWall(history)).toBeCloseTo(1 - 247e-6, 6)
  })

  it('a locked screen is a jump, not a slow clock - the Redmi played 8 % fast after 11 s locked (2026-11-07)', () => {
    const history: { at: number; line: number }[] = []
    feed(history, 0, 20_000, 247)
    // Locked: no readings for 11 s, then the line is 2.3 s further on.
    feed(history, 31_000, 33_000, 247, 2300)
    expect(lineAudioPerWall(history)).toBe(1)
    feed(history, 33_040, 50_000, 247, 2300)
    expect(lineAudioPerWall(history)).toBeCloseTo(1 - 247e-6, 6)
  })

  it('never reads further off than 0.2 %', () => {
    const history: { at: number; line: number }[] = []
    feed(history, 0, 30_000, 9000)
    expect(lineAudioPerWall(history)).toBeCloseTo(0.998, 6)
  })
})
