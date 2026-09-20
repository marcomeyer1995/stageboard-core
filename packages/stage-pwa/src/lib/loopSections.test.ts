import { describe, expect, it } from 'vitest'
import { parseChordPro } from './chordpro'
import { formatLoopTime, loopSections } from './loopSections'

const SONG = `{part: Verse 1}
[00:10.00]Line one
Line two
{part: Chorus}
[00:40.00][C]Sing along
{part: Solo}
[01:05.50]la la la
{part: Untimed}
no time tag here`

describe('loopSections', () => {
  const lines = parseChordPro(SONG)

  it('lists the timestamped parts, each ending where the next begins', () => {
    expect(loopSections(lines, 120_000)).toEqual([
      { label: 'Verse 1', startMs: 10_000, endMs: 40_000 },
      { label: 'Chorus', startMs: 40_000, endMs: 65_500 },
      { label: 'Solo', startMs: 65_500, endMs: 120_000 },
    ])
  })

  it('leaves the last end open when the track length is unknown', () => {
    expect(loopSections(lines, null)[2]).toEqual({ label: 'Solo', startMs: 65_500, endMs: null })
  })

  it('skips parts without any time tag', () => {
    expect(loopSections(lines, 120_000).map((s) => s.label)).not.toContain('Untimed')
    expect(loopSections(parseChordPro('just lyrics'), 1000)).toEqual([])
  })
})

describe('formatLoopTime', () => {
  it('shows minutes:seconds with one decimal', () => {
    expect(formatLoopTime(83_400)).toBe('1:23.4')
    expect(formatLoopTime(5_000)).toBe('0:05.0')
    expect(formatLoopTime(-10)).toBe('0:00.0')
  })
})
