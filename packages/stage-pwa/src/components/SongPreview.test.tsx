import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Song, SongVariant } from 'shared-types'

// Every *Store.ts pulls in a real PouchDB at import time (createWorkspaceCollection et al.),
// unavailable under happy-dom - same stand-in as LibraryView.test.tsx/SheetEditor.test.tsx.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async get() {
      throw Object.assign(new Error('missing'), { status: 404 })
    }
    async put() {
      return { ok: true, id: '', rev: '1-fake' }
    }
    async allDocs() {
      return { rows: [] }
    }
    changes() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const song: Song = {
  id: 'song-1',
  title: 'Sweet Child O’ Mine',
  artist: 'Guns N’ Roses',
  bpm: 125,
  timeSignature: '4/4',
  clickTrackEnabled: false,
  chordProContent: '[Verse]\n[C]Take my [G]hand',
  timecodes: [],
}

const variant: SongVariant = {
  id: 'variant-1',
  songId: song.id,
  label: 'Original',
  isDefault: true,
  bpm: song.bpm,
  timeSignature: song.timeSignature,
  clickTrackEnabled: song.clickTrackEnabled,
  chordProContent: song.chordProContent,
  timecodes: [],
  cues: [],
  beatAnchors: [],
  tempoMarkers: [],
  countInEnabled: false,
  countInBars: 1,
  tracks: [],
  key: 'Db',
  tuning: 'Standard',
  capo: 3,
}

const variantWithContent: SongVariant = {
  ...variant,
  id: 'variant-2',
  cues: [{ id: 'cue-1', timeMs: 4000, targetLogicalDeviceId: 'device-1', type: 'scene', payload: {} }],
  tracks: [
    {
      id: 'track-1',
      kind: 'band-mix',
      label: 'Full Band',
      source: 'upload',
      parentTrackId: null,
      mimeType: 'audio/mpeg',
      addedAt: 0,
    },
  ],
  beatAnchors: [{ id: 'anchor-1', timeMs: 0 }],
}

// SongPreview only needs `ensureDefaultVariant` from here - mocked directly so these
// rendering-focused tests don't also have to exercise the real PouchDB-backed persistence
// pipeline just to render, same reasoning as SheetEditor.test.tsx. A mutable variable (not a
// fixed `vi.fn(async () => variant)`) so individual tests can swap in `variantWithContent`.
let resolvedVariant = variant
vi.mock('../lib/songVariantsDb', () => ({
  ensureDefaultVariant: vi.fn(async () => resolvedVariant),
}))

const { SongPreview } = await import('./SongPreview')
const { useSongsStore } = await import('../store/useSongsStore')

describe('SongPreview', () => {
  it('shows title, artist, key/tuning/capo/bpm and the rendered chord sheet once loaded', async () => {
    resolvedVariant = variant
    useSongsStore.setState({ songs: [song] })
    render(<SongPreview songId={song.id} variantId={null} onEdit={vi.fn()} />)

    expect(await screen.findByText('Sweet Child O’ Mine')).toBeInTheDocument()
    expect(screen.getByText('Guns N’ Roses')).toBeInTheDocument()
    expect(screen.getByText('Key: Db')).toBeInTheDocument()
    expect(screen.getByText('Tuning: Standard')).toBeInTheDocument()
    expect(screen.getByText('Capo: 3')).toBeInTheDocument()
    expect(screen.getByText('125 BPM · 4/4')).toBeInTheDocument()
    // The rendered chord sheet, not raw ChordPro markup - "Take my hand" with the [C]/[G]
    // chord markers stripped out by ChordProLyrics's own rendering.
    expect(screen.getByText(/Take my/)).toBeInTheDocument()
  })

  it('shows Cues/Audio/Klick-Anker as present-but-empty when the variant has none (Marco: "full overview")', async () => {
    resolvedVariant = variant
    useSongsStore.setState({ songs: [song] })
    render(<SongPreview songId={song.id} variantId={null} onEdit={vi.fn()} />)

    // Muted, no count - shown at all (not hidden) so "nothing here yet" is part of the
    // overview too, not just what's present.
    expect(await screen.findByText('Cues')).toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
    expect(screen.getByText('Klick-Anker')).toBeInTheDocument()
  })

  it('shows Cues/Audio/Klick-Anker with counts once the variant actually has them', async () => {
    resolvedVariant = variantWithContent
    useSongsStore.setState({ songs: [song] })
    render(<SongPreview songId={song.id} variantId={null} onEdit={vi.fn()} />)

    expect(await screen.findByText('Cues (1)')).toBeInTheDocument()
    expect(screen.getByText('Audio (1)')).toBeInTheDocument()
    expect(screen.getByText('Klick-Anker (1)')).toBeInTheDocument()
  })

  it('"Bearbeiten" calls onEdit', async () => {
    resolvedVariant = variant
    useSongsStore.setState({ songs: [song] })
    const onEdit = vi.fn()
    render(<SongPreview songId={song.id} variantId={null} onEdit={onEdit} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }))
    expect(onEdit).toHaveBeenCalled()
  })

  it('shows a loading state before the song is found', () => {
    useSongsStore.setState({ songs: [] })
    render(<SongPreview songId="missing" variantId={null} onEdit={vi.fn()} />)

    expect(screen.getByText('Lade…')).toBeInTheDocument()
  })
})

describe('SongPreview - song not in the store yet when it mounts', () => {
  it('loads the song as soon as it reaches the store instead of staying on "Lade…"', async () => {
    resolvedVariant = variant
    useSongsStore.setState({ songs: [] })
    render(<SongPreview songId={song.id} variantId={null} onEdit={vi.fn()} />)
    expect(screen.getByText('Lade…')).toBeInTheDocument()

    act(() => useSongsStore.setState({ songs: [song] }))

    expect(await screen.findByText('Sweet Child O’ Mine')).toBeInTheDocument()
  })
})
