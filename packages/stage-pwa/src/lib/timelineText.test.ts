import { describe, expect, it } from 'vitest'
import { lineTimeBounds, partBlocks, setLineTime, stampLines, tapStartLine, timelineLines } from './timelineText'

const song = [
  '{title: Test}',
  '{part: Verse}',
  '[00:10.00] [G]Twenty-five years and my [Am]life is still',
  'Trying to get up that great big hill',
  '[00:18.00] Of hope',
  '',
  '{part: Chorus}',
  '{c: all together}',
  '[00:30.00] And I say hey',
  "What's going on",
].join('\n')

describe('timelineLines', () => {
  it('lists the lyric lines with time, plain text and part - directives, comments and blanks left out', () => {
    expect(timelineLines(song)).toEqual([
      { rawIndex: 2, timeMs: 10000, text: 'Twenty-five years and my life is still', partIndex: 0, partLabel: 'Verse' },
      { rawIndex: 3, timeMs: null, text: 'Trying to get up that great big hill', partIndex: 0, partLabel: 'Verse' },
      { rawIndex: 4, timeMs: 18000, text: 'Of hope', partIndex: 0, partLabel: 'Verse' },
      { rawIndex: 8, timeMs: 30000, text: 'And I say hey', partIndex: 1, partLabel: 'Chorus' },
      { rawIndex: 9, timeMs: null, text: "What's going on", partIndex: 1, partLabel: 'Chorus' },
    ])
  })
})

describe('moving a line', () => {
  it('keeps a line between its tagged neighbours', () => {
    const lines = timelineLines(song)
    expect(lineTimeBounds(lines, 4)).toEqual({ minMs: 10100, maxMs: 29900 })
    expect(lineTimeBounds(lines, 3)).toEqual({ minMs: 10100, maxMs: 17900 })
  })

  it('writes the time tag of exactly that line, clamped - the rest of the text stays', () => {
    const moved = setLineTime(song, 4, 45000)
    expect(moved.split('\n')[4]).toBe('[00:29.90] Of hope')
    expect(moved.split('\n').filter((_, i) => i !== 4)).toEqual(song.split('\n').filter((_, i) => i !== 4))
    expect(setLineTime(song, 3, 14000).split('\n')[3]).toBe('[00:14.00] Trying to get up that great big hill')
  })

  it('removes a time tag', () => {
    expect(setLineTime(song, 8, null).split('\n')[8]).toBe('And I say hey')
  })
})

describe('Zeilen tippen', () => {
  it('starts at the selected line, else at the first line without a time', () => {
    const lines = timelineLines(song)
    expect(tapStartLine(lines, 8)?.rawIndex).toBe(8)
    expect(tapStartLine(lines, null)?.rawIndex).toBe(3)
  })

  it('stamps one line per tap in text order, skipping directives, and leaves the other lines', () => {
    const tapped = stampLines(song, 4, [19000, 31000, 33500])
    const raw = tapped.split('\n')
    expect(raw[4]).toBe('[00:19.00] Of hope')
    expect(raw[7]).toBe('{c: all together}')
    expect(raw[8]).toBe('[00:31.00] And I say hey')
    expect(raw[9]).toBe("[00:33.50] What's going on")
    expect(raw[2]).toBe(song.split('\n')[2])
  })
})

describe('chord-only rows when tapping (#325)', () => {
  const withIntro = ['{part: Intro}', '| [C] | [F] | [G] | [G] |', '[C] [G]', '{part: Verse}', 'First [C]line', 'Second line'].join('\n')

  it('are skipped: never the start, never stamped', () => {
    const lines = timelineLines(withIntro)
    expect(lines.map((l) => l.rawIndex)).toEqual([1, 2, 4, 5]) // still on the timeline
    expect(tapStartLine(lines, null)?.rawIndex).toBe(4)
    expect(tapStartLine(lines, 1)?.rawIndex).toBe(4) // a selected chord row starts at the next lyric
    const raw = stampLines(withIntro, 4, [5000, 9000]).split('\n')
    expect(raw[1]).toBe('| [C] | [F] | [G] | [G] |')
    expect(raw[4]).toBe('[00:05.00] First [C]line')
    expect(raw[5]).toBe('[00:09.00] Second line')
  })
})

describe('partBlocks', () => {
  it('spans each part from its first timed line to the next part', () => {
    expect(partBlocks(timelineLines(song), 60000)).toEqual([
      { partIndex: 0, label: 'Verse', startMs: 10000, endMs: 30000 },
      { partIndex: 1, label: 'Chorus', startMs: 30000, endMs: 60000 },
    ])
  })

  it('leaves out parts without a timed line', () => {
    const untimedChorus = song.replace('[00:30.00] ', '')
    expect(partBlocks(timelineLines(untimedChorus), 60000).map((b) => b.label)).toEqual(['Verse'])
  })
})
