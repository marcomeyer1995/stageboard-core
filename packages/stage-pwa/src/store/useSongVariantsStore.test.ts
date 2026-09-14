import { beforeEach, describe, expect, it, vi } from 'vitest'

// Real PouchDB is unavailable under happy-dom - same stand-in as LibraryView.test.tsx. allDocs
// here actually returns a doc (unlike most other test files' empty-rows stub), since these
// tests are specifically about what getAll()/toVariant() do with one.
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

const { useSongVariantsStore } = await import('./useSongVariantsStore')

beforeEach(() => {
  docs = []
})

describe('useSongVariantsStore - toVariant reads back key/tuning/capo saveVariant writes', () => {
  it('carries key/tuning/capo through init(), not just id/bpm/timeSignature/etc.', async () => {
    docs = [
      {
        id: 'variant-1',
        songId: 'song-1',
        label: 'Original',
        isDefault: true,
        bpm: 125,
        timeSignature: '4/4',
        clickTrackEnabled: false,
        chordProContent: '',
        timecodes: [],
        cues: [],
        beatAnchors: [],
        tempoMarkers: [],
        countInEnabled: false,
        countInBars: 1,
        tracks: [],
        key: 'Dm',
        tuning: 'Drop D',
        capo: 3,
      },
    ]

    await useSongVariantsStore.getState().init('test-workspace')

    expect(useSongVariantsStore.getState().variants).toEqual([
      expect.objectContaining({ id: 'variant-1', key: 'Dm', tuning: 'Drop D', capo: 3 }),
    ])
  })

  it('leaves key/tuning/capo undefined for a variant that genuinely has none', async () => {
    docs = [
      {
        id: 'variant-2',
        songId: 'song-1',
        label: 'Original',
        isDefault: true,
        bpm: 100,
        timeSignature: '4/4',
        clickTrackEnabled: false,
        chordProContent: '',
        timecodes: [],
        cues: [],
        beatAnchors: [],
        tempoMarkers: [],
        countInEnabled: false,
        countInBars: 1,
        tracks: [],
      },
    ]

    await useSongVariantsStore.getState().init('test-workspace')

    const variant = useSongVariantsStore.getState().variants[0]
    expect(variant?.key).toBeUndefined()
    expect(variant?.tuning).toBeUndefined()
    expect(variant?.capo).toBeUndefined()
  })
})
