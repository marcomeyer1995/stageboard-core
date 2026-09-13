import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stopClick } from '../lib/clickEngine'
import { unloadLocalTrack } from '../lib/localAudioEngine'
import { useAppModeStore } from './useAppModeStore'

vi.mock('../lib/clickEngine', () => ({ stopClick: vi.fn() }))
vi.mock('../lib/localAudioEngine', () => ({ unloadLocalTrack: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useAppModeStore.setState({ mode: 'gig' })
})

describe('setMode', () => {
  it('stops Practice mode local playback/click when switching to Gig mode', () => {
    useAppModeStore.setState({ mode: 'practice' })
    useAppModeStore.getState().setMode('gig')

    expect(unloadLocalTrack).toHaveBeenCalledTimes(1)
    expect(stopClick).toHaveBeenCalledTimes(1)
    expect(useAppModeStore.getState().mode).toBe('gig')
  })

  it('does nothing extra when switching from Gig to Practice', () => {
    useAppModeStore.getState().setMode('practice')

    expect(unloadLocalTrack).not.toHaveBeenCalled()
    expect(stopClick).not.toHaveBeenCalled()
    expect(useAppModeStore.getState().mode).toBe('practice')
  })

  it('is a no-op cleanup-wise when the mode does not actually change', () => {
    useAppModeStore.setState({ mode: 'practice' })
    useAppModeStore.getState().setMode('practice')

    expect(unloadLocalTrack).not.toHaveBeenCalled()
    expect(stopClick).not.toHaveBeenCalled()
  })
})
