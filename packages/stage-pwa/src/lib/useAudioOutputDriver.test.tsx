import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from 'shared-types'
import type { SetlistEntry, Song, SongVariant, TrackMeta } from 'shared-types'
import { useAudioOutputDriver } from './useAudioOutputDriver'
import { useShowMode } from './showMode'
import { loadLocalTrack, playLocalTrack, stopLocalTrack, syncLocalTrackPosition, unloadLocalTrack } from './localAudioEngine'
import { useShowStateStore } from '../store/useShowStateStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { ShowTransportWidget } from '../widgets/ShowTransportWidget'

// Same explicit-factory reasoning as ShowTransportWidget.test.tsx (which this file's tests used
// to live in, before #13's local-engine-driving logic moved out into this always-mounted hook -
// found live, 2026-09-10: switching away from the Live tab used to unmount ShowTransportWidget
// and silently stop a live show's backing track mid-song).
vi.mock('./showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: vi.fn() }))
vi.mock('../store/usePluginsStore', () => ({ usePluginsStore: vi.fn() }))
vi.mock('../store/useLogicalDevicesStore', () => ({ useLogicalDevicesStore: vi.fn() }))
vi.mock('../store/useDeviceTransportConfigStore', () => ({ useDeviceTransportConfigStore: vi.fn() }))
vi.mock('./localAudioEngine', () => ({
  loadLocalTrack: vi.fn(),
  playLocalTrack: vi.fn(),
  pauseLocalTrack: vi.fn(),
  stopLocalTrack: vi.fn(),
  syncLocalTrackPosition: vi.fn(),
  unloadLocalTrack: vi.fn(),
}))

function track(id: string): TrackMeta {
  return { id, kind: 'band-mix', label: 'Band', source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 0 }
}

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
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
  playbackStatus?: 'stopped' | 'playing' | 'paused'
  elapsedMs?: number | null
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
    elapsedMs: overrides.elapsedMs ?? 0,
    playbackStatus: overrides.playbackStatus ?? 'stopped',
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    setLiveTempoAdjustPercent: vi.fn(),
    nudgeLiveTempoAdjustPercent: vi.fn(),
    clickTrackOverride: null,
    setClickTrackOverride: vi.fn(),
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

function DriverHost() {
  useAudioOutputDriver()
  return null
}

function mockLogicalDevices(devices: unknown[]) {
  vi.mocked(useLogicalDevicesStore).mockImplementation((selector) =>
    selector({ devices, loaded: true, init: vi.fn(), save: vi.fn(), remove: vi.fn() } as never),
  )
}

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
  // Device providing `audio-playback`, bound to DEVICE_ID.
  mockLogicalDevices([
    {
      id: AUDIO_LOGICAL_DEVICE_ID,
      name: 'Audio-Ausgabe',
      capability: CAPABILITIES.audioPlayback,
      pluginId: null,
      executionTarget: DEVICE_ID,
    },
  ])
  vi.mocked(usePluginsStore).mockImplementation((selector) => selector({ installed: [] } as never))
  vi.mocked(loadLocalTrack).mockResolvedValue({ status: 'ok' })
})

describe('useAudioOutputDriver - claimed audio-output device, not the master', () => {
  it('unloads a stale local track when the synced song changes to one with no track at all', () => {
    mockShowMode({
      currentEntry: entry('e1', 'song-b'),
      currentSong: song('song-b', 'A Cappella'),
      currentVariant: variant('v1', 'song-b', []), // no tracks - "Kein Track angehängt"
    })

    render(<DriverHost />)

    expect(unloadLocalTrack).toHaveBeenCalled()
    expect(loadLocalTrack).not.toHaveBeenCalled()
  })

  it('loads the new local track when the synced song changes to one that has one', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
    })

    render(<DriverHost />)

    expect(loadLocalTrack).toHaveBeenCalledWith('v2', 't1', 0)
  })

  it('does not reload (and so does not reset/stop) an already-loaded track when someone else merely takes over Master - the song itself hasn\'t changed', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      canControl: true,
    })
    const { rerender } = render(<DriverHost />)
    expect(loadLocalTrack).toHaveBeenCalledTimes(1)

    // Someone else claims Master - `canControl` flips on this device, same song/track.
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      canControl: false,
    })
    rerender(<DriverHost />)

    expect(loadLocalTrack).toHaveBeenCalledTimes(1)
  })
})

describe('continuous drift correction (#13 found live, 2026-09-10: the backing track had no ongoing synchronization with the synced master clock at all once started)', () => {
  it('re-syncs to the current elapsedMs on every tick while playing and the claimed output', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      playbackStatus: 'playing',
      elapsedMs: 1000,
    })
    const { rerender } = render(<DriverHost />)
    expect(syncLocalTrackPosition).toHaveBeenLastCalledWith(1000)

    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      playbackStatus: 'playing',
      elapsedMs: 1050, // the next animation-frame tick
    })
    rerender(<DriverHost />)
    expect(syncLocalTrackPosition).toHaveBeenLastCalledWith(1050)
  })

  it('never syncs while paused/stopped - only actual playback should be re-anchored', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      playbackStatus: 'paused',
      elapsedMs: 1000,
    })
    render(<DriverHost />)
    expect(syncLocalTrackPosition).not.toHaveBeenCalled()
  })

  it('never syncs when this device is not the claimed output', () => {
    mockLogicalDevices([]) // no device claims audio-playback at all
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      playbackStatus: 'playing',
      elapsedMs: 1000,
    })
    render(<DriverHost />)
    expect(syncLocalTrackPosition).not.toHaveBeenCalled()
  })
})

describe('surviving a top-level tab switch (Live -> Bibliothek/System, #13/#25 found live 2026-09-10)', () => {
  it('keeps playing when a widget that merely displays local-output status unmounts, as long as the driver itself stays mounted', () => {
    mockShowMode({
      currentEntry: entry('e2', 'song-a'),
      currentSong: song('song-a', 'Sweet Home Chicago'),
      currentVariant: variant('v2', 'song-a', [track('t1')]),
      playbackStatus: 'playing',
    })

    // App.tsx mounts the driver unconditionally, alongside {mode === 'live' && <Dashboard />}
    // which is what actually unmounts ShowTransportWidget on a tab switch (App.tsx).
    function Scene({ onLiveTab }: { onLiveTab: boolean }) {
      return (
        <>
          <DriverHost />
          {onLiveTab && <ShowTransportWidget />}
        </>
      )
    }

    const { rerender } = render(<Scene onLiveTab={true} />)
    expect(playLocalTrack).toHaveBeenCalledTimes(1)

    // Switching to Bibliothek/System - ShowTransportWidget unmounts, the driver does not.
    rerender(<Scene onLiveTab={false} />)

    expect(stopLocalTrack).not.toHaveBeenCalled()
  })
})
