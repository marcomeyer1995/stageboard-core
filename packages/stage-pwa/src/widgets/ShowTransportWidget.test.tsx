import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from 'shared-types'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import { ShowTransportWidget } from './ShowTransportWidget'
import { useShowMode } from '../lib/showMode'
import { triggerShowControl } from '../lib/showControlClient'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

// Same explicit-factory reasoning as useAudioOutputDriver.test.ts (which now owns the reactive
// local-engine-driving behavior this widget used to run itself - see its own doc comment).
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../lib/showControlClient', () => ({ triggerShowControl: vi.fn() }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: vi.fn() }))
vi.mock('../store/usePluginsStore', () => ({ usePluginsStore: vi.fn() }))
vi.mock('../store/useLogicalDevicesStore', () => ({ useLogicalDevicesStore: vi.fn() }))
vi.mock('../store/useDeviceTransportConfigStore', () => ({ useDeviceTransportConfigStore: vi.fn() }))

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}

function variant(id: string, songId: string): SongVariant {
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
    tracks: [],
    cues: [],
    beatAnchors: [],
    countInEnabled: false,
    countInBars: 1,
  }
}

function entry(id: string, songId: string): SetlistEntry {
  return { id, songId, variantId: null, trackId: null }
}

const DEVICE_ID = 'laptop-device'

function mockShowMode(overrides: {
  currentSong: Song | null
  currentEntry?: SetlistEntry | null
  currentVariant?: SongVariant | null
  canControl?: boolean
  elapsedMs?: number | null
}) {
  const play = vi.fn()
  const pause = vi.fn()
  const stop = vi.fn()
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
      currentEntry: overrides.currentEntry ?? null,
      nextEntry: null,
      previousVariant: null,
      currentVariant: overrides.currentVariant ?? null,
      nextVariant: null,
    },
    elapsedMs: overrides.elapsedMs ?? 0,
    playbackStatus: 'stopped',
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    setLiveTempoAdjustPercent: vi.fn(),
    nudgeLiveTempoAdjustPercent: vi.fn(),
    clickTrackOverride: null,
    setClickTrackOverride: vi.fn(),
    canControl: overrides.canControl ?? true,
    play,
    pause,
    stop,
    reset: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setTrackOverride: vi.fn(),
  } as never)
  return { play, pause, stop }
}

// No Logical Device claims audio-playback by default - `engine` resolves via whichever plugin
// `pluginProviding` finds installed, not `local-mine`, so button clicks forward to the plugin.
function mockNoAudioClaim() {
  vi.mocked(useLogicalDevicesStore).mockImplementation((selector) =>
    selector({ devices: [], loaded: true, init: vi.fn(), save: vi.fn(), remove: vi.fn() } as never),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useLocalAudioOutputStore.setState({ error: null })
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
  mockNoAudioClaim()
  vi.mocked(usePluginsStore).mockImplementation((selector) =>
    selector({
      installed: [{ id: 'mock-playback', capabilities: [CAPABILITIES.audioPlayback], enabled: true }],
    } as never),
  )
  vi.mocked(triggerShowControl).mockResolvedValue({ status: 'ok' })
})

describe('ShowTransportWidget', () => {
  it('shows "Kein Song aktiv" when there is no current entry', () => {
    mockShowMode({ currentSong: null })
    render(<ShowTransportWidget />)
    expect(screen.getByText('Kein Song aktiv')).toBeInTheDocument()
  })

  it('shows a negative countdown while a count-in is running (#25 follow-up), not malformed output', () => {
    mockShowMode({
      currentSong: song('s1', 'Sweet Home Chicago'),
      currentEntry: entry('e1', 's1'),
      currentVariant: variant('v1', 's1'),
      elapsedMs: -1500,
    })
    render(<ShowTransportWidget />)
    expect(screen.getByText('-00:01')).toBeInTheDocument()
  })

  it('offers to claim Master instead of transport controls when this device has no control', () => {
    mockShowMode({ currentSong: song('s1', 'Sweet Home Chicago'), canControl: false })
    render(<ShowTransportWidget />)
    expect(screen.getByText('Master übernehmen')).toBeInTheDocument()
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
  })

  it('calls play() and forwards to the resolved plugin on Play, when no device claims local output', () => {
    const { play } = mockShowMode({
      currentSong: song('s1', 'Sweet Home Chicago'),
      currentEntry: entry('e1', 's1'),
      currentVariant: variant('v1', 's1'),
    })
    render(<ShowTransportWidget />)

    fireEvent.click(screen.getByText('Play'))

    expect(play).toHaveBeenCalledTimes(1)
    expect(triggerShowControl).toHaveBeenCalledWith('mock-playback', { type: 'play' })
  })

  it('shows "Kein Track angehängt" for a trackless song when this device is the claimed local output', () => {
    vi.mocked(useLogicalDevicesStore).mockImplementation((selector) =>
      selector({
        devices: [
          { id: 'audio-output', name: 'Audio-Ausgabe', capability: CAPABILITIES.audioPlayback, pluginId: null, executionTarget: DEVICE_ID },
        ],
        loaded: true,
        init: vi.fn(),
        save: vi.fn(),
        remove: vi.fn(),
      } as never),
    )
    mockShowMode({
      currentSong: song('s1', 'A Cappella'),
      currentEntry: entry('e1', 's1'),
      currentVariant: variant('v1', 's1'),
    })
    render(<ShowTransportWidget />)

    expect(screen.getByText('Kein Track angehängt')).toBeInTheDocument()
  })

  it('shows the local-output driver error (useAudioOutputDriver.ts) when set', () => {
    useLocalAudioOutputStore.setState({ error: 'Kein Track gefunden' })
    mockShowMode({ currentSong: song('s1', 'Sweet Home Chicago') })
    render(<ShowTransportWidget />)

    expect(screen.getByText('Kein Track gefunden')).toBeInTheDocument()
  })
})
