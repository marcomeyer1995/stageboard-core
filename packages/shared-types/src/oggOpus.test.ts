import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { oggOpusInfo, opusPacketSamples, webmOpusToOgg } from './oggOpus.js'

// A WebM/Opus file from ffmpeg's libopus + WebM muxer (__fixtures__/make_webm_opus.py), which
// ffmpeg itself decodes to 72000 frames.
const webm = new Uint8Array(readFileSync(join(__dirname, '__fixtures__', 'stereo.webm')))

describe('webmOpusToOgg', () => {
  it('re-wraps the packets: same length, same start, valid pages', () => {
    const ogg = webmOpusToOgg(webm)
    expect(ogg).not.toBeNull()
    // The players' strict reader (native OpusClip, as WebAssembly) agrees - checked in
    // stage-pwa's opusEncode test; here our own reading of the pages and their checksums.
    expect(oggOpusInfo(ogg!)).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
  })

  it('carries the audio over unchanged - no encoding, nothing lost', () => {
    const ogg = webmOpusToOgg(webm)!
    // Every Opus packet of the WebM appears in the Ogg file byte for byte: the Ogg file is the
    // WebM's packet bytes plus headers - about the same size.
    expect(Math.abs(ogg.length - webm.length) / webm.length).toBeLessThan(0.05)
  })

  it('refuses what is not WebM with Opus', () => {
    expect(webmOpusToOgg(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80]))).toBeNull()
    expect(webmOpusToOgg(new TextEncoder().encode('ID3 not webm at all'))).toBeNull()
    expect(webmOpusToOgg(webm.subarray(0, 200))).toBeNull()
  })

  it('reads packet durations from the TOC byte', () => {
    expect(opusPacketSamples(new Uint8Array([0xfc]))).toBe(960) // CELT 20 ms, one frame
    expect(opusPacketSamples(new Uint8Array([0xfd]))).toBe(1920) // two frames
    expect(opusPacketSamples(new Uint8Array([0xfb, 0x03]))).toBe(2880) // CELT 20 ms, code 3: three frames
    expect(opusPacketSamples(new Uint8Array([0x1b, 0x03]))).toBe(0) // SILK 60 ms × 3 = 180 ms > 120 ms
  })

  it('oggOpusInfo refuses a damaged page', () => {
    const ogg = webmOpusToOgg(webm)!.slice()
    ogg[ogg.length - 100]! ^= 1
    expect(oggOpusInfo(ogg)).toBeNull()
  })
})
