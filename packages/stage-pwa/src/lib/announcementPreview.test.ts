import { describe, expect, it } from 'vitest'
import { sectionAnnouncements } from './announcements'
import { previewSong } from './announcementPreview'

describe('"Ablauf anhören" example song (#63)', () => {
  it('has two count-in bars, the Intro on bar 1 and the chosen part on bar 5 - countdown on the main pulses', () => {
    const { timeline, content } = previewSong('Refrain', 120, 2)
    const words = sectionAnnouncements(content, timeline, { countdown: { enabled: true, beats: 3, spacing: 'pulse', words: ['eins', 'zwei', 'drei'], go: 'Los' } })
    expect(words.map((w) => `${w.text}@${Math.round(w.atMs)}`)).toEqual([
      'Intro@-4000',
      'drei@-3000',
      'zwei@-2000',
      'eins@-1000',
      'Los@0',
      'Refrain@4000',
      'drei@5000',
      'zwei@6000',
      'eins@7000',
      'Los@8000',
    ])
  })
})
