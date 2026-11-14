import { describe, expect, it } from 'vitest'
import { announcementClip, vowelOnsetMs } from './announcementClip'

function buffer(values: number[], sampleRate = 48000, channels = 1): AudioBuffer {
  const data = Array.from({ length: channels }, () => Float32Array.from(values))
  return { sampleRate, length: values.length, numberOfChannels: channels, getChannelData: (c: number) => data[c]! } as unknown as AudioBuffer
}

const decode = (b64: string) => new Int16Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer)

describe('announcementClip', () => {
  it('sends each word once and places it where it is said, in frames from the earliest', () => {
    const clips: Record<string, AudioBuffer> = { Chorus: buffer([0.5, -0.5]), '1': buffer([1, 2]) }
    const clip = announcementClip(
      [
        { text: 'Chorus', atMs: 2000, bar: 2 },
        { text: '1', atMs: -500, bar: 0 },
        { text: 'Chorus', atMs: 10000, bar: 6 },
        { text: 'Missing', atMs: 3000, bar: 3 },
      ] as never,
      (item) => clips[item.text] ?? null,
    )
    expect(clip).not.toBeNull()
    expect(clip!.songStartMs).toBe(-500)
    expect(clip!.rate).toBe(48000)
    expect(clip!.words).toHaveLength(2)
    expect(clip!.starts).toEqual([0, 120000, 504000])
    expect(clip!.wordOf).toEqual([0, 1, 1])
    // Clamped to full scale, int16.
    expect(Array.from(decode(clip!.words[0]!))).toEqual([32767, 32767])
    expect(Array.from(decode(clip!.words[1]!))).toEqual([16384, -16383])
  })

  it('starts at song time 0 when nothing is said before it, and is null without any clip', () => {
    const clip = announcementClip([{ text: 'A', atMs: 1000, bar: 1 }] as never, () => buffer([0]))
    expect(clip!.songStartMs).toBe(0)
    expect(clip!.starts).toEqual([48000])
    expect(announcementClip([{ text: 'A', atMs: 1000, bar: 1 }] as never, () => null)).toBeNull()
  })

  it('averages a stereo clip to mono', () => {
    const stereo = { sampleRate: 48000, length: 1, numberOfChannels: 2, getChannelData: (c: number) => Float32Array.from([c === 0 ? 0.5 : 0]) } as unknown as AudioBuffer
    const clip = announcementClip([{ text: 'A', atMs: 0, bar: 0 }] as never, () => stereo)
    expect(Array.from(decode(clip!.words[0]!))).toEqual([8192])
  })
})

describe('vowelOnsetMs (#842)', () => {
  const word = (silentMs: number, quietMs: number) => {
    const rate = 22050
    const values: number[] = []
    for (let i = 0; i < (rate * silentMs) / 1000; i++) values.push(0)
    for (let i = 0; i < (rate * quietMs) / 1000; i++) values.push(0.02 * Math.sin(i)) // a soft "S"
    for (let i = 0; i < rate * 0.2; i++) values.push(0.7 * Math.sin(i / 3)) // the vowel
    return buffer(values, rate)
  }

  it('finds where the vowel begins, past silence and a soft consonant', () => {
    expect(vowelOnsetMs(word(0, 0))).toBe(0)
    expect(vowelOnsetMs(word(50, 0))).toBeGreaterThanOrEqual(45)
    expect(vowelOnsetMs(word(50, 0))).toBeLessThanOrEqual(55)
    expect(vowelOnsetMs(word(20, 100))).toBeGreaterThanOrEqual(115)
    expect(vowelOnsetMs(word(20, 100))).toBeLessThanOrEqual(125)
  })

  it('moves the word so its vowel is on the beat, the clip starting that much earlier', () => {
    const late = word(50, 0)
    const onset = vowelOnsetMs(late)
    const clip = announcementClip([{ text: 'Vier', atMs: 1000, bar: 1 }] as never, () => late)
    expect(clip!.starts).toEqual([Math.round(((1000 - onset) * 22050) / 1000)])
    expect(announcementClip([{ text: 'Vier', atMs: 1000, bar: 1 }] as never, () => late, false)!.starts).toEqual([22050])
  })
})
