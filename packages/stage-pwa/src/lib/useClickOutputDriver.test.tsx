import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from 'shared-types'
import type { LogicalDevice, Song } from 'shared-types'
import { useClickOutputDriver } from './useClickOutputDriver'
import { startClick, stopClick } from './clickEngine'
import { useShowMode } from './showMode'
import { useShowStateStore } from '../store/useShowStateStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

// Same reasoning as ClickTrackWidget.test.tsx (which these tests used to live in, before the
// actual startClick/stopClick driving moved out into this always-mounted hook - found live,
// 2026-09-10: switching away from the Live tab used to unmount ClickTrackWidget and silently
// stop the click mid-show). Mock clickEngine.ts since happy-dom (vitest.config.ts) has no real
// AudioContext.
vi.mock('./showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: vi.fn() }))
vi.mock('../store/usePluginsStore', () => ({ usePluginsStore: vi.fn() }))
vi.mock('../store/useLogicalDevicesStore', () => ({ useLogicalDevicesStore: vi.fn() }))
vi.mock('../store/useDeviceTransportConfigStore', () => ({ useDeviceTransportConfigStore: vi.fn() }))
vi.mock('./clickEngine', () => ({ startClick: vi.fn(), stopClick: vi.fn() }))

function song(clickTrackEnabled: boolean): Song {
  return { id: 'song-1', title: 'Test Song', bpm: 120, timeSignature: '4/4', clickTrackEnabled, chordProContent: '', timecodes: [] }
}

function mockShowMode(overrides: {
  mode?: 'gig' | 'practice'
  currentSong: Song | null
  elapsedMs?: number | null
  playbackStatus?: 'playing' | 'paused' | 'stopped'
  clickTrackOverride?: 'on' | 'off' | null
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
    elapsedMs: overrides.elapsedMs ?? 0,
    playbackStatus: overrides.playbackStatus ?? 'playing',
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    setLiveTempoAdjustPercent: vi.fn(),
    clickTrackOverride: overrides.clickTrackOverride ?? null,
    setClickTrackOverride: vi.fn(),
    canControl: true,
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

function DriverHost() {
  useClickOutputDriver()
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useShowStateStore).mockImplementation((selector) =>
    selector({ state: {}, deviceId: DEVICE_ID, isMaster: false, claimMaster: vi.fn(), applyPatch: vi.fn(), init: vi.fn() } as never),
  )
  vi.mocked(usePluginsStore).mockImplementation((selector) => selector({ installed: [] } as never))
  mockLogicalDevices([])
})

describe('useClickOutputDriver', () => {
  it('starts the click engine when this device is the bound output, click is enabled, and the song is playing', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true), elapsedMs: 0, playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).toHaveBeenCalled()
    expect(stopClick).not.toHaveBeenCalled()
  })

  it('does not start the click engine when playback is stopped', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true), elapsedMs: null, playbackStatus: 'stopped' })
    render(<DriverHost />)
    expect(startClick).not.toHaveBeenCalled()
  })

  it('does not start the click engine when the click is off (song default, no override)', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(false), playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).not.toHaveBeenCalled()
  })

  it('does not start the click engine when the bound output is a different tablet', () => {
    mockLogicalDevices([
      {
        id: CLICK_LOGICAL_DEVICE_ID,
        name: 'Klick',
        capability: CAPABILITIES.clickTrack,
        pluginId: null,
        executionTarget: 'some-other-tablet',
      },
    ])
    mockShowMode({ currentSong: song(true), playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).not.toHaveBeenCalled()
  })

  it('does not start the click engine when force-off overrides an on-by-default song', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true), clickTrackOverride: 'off', playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).not.toHaveBeenCalled()
  })

  it('still plays the click in Practice mode, off the song\'s own default', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ mode: 'practice', currentSong: song(true), elapsedMs: 0, playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).toHaveBeenCalled()
  })

  it('plays locally in Practice mode with no Hardware Setup at all - no LogicalDevice bound, and even one bound to a different tablet (Marco, 2026-09-09: practicing solo shouldn\'t require Gig-mode hardware configuration)', () => {
    mockLogicalDevices([]) // no click-track device configured anywhere
    mockShowMode({ mode: 'practice', currentSong: song(true), elapsedMs: 0, playbackStatus: 'playing' })
    const { unmount } = render(<DriverHost />)
    expect(startClick).toHaveBeenCalled()
    unmount()

    vi.mocked(startClick).mockClear()
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: 'some-other-tablet' },
    ])
    mockShowMode({ mode: 'practice', currentSong: song(true), elapsedMs: 0, playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).toHaveBeenCalled()
  })

  it('keeps playing when a widget that merely displays click status unmounts, as long as the driver itself stays mounted (#25 found live, 2026-09-10: same tab-switch bug as the audio-playback path)', () => {
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true), elapsedMs: 0, playbackStatus: 'playing' })

    function Scene({ onLiveTab }: { onLiveTab: boolean }) {
      return (
        <>
          <DriverHost />
          {onLiveTab && <div>Live tab content</div>}
        </>
      )
    }

    const { rerender } = render(<Scene onLiveTab={true} />)
    expect(startClick).toHaveBeenCalledTimes(1)

    rerender(<Scene onLiveTab={false} />)

    expect(stopClick).not.toHaveBeenCalled()
  })
})

describe('page visibility (found live, 2026-09-10: a backgrounded tab still gets occasional throttled ticks, each resyncing and playing one arrhythmic click - true silence needs an explicit stop, not just a cleaner resync)', () => {
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')

  function setPageHidden(hidden: boolean) {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  afterEach(() => {
    if (originalVisibilityState) Object.defineProperty(document, 'visibilityState', originalVisibilityState)
  })

  it('stops the click engine while the tab is hidden and restarts it once visible again', () => {
    setPageHidden(false)
    mockLogicalDevices([
      { id: CLICK_LOGICAL_DEVICE_ID, name: 'Klick', capability: CAPABILITIES.clickTrack, pluginId: null, executionTarget: DEVICE_ID },
    ])
    mockShowMode({ currentSong: song(true), elapsedMs: 0, playbackStatus: 'playing' })
    render(<DriverHost />)
    expect(startClick).toHaveBeenCalledTimes(1)

    setPageHidden(true)
    expect(stopClick).toHaveBeenCalled()

    vi.mocked(startClick).mockClear()
    setPageHidden(false)
    expect(startClick).toHaveBeenCalledTimes(1)
  })
})
