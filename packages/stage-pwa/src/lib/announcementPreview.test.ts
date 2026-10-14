import { describe, expect, it } from 'vitest'
import { sectionAnnouncements } from './announcements'
import { previewSong } from './announcementPreview'

describe('"Ablauf anhören" example song (#63)', () => {
  it('has two count-in bars, the Intro on bar 1 and the chosen part on bar 5', () => {
    const { timeline, content } = previewSong('Refrain', 120, 2)
    const words = sectionAnnouncements(content, timeline, { partCue: [['{name}', '', '#', '#']] })
    expect(words.map((w) => `${w.text}@${Math.round(w.atMs)}`)).toEqual(['1@-4000', '2@-3000', '1@-2000', '2@-1500', '3@-1000', '4@-500', 'Refrain@6000', '3@7000', '4@7500'])
  })
})
