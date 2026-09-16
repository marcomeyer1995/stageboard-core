import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioResumeOverlay } from './AudioResumeOverlay'
import { playLocalTrack } from '../lib/localAudioEngine'
import { useShowMode } from '../lib/showMode'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'

vi.mock('../lib/localAudioEngine', () => ({ playLocalTrack: vi.fn() }))
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useLocalAudioOutputStore.setState({ error: null, audioBlocked: false })
  vi.mocked(useShowMode).mockReturnValue({ elapsedMs: 0 } as never)
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

  it('retries playLocalTrack at the current position and dismisses itself on a successful tap', async () => {
    useLocalAudioOutputStore.setState({ audioBlocked: true })
    vi.mocked(useShowMode).mockReturnValue({ elapsedMs: 4200 } as never)
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
