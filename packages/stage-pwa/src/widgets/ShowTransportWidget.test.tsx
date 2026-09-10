import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from 'shared-types'
import type { SetlistEntry, Song, SongVariant, TrackMeta } from 'shared-types'
import { ShowTransportWidget } from './ShowTransportWidget'
import { useShowMode } from '../lib/showMode'
import { loadLocalTrack, unloadLocalTrack } from '../lib/localAudioEngine'
import { useShowStateStore } from '../store/useShowStateStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

// Explicit factories, not auto-mocks: an auto-mock still has to import the real module first to
// derive its shape, and useShowStateStore.ts/usePluginsStore.ts/showMode.ts (plus the Logical
// Devices store useHardwareBindingFor.ts reads, and - now that clientTranslator.ts also
// registers kemperTranslator.ts - useDeviceTransportConfigStore) all transitively pull in
// workspaceDb.ts's top-level `new PouchDB(...)`, which throws outside a real browser/IndexedDB
// environment (hardwareRouting.ts itself stays free of this - see its own doc comment).
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: vi.fn() }))
vi.mock('../store/usePluginsStore', () => ({ usePluginsStore: vi.fn() }))
vi.mock('../store/useLogicalDevicesStore', () => ({ useLogicalDevicesStore: vi.fn() }))
vi.mock('../store/useDeviceTransportConfigStore', () => ({ useDeviceTransportConfigStore: vi.fn() }))
vi.mock('../lib/localAudioEngine', () => ({
  loadLocalTrack: vi.fn(),
  playLocalTrack: vi.fn(),
  pauseLocalTrack: vi.fn(),
  stopLocalTrack: vi.fn(),
  unloadLocalTrack: vi.fn(),
}))

function track(id: string): TrackMeta {
  return { id, kind: 'band-mix', label: 'Band', source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 0 }
}

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', chordProContent: '', timecodes: [] }
}

function variant(id: string, songId: string, tracks: TrackMeta[]): SongVariant {
  return {
    id,
    songId,
    label: 'Original',
    isDefault: true,
    bpm: 120,
    timeSignature: '4/4',
    chordProContent: '',
    timecodes: [],
    tracks,
    cues: [],
  }
}

function entry(id: string, songId: string): SetlistEntry {
  return { id, songId, variantId: null, trackId: null }
}

/** #10's whole point: the claimed audio-output device and the Master-Token holder can be two
 * different tablets - `canControl` (Master) is false by default in every test here, since the
 * original bug (found live, 2026-09-05) only ever showed up on the *non-master* claimed device. */
function mockShowMode(overrides: {
  currentEntry: SetlistEntry | null
  currentSong: Song | null
  currentVariant: SongVariant | null
  canControl?: boolean
}) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: 'gig',
    queue: {
      activeSetlist: null,
      orderedItems: [],
      orderedSongs: [],
      previousSong: null,
      currentSong: overrides.currentSong,
      nextSong: null,
      previousEntry: null,
      currentEntry: overrides.currentEntry,
      nextEntry: null,
      previousVariant: null,
      currentVariant: overrides.currentVariant,
      nextVariant: null,
    },
    elapsedMs: 0,
    playbackStatus: 'stopped',
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    setLiveTempoAdjustPercent: vi.fn(),
    nudgeLiveTempoAdjustPercent: vi.fn(),
    canControl: overrides.canControl ?? false,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setTrackOverride: vi.fn(),
  })
}

const DEVICE_ID = 'laptop-device'
const AUDIO_LOGICAL_DEVICE_ID = 'audio-output'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useShowStateStore).mockImplementation((selector) =>
    selector({
      state: {},
      deviceId: DEVICE_ID,
      isMaster: false,
      claimMaster: vi.fn(),
      applyPatch: vi.fn(),
      init: vi.fn(),
    } as never),
  )
  // The claimed audio-output device, expressed directly on its own Logical Device: one Logical
  // Device providing `audio-playback`, bound to DEVICE_ID - equivalent to the old
  // `deviceClaims[CAPABILITIES.audioPlayback] = DEVICE_ID`.
  vi.mocked(useLogicalDevicesStore).mockImplementation((selector) =>
    selector({
      devices: [
        {
          id: AUDIO_LOGICAL_DEVICE_ID,
          name: 'Audio-Ausgabe',
          capability: CAPABILITIES.audioPlayback,
          pluginId: null,
          executionTarget: DEVICE_ID,
        },
      ],
      loaded: true,
      init: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
    } as never),
  )
  vi.mocked(usePluginsStore).mockImplementation((selector) => selector({ installed: [] } as never))
  vi.mocked(loadLocalTrack).mockResolvedValue({ status: 'ok' })
})

describe('ShowTransportWidget - claimed audio-output device, not the master', () => {
  it('unloads a stale local track when the synced song changes to one with no track at all', () => {
    mockShowMode({
      currentEntry: entry('e1', 'song-b'),
      currentSong: song('song-b', 'A Cappella'),
      currentVariant: variant('v1', 'song-b', []), // no tracks - "Kein Track angehängt"
    })

    render(<ShowTransportWidget />)

    expect(unloadLocalTrack).toHaveBeenCalled()
    expect(loadLocalTrack).not.toHaveBeenCalled()
  })

  it('loads the new local track when the synced song changes to one that has one', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
    })

    render(<ShowTransportWidget />)

    expect(loadLocalTrack).toHaveBeenCalledWith('v2', 't1')
  })

  it('does not reload (and so does not reset/stop) an already-loaded track when someone else merely takes over Master - the song itself hasn\'t changed', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      canControl: true,
    })
    const { rerender } = render(<ShowTransportWidget />)
    expect(loadLocalTrack).toHaveBeenCalledTimes(1)

    // Someone else claims Master - `canControl` flips on this device, same song/track.
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      canControl: false,
    })
    rerender(<ShowTransportWidget />)

    expect(loadLocalTrack).toHaveBeenCalledTimes(1)
  })
})
