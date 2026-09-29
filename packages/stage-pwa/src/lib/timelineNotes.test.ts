import { describe, expect, it } from 'vitest'
import { insertComment, lineAtTime, moveNote, removeNote, setNoteTargets, setNoteText, timelineNotes } from './timelineNotes'

const song = [
  '{part: Verse}',
  '{c: Solo starts in 8th fret}',
  '[00:10.00] First line',
  '[00:14.00] Second line',
  '{sot: Riff}',
  'e|---5---|',
  'B|-5---5-|',
  '{eot}',
  '[00:20.00] Third line',
  '{cc4marco: Switch sound}',
  '[00:26.00] Fourth line',
].join('\n')

describe('timelineNotes', () => {
  it('finds comments and tab blocks with the line they belong to', () => {
    expect(timelineNotes(song)).toEqual([
      { kind: 'comment', start: 1, end: 2, text: 'Solo starts in 8th fret', targets: null, anchorRawIndex: 2, timeMs: 10000 },
      { kind: 'tab', start: 4, end: 8, text: 'Riff', targets: null, anchorRawIndex: 8, timeMs: 20000 },
      { kind: 'comment', start: 9, end: 10, text: 'Switch sound', targets: ['marco'], anchorRawIndex: 10, timeMs: 26000 },
    ])
  })

  it('a note after the last line belongs to that line', () => {
    expect(timelineNotes('[00:05.00] Only line\n{c: Outro fade}')[0]).toEqual(expect.objectContaining({ anchorRawIndex: 0, timeMs: 5000 }))
  })
})

describe('moving a note', () => {
  it('attaches a comment to the line playing at the new time', () => {
    expect(lineAtTime(song, 15000)?.rawIndex).toBe(3)
    const { content, start } = moveNote(song, 1, 15000)
    expect(start).toBe(2)
    const moved = content.split('\n')
    expect(moved.slice(0, 4)).toEqual(['{part: Verse}', '[00:10.00] First line', '{c: Solo starts in 8th fret}', '[00:14.00] Second line'])
  })

  it('moves a tab block as a whole, backwards in the text too', () => {
    const { content, start } = moveNote(song, 4, 11000)
    expect(start).toBe(2)
    const moved = content.split('\n')
    expect(moved.slice(1, 7)).toEqual(['{c: Solo starts in 8th fret}', '{sot: Riff}', 'e|---5---|', 'B|-5---5-|', '{eot}', '[00:10.00] First line'])
    expect(moved).toHaveLength(song.split('\n').length)
  })

  it('leaves the text alone when the note already belongs to that line', () => {
    expect(moveNote(song, 9, 27000)).toEqual({ content: song, start: 9 })
  })
})

describe('adding, editing, removing', () => {
  it('adds a comment for everyone before the line playing there', () => {
    expect(insertComment(song, 21000, 'Watch the drummer').split('\n')[8]).toBe('{cc: Watch the drummer}')
  })

  it('rewrites the text and who sees it', () => {
    expect(setNoteText(song, 9, 'Switch to lead').split('\n')[9]).toBe('{cc4marco: Switch to lead}')
    expect(setNoteTargets(song, 1, ['Marco', 'Jamie']).split('\n')[1]).toBe('{cc4Marco,Jamie: Solo starts in 8th fret}')
    expect(setNoteTargets(song, 4, ['Marco']).split('\n')[4]).toBe('{sot4Marco: Riff}')
  })

  it('removes a comment line, or a whole tab block', () => {
    expect(removeNote(song, 1).split('\n')).toHaveLength(10)
    expect(removeNote(song, 4).split('\n')).toEqual(song.split('\n').filter((_, i) => i < 4 || i > 7))
  })
})
