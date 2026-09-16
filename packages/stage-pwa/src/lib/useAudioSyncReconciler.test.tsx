import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, SongVariant, TrackMeta } from 'shared-types'
import { useAudioSyncReconciler } from './useAudioSyncReconciler'
import { reconcileAudioCache } from './audioStorageManager'
import { useQueue } from './queue'
import { useAudioPinsStore } from '../store/useAudioPinsStore'
import { useAudioSyncStore } from '../store/useAudioSyncStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

vi.mock('./audioStorageManager', () => ({ reconcileAudioCache: vi.fn() }))
vi.mock('./queue', () => ({ useQueue: vi.fn() }))
vi.mock('../store/useAudioPinsStore', () => ({ useAudioPinsStore: vi.fn() }))
vi.mock('../store/useAudioSyncStore', () => ({ useAudioSyncStore: vi.fn() }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: vi.fn() }))
vi.mock('../store/useSongVariantsStore', () => ({ useSongVariantsStore: vi.fn() }))

function track(id: string): TrackMeta {
  return { id, kind: 'band-mix', label: 'Band', source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 0 }
}

function variant(id: string, songId: string, tracks: TrackMeta[]): SongVariant {
  return {
    id,
    songId,
    label: 'Original',
    isDefault: true,
    bpm: 120,
    timeSignature: '4/4',
    clickTrackEnabled: false,
    chordProContent: '',
    timecodes: [],
    tracks,
    cues: [],
    beatAnchors: [],
    tempoMarkers: [],
    countInEnabled: false,
    countInBars: 1,
  }
}

function entry(id: string, songId: string): SetlistEntry {
  return { id, songId, variantId: null, trackId: null }
}

function mockQueue(overrides: { currentEntry?: SetlistEntry | null; currentVariant?: SongVariant | null }) {
  vi.mocked(useQueue).mockReturnValue({
    activeSetlist: null,
    orderedItems: [],
    orderedSongs: [],
    previousSong: null,
    currentSong: null,
    nextSong: null,
    previousEntry: null,
    currentEntry: overrides.currentEntry ?? null,
    nextEntry: null,
    previousVariant: null,
    currentVariant: overrides.currentVariant ?? null,
    nextVariant: null,
    isMaster: true,
  } as never)
}

function DriverHost({ workspaceId }: { workspaceId: string }) {
  useAudioSyncReconciler(workspaceId)
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAudioSyncStore).mockImplementation((selector) => selector({ modeFor: () => 'none' } as never))
  vi.mocked(useAudioPinsStore).mockImplementation((selector) => selector({ pinsFor: () => [] } as never))
  vi.mocked(useSongVariantsStore).mockImplementation((selector) => selector({ variants: [] } as never))
  vi.mocked(useShowStateStore).mockImplementation((selector) => selector({ state: { trackOverride: null } } as never))
  mockQueue({})
})

describe('useAudioSyncReconciler', () => {
  it('passes an empty always-keep set when nothing is currently active', () => {
    render(<DriverHost workspaceId="ws-1" />)
    expect(reconcileAudioCache).toHaveBeenCalledWith('none', [], null, [], new Set())
  })

  it("always keeps whatever song is currently active in the queue, even in 'none' mode", () => {
    mockQueue({
      currentEntry: entry('e1', 'song-a'),
      currentVariant: variant('v1', 'song-a', [track('t1')]),
    })
    render(<DriverHost workspaceId="ws-1" />)
    expect(reconcileAudioCache).toHaveBeenCalledWith('none', [], null, [], new Set(['v1:t1']))
  })

  it('has nothing to always-keep when the current song has no track attached', () => {
    mockQueue({
      currentEntry: entry('e1', 'song-a'),
      currentVariant: variant('v1', 'song-a', []), // no tracks at all
    })
    render(<DriverHost workspaceId="ws-1" />)
    expect(reconcileAudioCache).toHaveBeenCalledWith('none', [], null, [], new Set())
  })
})
