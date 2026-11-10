import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkTrack, encodeTrack } from './opusEncode'

// The checked-in encoder module, round trip through its own check (the players' reader).
const module = new WebAssembly.Module(readFileSync(join(__dirname, 'stageboard_opus.wasm')))

function tone(frames: number, hz: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000))
}

describe('encodeTrack', () => {
  it('gives back exactly the frames that went in, for any length', () => {
    for (const frames of [1, 959, 960, 961, 48000 * 2 + 17]) {
      const file = encodeTrack(module, [tone(frames, 440), tone(frames, 660)])
      expect(checkTrack(module, file)).toBe(frames)
      // An Ogg file with an Opus header.
      expect(String.fromCharCode(...file.slice(0, 4))).toBe('OggS')
      expect(String.fromCharCode(...file.slice(28, 36))).toBe('OpusHead')
    }
  })

  it('keeps mono mono, reports progress, and is the same every time', () => {
    const seen: number[] = []
    const a = encodeTrack(module, [tone(150_000, 440)], (d) => seen.push(d))
    expect(a[37]).toBe(1) // channel count in OpusHead
    expect(seen[seen.length - 1]).toBe(1)
    expect(seen.length).toBe(4) // one per second handed over
    expect(encodeTrack(module, [tone(150_000, 440)])).toEqual(a)
  })

  it('follows the bitrate it is given', () => {
    // Real songs came out at 148 kbit/s on average (6 of the server's tracks, 2026-11-10); a tone
    // is no measure of that - only that the setting takes effect.
    const frames = 48000 * 3
    const at = (bitrate: number) => (encodeTrack(module, [tone(frames, 220), tone(frames, 330)], undefined, bitrate).length * 8) / 3 / 1000
    expect(at(64_000)).toBeLessThan(at(160_000) * 0.6)
  })

  it('check refuses a damaged file', () => {
    const file = encodeTrack(module, [tone(48000, 440), tone(48000, 440)])
    const broken = file.slice()
    broken[Math.floor(broken.length / 2)]! ^= 0x10
    expect(checkTrack(module, broken)).toBe(-1)
    expect(checkTrack(module, file.slice(0, file.length - 10))).toBe(-1)
  })
})
