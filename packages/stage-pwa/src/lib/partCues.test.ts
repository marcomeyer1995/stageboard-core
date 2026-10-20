import { describe, expect, it } from 'vitest'
import { CUE_BEAT, CUE_NAME } from 'shared-types'
import { clickTimeline } from './beatGrid'
import { sectionAnnouncements } from './announcements'
import { parseChordPro, tappableLines } from './chordpro'
import { formatCueDirective, isSilentCue, parseCueDirective, partHeads, setPartCue } from './partCues'
import { partBlocks, timelineLines } from './timelineText'

const song = [
  '{start_of_verse: Strophe}',
  '[00:00.00]Erste Zeile',
  '{end_of_verse}',
  '{start_of_chorus}',
  '[00:07.90]Refrain singt',
  '{end_of_chorus}',
  '{part: Bridge}',
  '[00:16.10]Brücke',
].join('\n')
// 120 BPM 4/4: a bar is 2000 ms; Chorus on bar 5, Bridge on bar 9.
const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })
const chorusIndex = partBlocks(timelineLines(song), 30000).find((b) => b.label === 'Chorus')!.partIndex

describe("a part's own announcement (#63 step 2)", () => {
  it('reads and writes the directive: <name>, #, - and own words, bars split by |', () => {
    const pattern = [
      [CUE_NAME, '', 'Auf gehts', ''],
      [CUE_BEAT, CUE_BEAT, CUE_BEAT, CUE_BEAT],
    ]
    const line = formatCueDirective(pattern)
    expect(line).toBe('{x_announce: <name>, -, Auf gehts, - | #, #, #, #}')
    expect(parseCueDirective(line)).toEqual(pattern)
    expect(parseCueDirective('{x_announce: -}')).toEqual([['']])
    expect(isSilentCue([['']])).toBe(true)
    // Separators inside a word can't break the line.
    expect(parseCueDirective(formatCueDirective([['a,b|c{d}']]))).toEqual([['a b c d']])
    expect(parseCueDirective('{comment: x}')).toBeNull()
  })

  it('is stored right after the part directive, replaced and removed there', () => {
    const own = setPartCue(song, chorusIndex, [[CUE_NAME, CUE_BEAT, CUE_BEAT, CUE_BEAT]])
    expect(own.split('\n')[4]).toBe('{x_announce: <name>, #, #, #}')
    expect(partHeads(own).find((h) => h.partIndex === chorusIndex)?.cue).toEqual([[CUE_NAME, CUE_BEAT, CUE_BEAT, CUE_BEAT]])
    const silent = setPartCue(own, chorusIndex, [['']])
    expect(silent.split('\n')[4]).toBe('{x_announce: -}')
    expect(setPartCue(silent, chorusIndex, null)).toBe(song)
  })

  it('changes neither the part numbering, the sheet nor what can be tapped', () => {
    const own = setPartCue(song, chorusIndex, [['']])
    expect(partBlocks(timelineLines(own), 30000)).toEqual(partBlocks(timelineLines(song), 30000))
    // The cue line itself shifts the source lines below it (#607) - the sheet is what must match.
    const sheet = (content: string) => parseChordPro(content).map(({ sourceLine: _line, segments, ...line }) => ({ ...line, segments: segments.map(({ sourceOffset: _offset, ...segment }) => segment) }))
    expect(sheet(own)).toEqual(sheet(song))
    expect(tappableLines(own.split('\n'))[4]).toBe(false)
  })

  it('replaces the band pattern for that part only; "stumm" says nothing there', () => {
    const counted = sectionAnnouncements(setPartCue(song, chorusIndex, [[CUE_NAME, CUE_BEAT, CUE_BEAT, CUE_BEAT]]), timeline)
    expect(counted.map((a) => `${a.text}@${a.atMs}`)).toEqual(['Chorus@6000', '2@6500', '3@7000', '4@7500', 'Bridge@14000'])
    const silent = sectionAnnouncements(setPartCue(song, chorusIndex, [['']]), timeline)
    expect(silent.map((a) => a.text)).toEqual(['Bridge'])
  })

  it('wins over the band muting the name; its name cells stay silent', () => {
    const items = sectionAnnouncements(setPartCue(song, chorusIndex, [[CUE_NAME, '', 'Los', '']]), timeline, { texts: { Chorus: null } })
    expect(items.map((a) => `${a.text}@${a.atMs}`)).toEqual(['Los@7000', 'Bridge@14000'])
  })

  it('on bar 1 it replaces the count-in pattern', () => {
    const verse = partHeads(song)[0]!.partIndex
    const items = sectionAnnouncements(setPartCue(song, verse, [[CUE_NAME, '', '', '']]), clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 2 }))
    expect(items[0]).toEqual({ text: 'Strophe', atMs: -2000, bar: 1 })
  })
})
