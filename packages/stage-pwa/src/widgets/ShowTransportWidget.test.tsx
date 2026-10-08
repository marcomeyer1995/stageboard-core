import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('../lib/showMode', () => {
  // useShowElapsed (#457) reads the position the test put into the mocked useShowMode value.
  const useShowMode = vi.fn()
  const usePosition = () => (useShowMode() as { elapsedMs?: number | null } | undefined)?.elapsedMs ?? null
  return { useShowMode, useShowElapsed: (select: (ms: number | null) => unknown) => select(usePosition()) }
})
// The widget's measured box; 0 x 0 (unmeasured) gives the roomy layout the older tests expect.
const mockSize = vi.hoisted(() => ({ width: 0, height: 0 }))
vi.mock('../lib/useElementSize', () => ({ useElementSize: () => [() => {}, mockSize] }))
// Its own claim rules (masterTakeover.test.ts) pull in the real PouchDB-backed stores.
vi.mock('../components/MasterTakeoverButton', () => {
  return { MasterTakeoverButton: () => <button type="button">Master übernehmen</button> }
})
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
  useLocalAudioOutputStore.setState({ error: null, audioBlocked: false })
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
  describe('size-dependent layout (PR B, stage GUI audit)', () => {
    afterEach(() => {
      mockSize.width = 0
      mockSize.height = 0
    })

    it('keeps the running time in a flat landscape tile and drops the helper line instead', () => {
      mockSize.width = 600
      mockSize.height = 100
      mockShowMode({ currentSong: song('s1', 'A very long song title that cannot fit'), currentEntry: entry('e1', 's1'), elapsedMs: 83_000 })
      render(<ShowTransportWidget config={{}} />)

      const clock = screen.getByText('01:23')
      expect(clock.className).toContain('tabular-nums')
      expect(parseFloat(clock.style.fontSize)).toBeGreaterThanOrEqual(24)
      expect(screen.getByText('A very long song title that cannot fit').parentElement?.className).toContain('truncate')
      expect(screen.getByText('Play').closest('div')?.className).toContain('grid-cols-4')
    })

    it('puts info and buttons side by side when stacking would squeeze the buttons', () => {
      mockSize.width = 599
      mockSize.height = 73
      mockShowMode({ currentSong: song('s1', 'Song'), currentEntry: entry('e1', 's1'), elapsedMs: 5_000 })
      render(<ShowTransportWidget config={{ titleSizeRatio: 2 }} />)
      const grid = screen.getByText('Play').closest('div') as HTMLElement
      expect(grid.parentElement?.className).toContain('items-stretch')
      expect(grid.parentElement?.className).not.toContain('flex-col')
      expect(screen.getByText('00:05')).toBeInTheDocument()
    })

    it('keeps only the time beside the buttons in a narrow flat tile - the title gives way first', () => {
      mockSize.width = 387
      mockSize.height = 46
      mockShowMode({ currentSong: song('s1', 'Were not gonna take it'), currentEntry: entry('e1', 's1'), elapsedMs: 12_000 })
      render(<ShowTransportWidget config={{}} />)
      expect(screen.getByText('00:12')).toBeInTheDocument()
      expect(screen.getByText('Were not gonna take it').parentElement?.className).toContain('hidden')
      expect((screen.getByLabelText('Play').closest('div') as HTMLElement).parentElement?.className).toContain('items-stretch')
    })

    it('switches to a 2 x 2 button grid when too narrow for four in a row', () => {
      mockSize.width = 300
      mockSize.height = 220
      mockShowMode({ currentSong: song('s1', 'Song'), currentEntry: entry('e1', 's1') })
      render(<ShowTransportWidget config={{}} />)
      expect(screen.getByText('Play').closest('div')?.className).toContain('grid-cols-2')
    })
  })

  it('shows "Kein Song aktiv" when there is no current entry', () => {
    mockShowMode({ currentSong: null })
    render(<ShowTransportWidget config={{}} />)
    expect(screen.getByText('Kein Song aktiv')).toBeInTheDocument()
  })

  it('shows a negative countdown while a count-in is running (#25 follow-up), not malformed output', () => {
    mockShowMode({
      currentSong: song('s1', 'Sweet Home Chicago'),
      currentEntry: entry('e1', 's1'),
      currentVariant: variant('v1', 's1'),
      elapsedMs: -1500,
    })
    render(<ShowTransportWidget config={{}} />)
    expect(screen.getByText('-00:01')).toBeInTheDocument()
  })

  it('offers to claim Master instead of transport controls when this device has no control', () => {
    mockShowMode({ currentSong: song('s1', 'Sweet Home Chicago'), canControl: false })
    render(<ShowTransportWidget config={{}} />)
    expect(screen.getByText('Master übernehmen')).toBeInTheDocument()
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
  })

  it('calls play() and forwards to the resolved plugin on Play, when no device claims local output', () => {
    const { play } = mockShowMode({
      currentSong: song('s1', 'Sweet Home Chicago'),
      currentEntry: entry('e1', 's1'),
      currentVariant: variant('v1', 's1'),
    })
    render(<ShowTransportWidget config={{}} />)

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
    render(<ShowTransportWidget config={{}} />)

    expect(screen.getByText('Kein Track angehängt')).toBeInTheDocument()
  })

  it('shows the local-output driver error (useAudioOutputDriver.ts) when set', () => {
    useLocalAudioOutputStore.setState({ error: 'Kein Track gefunden' })
    mockShowMode({ currentSong: song('s1', 'Sweet Home Chicago') })
    render(<ShowTransportWidget config={{}} />)

    expect(screen.getByText('Kein Track gefunden')).toBeInTheDocument()
  })
})
