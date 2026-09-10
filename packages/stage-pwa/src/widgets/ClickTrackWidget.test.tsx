import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from 'shared-types'
import type { LogicalDevice, Song } from 'shared-types'
import { ClickTrackWidget } from './ClickTrackWidget'
import { useShowMode } from '../lib/showMode'
import { useShowStateStore } from '../store/useShowStateStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

// Same reasoning as ShowTransportWidget.test.tsx: mock the stores directly, since several
// transitively construct a real PouchDB at import time. Actually driving the click engine
// (startClick/stopClick) no longer happens in this widget - see useClickOutputDriver.test.ts,
// which owns that behavior now (found live, 2026-09-10: switching away from the Live tab used to
// unmount this widget and silently stop the click mid-show).
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: vi.fn() }))
vi.mock('../store/usePluginsStore', () => ({ usePluginsStore: vi.fn() }))
vi.mock('../store/useLogicalDevicesStore', () => ({ useLogicalDevicesStore: vi.fn() }))
vi.mock('../store/useDeviceTransportConfigStore', () => ({ useDeviceTransportConfigStore: vi.fn() }))

function song(clickTrackEnabled: boolean): Song {
  return { id: 'song-1', title: 'Test Song', bpm: 120, timeSignature: '4/4', clickTrackEnabled, chordProContent: '', timecodes: [] }
}

function mockShowMode(overrides: {
  mode?: 'gig' | 'practice'
  currentSong: Song | null
  clickTrackOverride?: 'on' | 'off' | null
  setClickTrackOverride?: (override: 'on' | 'off' | null) => void
  canControl?: boolean
}) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: overrides.mode ?? 'gig',
    queue: {
      activeSetlist: null,
      orderedItems: [],
      orderedSongs: [],
      previousSong: null,
      currentSong: overrides.currentSong,
      nextSong: null,
      previousEntry: null,
      currentEntry: null,
      nextEntry: null,
      previousVariant: null,
      currentVariant: null,
      nextVariant: null,
    },
    elapsedMs: 0,
    playbackStatus: 'playing',
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    setLiveTempoAdjustPercent: vi.fn(),
    clickTrackOverride: overrides.clickTrackOverride ?? null,
    setClickTrackOverride: overrides.setClickTrackOverride ?? vi.fn(),
    canControl: overrides.canControl ?? true,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setTrackOverride: vi.fn(),
  } as never)
}

const DEVICE_ID = 'laptop-device'
const CLICK_LOGICAL_DEVICE_ID = 'click-output'

function mockLogicalDevices(devices: LogicalDevice[]) {
  vi.mocked(useLogicalDevicesStore).mockImplementation((selector) =>
    selector({ devices, loaded: true, init: vi.fn(), save: vi.fn(), remove: vi.fn() } as never),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useShowStateStore).mockImplementation((selector) =>
    selector({ state: {}, deviceId: DEVICE_ID, isMaster: false, claimMaster: vi.fn(), applyPatch: vi.fn(), init: vi.fn() } as never),
  )
  vi.mocked(usePluginsStore).mockImplementation((selector) => selector({ installed: [] } as never))
  mockLogicalDevices([])
})

describe('ClickTrackWidget', () => {
  it('shows a placeholder when no device is bound as the click output', () => {
    mockShowMode({ currentSong: song(true) })
    render(<ClickTrackWidget />)
    expect(screen.getByText('Kein Klick-Ausgabegerät eingerichtet')).toBeInTheDocument()
  })

  it('shows the effective on/off state once a device is bound', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true) })
    const { container } = render(<ClickTrackWidget />)
    expect(container.querySelector('span.text-xl')).toHaveTextContent('An')
    expect(screen.getByText('Klick · dieses Gerät')).toBeInTheDocument()
  })

  it('reflects the song default of off when there is no override', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(false) })
    const { container } = render(<ClickTrackWidget />)
    expect(container.querySelector('span.text-xl')).toHaveTextContent('Aus')
  })

  it('force-off overrides an on-by-default song', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true), clickTrackOverride: 'off' })
    const { container } = render(<ClickTrackWidget />)
    expect(container.querySelector('span.text-xl')).toHaveTextContent('Aus')
  })

  it('lets the Master change the override, disables the buttons for a non-Master device', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    const setClickTrackOverride = vi.fn()
    mockShowMode({ currentSong: song(true), setClickTrackOverride, canControl: true })
    const { rerender } = render(<ClickTrackWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Aus' }))
    expect(setClickTrackOverride).toHaveBeenCalledWith('off')

    setClickTrackOverride.mockClear()
    mockShowMode({ currentSong: song(true), setClickTrackOverride, canControl: false })
    rerender(<ClickTrackWidget />)
    expect(screen.getByRole('button', { name: 'Aus' })).toBeDisabled()
  })

  it('lets the override be changed in Practice mode too - a local, ungated per-device choice, not the Gig-mode Master-gated write (found live, 2026-09-09: this widget rendered the buttons in both modes, but useShowMode\'s Practice branch stubbed the setter to a no-op, so training with a fixed click silently didn\'t work)', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    const setClickTrackOverride = vi.fn()
    mockShowMode({ mode: 'practice', currentSong: song(true), setClickTrackOverride, canControl: true })
    render(<ClickTrackWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Aus' }))
    expect(setClickTrackOverride).toHaveBeenCalledWith('off')
  })

  it('shows no placeholder in Practice mode with no Hardware Setup at all - no LogicalDevice bound (Marco, 2026-09-09: practicing solo shouldn\'t require Gig-mode hardware configuration)', () => {
    mockLogicalDevices([]) // no click-track device configured anywhere
    mockShowMode({ mode: 'practice', currentSong: song(true) })
    render(<ClickTrackWidget />)
    expect(screen.queryByText('Kein Klick-Ausgabegerät eingerichtet')).not.toBeInTheDocument()
  })
})
