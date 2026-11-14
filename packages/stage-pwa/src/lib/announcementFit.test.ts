import { describe, expect, it } from 'vitest'
import { FIT_MAX_SPEED, fitAnnouncements, type Announcement } from './announcements'

// "When I Come Around" (2026-11-14): beats ~300 ms apart, words 300-690 ms long.
const lengths: Record<string, number> = { Refrain: 690, Zwei: 390, Drei: 370, Vier: 300, Eins: 380, Kurz: 200 }
const len = (text: string) => lengths[text] ?? null
const at = (text: string, atMs: number, name = false): Announcement => ({ text, atMs, bar: 5, ...(name ? { name: true as const } : {}) })

describe('fitAnnouncements (#842)', () => {
  it('leaves a word that fits its beat as it is', () => {
    expect(fitAnnouncements([at('Kurz', 0), at('Zwei', 300)], len)).toEqual([at('Kurz', 0), at('Zwei', 300)])
  })

  it('speaks a word too long for its beat faster, just enough', () => {
    const [eins] = fitAnnouncements([at('Eins', 0), at('Zwei', 300)], len)
    // 380 ms into 270 ms (300 less the 30-ms gap): 1.41 → 1.45
    expect(eins!.speed).toBeCloseTo(1.45, 5)
  })

  it('a name too long even at the fastest runs over the next number, which is left out', () => {
    const out = fitAnnouncements([at('Refrain', 0, true), at('Zwei', 300), at('Drei', 600), at('Vier', 900)], len)
    expect(out.map((a) => a.text)).toEqual(['Refrain', 'Drei', 'Vier'])
    // 690 ms into 570 ms: 1.21 → 1.25
    expect(out[0]!.speed).toBeCloseTo(1.25, 5)
  })

  it('never faster than the limit - what still does not fit is cut as before', () => {
    const [eins] = fitAnnouncements([at('Eins', 0), at('Zwei', 100)], len)
    expect(eins!.speed).toBe(FIT_MAX_SPEED)
  })

  it('counts from the band pace, and leaves words with unknown length alone', () => {
    // Already at 1.2: 1.41 more would be 1.69 - held at the limit.
    const [eins] = fitAnnouncements([at('Eins', 0), at('Zwei', 300)], len, 1.2)
    expect(eins!.speed).toBe(FIT_MAX_SPEED)
    // 300 ms into 270 at 1.2: 1.11 more → 1.35.
    const [vier] = fitAnnouncements([at('Vier', 0), at('Zwei', 300)], len, 1.2)
    expect(vier!.speed).toBeCloseTo(1.35, 5)
    expect(fitAnnouncements([at('Unknown', 0), at('Zwei', 100)], len)[0]!.speed).toBeUndefined()
  })
})
