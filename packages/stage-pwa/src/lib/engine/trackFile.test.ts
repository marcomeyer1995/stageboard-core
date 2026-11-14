import { describe, expect, it } from 'vitest'
import { NoEncoderError, toTrackFile } from './trackFile'

// An Ogg page starting with OpusHead - what the engine and the upload take as they are.
function oggOpus(): Blob {
  const head = new Uint8Array(64)
  head.set([0x4f, 0x67, 0x67, 0x53], 0) // OggS
  head.set([...'OpusHead'].map((c) => c.charCodeAt(0)), 28)
  return new Blob([head])
}

describe('upload as the track format (#775)', () => {
  it('takes Ogg Opus as it is', async () => {
    const file = oggOpus()
    expect(await toTrackFile(file)).toBe(file)
  })

  it('never uploads another format: without an encoder it says so', async () => {
    // jsdom has neither OfflineAudioContext nor a decoder: an MP3 cannot be converted here.
    await expect(toTrackFile(new Blob(['ID3 mp3 bytes']))).rejects.toBeInstanceOf(NoEncoderError)
  })
})
