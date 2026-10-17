import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { setPartStartBar } from './partStart'
import { jumpBoundary, nextBarStart, sectionIndexAt, showSections, snapToBar } from './showSections'

// 120 bpm 4/4: 500 ms beats, a bar every 2000 ms.
const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })
const song = ['{part: Intro}', '[00:00.00]x', '{part: Verse 1}', '[00:07.98]a', '{part: Chorus}', '[00:16.03]b'].join('\n')

describe('showSections (#479)', () => {
  it('takes the timeline parts, each start on its bar line, ends at the next start or the track end', () => {
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

describe('section start with a pickup (Marco 2026-10-17: last quarter of a bar = next bar)', () => {
  // Bar 2 runs 2000-4000 ms; its last quarter starts at 3500.
  const part = (entry: string) => ['{part: Intro}', '[00:00.00]x', '{part: Chorus}', `[${entry}]sing`].join('\n')
  const chorusStart = (entry: string) => showSections(part(entry), timeline, 30000)[1]?.startMs

  it('an entry on beat 2 or 3 belongs to the bar it falls in', () => {
    expect(chorusStart('00:02.50')).toBe(2000)
    expect(chorusStart('00:03.00')).toBe(2000)
  })

  it('an entry in the last quarter is a pickup - the section starts with the next bar', () => {
    expect(chorusStart('00:03.50')).toBe(4000)
    expect(chorusStart('00:03.90')).toBe(4000)
  })

  it('a start bar set in the timeline wins - and stays with the part', () => {
    const set = setPartStartBar(part('00:03.00'), 1, 3)
    expect(set).toContain('{x_bar: 3}')
    expect(chorusStart.length).toBe(1)
    expect(showSections(set, timeline, 30000)[1]?.startMs).toBe(4000)
    expect(setPartStartBar(set, 1, null)).toBe(part('00:03.00'))
  })
})

