import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { parseChordPro } from './chordpro'
import { jumpBoundary, nextBarStart, sectionIndexAt, showSections, snapToBar } from './showSections'

// 120 bpm 4/4: 500 ms beats, a bar every 2000 ms.
const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })
const song = parseChordPro(['{part: Intro}', '[00:00.00]x', '{part: Verse 1}', '[00:07.98]a', '{part: Chorus}', '[00:16.03]b'].join('\n'))

describe('showSections (#479)', () => {
  it('takes the timeline parts, each start snapped to its bar line, ends at the next start or the track end', () => {
    expect(snapToBar(timeline, 7980)).toBe(8000)
    expect(showSections(song, timeline, 30000)).toEqual([
      { label: 'Intro', startMs: 0, endMs: 8000 },
      { label: 'Verse 1', startMs: 8000, endMs: 16000 },
      { label: 'Chorus', startMs: 16000, endMs: 30000 },
    ])
  })

  it('knows the section playing and the next bar line', () => {
    const sections = showSections(song, timeline, 30000)
    expect(sectionIndexAt(sections, 9000)).toBe(1)
    expect(nextBarStart(timeline, 9000)).toBe(10000)
  })

  it('a jump leaves at the next bar line, or at the end of the section playing', () => {
    const sections = showSections(song, timeline, 30000)
    expect(jumpBoundary('bar', 9100, sections, timeline)).toBe(10000)
    expect(jumpBoundary('section', 9100, sections, timeline)).toBe(16000)
    expect(jumpBoundary('section', 17000, showSections(song, timeline, null), timeline)).toBeNull()
  })
})
