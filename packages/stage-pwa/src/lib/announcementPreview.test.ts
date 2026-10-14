import { describe, expect, it } from 'vitest'
import { sectionAnnouncements } from './announcements'
import { previewSong } from './announcementPreview'

describe('"Ablauf anhören" example song (#63)', () => {
  it('has a count-in bar, the Intro on bar 1 and the chosen part on bar 4', () => {
    const { timeline, content } = previewSong('Refrain', 120, 1)
    const words = sectionAnnouncements(content, timeline, { countdown: { enabled: true, beats: 3, words: ['eins', 'zwei', 'drei'], go: 'Los' } })
    expect(words.map((w) => `${w.text}@${Math.round(w.atMs)}`)).toEqual([
      'Intro@-2000',
      'drei@-1500',
      'zwei@-1000',
      'eins@-500',
      'Los@0',
      'Refrain@4000',
      'drei@4500',
      'zwei@5000',
      'eins@5500',
      'Los@6000',
    ])
  })
})
