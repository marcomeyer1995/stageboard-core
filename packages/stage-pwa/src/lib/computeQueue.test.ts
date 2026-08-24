import { describe, expect, it } from 'vitest'
import type { Setlist, ShowState, Song } from 'shared-types'
import { computeQueue } from './computeQueue'

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, chordProContent: '', timecodes: [] }
}

const songs: Song[] = [song('a', 'Song A'), song('b', 'Song B'), song('c', 'Song C')]

const emptyShowState: ShowState = {
  activeSetlistId: null,
  activeSongId: null,
  masterHolderId: null,
  masterClaimedAt: null,
}

describe('computeQueue', () => {
  it('falls back to catalog order with no active setlist', () => {
    const queue = computeQueue(songs, [], emptyShowState)
    expect(queue.orderedSongs.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(queue.currentSong?.id).toBe('a')
    expect(queue.nextSong?.id).toBe('b')
  })

  it('follows the active setlist order instead of catalog order', () => {
    const setlist: Setlist = { id: 'sl-1', name: 'Gig', songIds: ['c', 'a', 'b'] }
    const queue = computeQueue(songs, [setlist], { ...emptyShowState, activeSetlistId: 'sl-1' })
    expect(queue.orderedSongs.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(queue.activeSetlist?.id).toBe('sl-1')
  })

  it('drops setlist song ids that no longer exist in the catalog', () => {
    const setlist: Setlist = { id: 'sl-1', name: 'Gig', songIds: ['a', 'deleted-song', 'b'] }
    const queue = computeQueue(songs, [setlist], { ...emptyShowState, activeSetlistId: 'sl-1' })
    expect(queue.orderedSongs.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('picks current/next from activeSongId', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeSongId: 'b' })
    expect(queue.currentSong?.id).toBe('b')
    expect(queue.nextSong?.id).toBe('c')
  })

  it('has no next song after the last one', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeSongId: 'c' })
    expect(queue.currentSong?.id).toBe('c')
    expect(queue.nextSong).toBeNull()
  })

  it('falls back to the first song when activeSongId is unknown', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeSongId: 'does-not-exist' })
    expect(queue.currentSong?.id).toBe('a')
  })

  it('returns nulls for an empty catalog', () => {
    const queue = computeQueue([], [], emptyShowState)
    expect(queue.currentSong).toBeNull()
    expect(queue.nextSong).toBeNull()
  })
})
