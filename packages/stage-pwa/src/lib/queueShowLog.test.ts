import { describe, expect, it, vi } from 'vitest'
import type { Setlist, Song } from 'shared-types'

// queue.ts -> workspaceDb.ts constructs a real PouchDB at load time (see cueFiring.test.ts).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { advanceToNextSong } = await import('./queue')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useShowLogStore } = await import('../store/useShowLogStore')
const { useSongsStore } = await import('../store/useSongsStore')
const { useSetlistsStore } = await import('../store/useSetlistsStore')

const song = (id: string): Song => ({ id, title: id.toUpperCase(), bpm: 120, timeSignature: '4/4', chordProContent: '' }) as Song

describe('song-played in the Nachbericht (#409 review)', () => {
  it('one play-through has one id, whichever device of the master finalizes it', async () => {
    const setlist: Setlist = { id: 'sl', name: 'Gig', createdAt: 0, entries: [{ id: 'e1', songId: 'a', variantId: null, trackId: null }, { id: 'e2', songId: 'b', variantId: null, trackId: null }] }
    useSongsStore.setState({ songs: [song('a'), song('b')] })
    useSetlistsStore.setState({ setlists: [setlist] })
    const append = vi.fn(async () => {})
    useShowLogStore.setState({ append })
    const base = useShowStateStore.getState().state
    useShowStateStore.setState({
      isMaster: true,
      applyPatch: vi.fn(async () => {}),
      state: { ...base, activeSetlistId: 'sl', activeEntryId: 'e1', activeEntryStartedAt: 1000, currentShowId: 'show-1', playbackStatus: 'paused', playbackStartedAt: null, playbackAccumulatedMs: 60_000 },
    })

    await advanceToNextSong()
    await advanceToNextSong()

    const ids = (append.mock.calls as unknown as Array<[{ id: string; type: string }]>).filter(([event]) => event.type === 'song-played').map(([event]) => event.id)
    expect(ids).toEqual(['song-played-show-1-1000', 'song-played-show-1-1000'])
  })
})
