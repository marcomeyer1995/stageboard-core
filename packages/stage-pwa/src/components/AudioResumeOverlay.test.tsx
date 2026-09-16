import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShowState } from 'shared-types'
import { AudioResumeOverlay } from './AudioResumeOverlay'
import { getServerTime } from '../lib/clockSync'
import { playLocalTrack } from '../lib/localAudioEngine'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { useShowStateStore } from '../store/useShowStateStore'

vi.mock('../lib/localAudioEngine', () => ({ playLocalTrack: vi.fn() }))
vi.mock('../lib/clockSync', () => ({ getServerTime: vi.fn() }))
// Deliberately not useShowMode/useQueue - the whole point of this rewrite (found live,
// 2026-09-16: the button needed up to 5 taps) was to stop reading the ticking elapsedMs
// reactively, so this only ever reads ShowState imperatively at tap-time via getState().
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: { getState: vi.fn() } }))

function showState(overrides: Partial<ShowState>): { state: ShowState } {
  return { state: { playbackStatus: 'stopped', playbackStartedAt: null, playbackAccumulatedMs: 0, ...overrides } as ShowState }
}

beforeEach(() => {
  vi.clearAllMocks()
  useLocalAudioOutputStore.setState({ error: null, audioBlocked: false })
  vi.mocked(useShowStateStore.getState).mockReturnValue(showState({}) as never)
  vi.mocked(getServerTime).mockReturnValue(0)
  vi.mocked(playLocalTrack).mockResolvedValue({ status: 'ok' })
})

describe('AudioResumeOverlay', () => {
  it('renders nothing while audio is not blocked', () => {
    render(<AudioResumeOverlay />)
    expect(screen.queryByText('Antippen zum Fortsetzen')).not.toBeInTheDocument()
  })

  it('blocks the screen with a tap-to-resume control once audio is blocked', () => {
    useLocalAudioOutputStore.setState({ audioBlocked: true })
    render(<AudioResumeOverlay />)
    expect(screen.getByText('Antippen zum Fortsetzen')).toBeInTheDocument()
  })

  it('reads the current elapsed position imperatively at tap-time and retries playLocalTrack with it', async () => {
    useLocalAudioOutputStore.setState({ audioBlocked: true })
    vi.mocked(useShowStateStore.getState).mockReturnValue(
      showState({ playbackStatus: 'playing', playbackStartedAt: 800, playbackAccumulatedMs: 0 }) as never,
    )
    vi.mocked(getServerTime).mockReturnValue(5000)
    render(<AudioResumeOverlay />)

    fireEvent.click(screen.getByText('Antippen zum Fortsetzen'))

    expect(playLocalTrack).toHaveBeenCalledWith(4200)
    await waitFor(() => expect(useLocalAudioOutputStore.getState().audioBlocked).toBe(false))
  })

  it('stays up if the retry itself is still blocked', async () => {
    useLocalAudioOutputStore.setState({ audioBlocked: true })
    vi.mocked(playLocalTrack).mockResolvedValue({ status: 'error', message: 'blocked' })
    render(<AudioResumeOverlay />)

    fireEvent.click(screen.getByText('Antippen zum Fortsetzen'))

    await waitFor(() => expect(playLocalTrack).toHaveBeenCalledTimes(1))
    expect(useLocalAudioOutputStore.getState().audioBlocked).toBe(true)
  })
})
