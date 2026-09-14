import { beforeEach, describe, expect, it, vi } from 'vitest'

// Real PouchDB is unavailable under happy-dom - same stand-in as LibraryView.test.tsx. allDocs
// here actually returns a doc (unlike most other test files' empty-rows stub), since these
// tests are specifically about what getAll()/toSong() do with one.
let docs: unknown[] = []
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async get() {
      throw Object.assign(new Error('missing'), { status: 404 })
    }
    async put() {
      return { ok: true, id: '', rev: '1-fake' }
    }
    async allDocs() {
      return { rows: docs.map((doc) => ({ doc })) }
    }
    changes() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useSongsStore } = await import('./useSongsStore')

beforeEach(() => {
  docs = []
})

describe('useSongsStore - toSong reads back every field saveSong writes', () => {
  it('carries artist through init(), not just id/title/bpm/etc.', async () => {
    docs = [
      {
        id: 'song-1',
        title: 'Sweet Child O’ Mine',
        artist: 'Guns N’ Roses',
        bpm: 125,
        timeSignature: '4/4',
        clickTrackEnabled: false,
        chordProContent: '',
        timecodes: [],
      },
    ]

    await useSongsStore.getState().init('test-workspace')

    expect(useSongsStore.getState().songs).toEqual([
      expect.objectContaining({ id: 'song-1', title: 'Sweet Child O’ Mine', artist: 'Guns N’ Roses' }),
    ])
  })

  it('leaves artist undefined for a song that genuinely has none, rather than inventing one', async () => {
    docs = [
      {
        id: 'song-2',
        title: 'Instrumental',
        bpm: 100,
        timeSignature: '4/4',
        clickTrackEnabled: false,
        chordProContent: '',
        timecodes: [],
      },
    ]

    await useSongsStore.getState().init('test-workspace')

    expect(useSongsStore.getState().songs[0]?.artist).toBeUndefined()
  })
})
