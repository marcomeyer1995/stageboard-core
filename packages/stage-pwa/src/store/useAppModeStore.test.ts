import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stopClick } from '../lib/clickEngine'
import { unloadLocalTrack } from '../lib/localAudioEngine'
import { practiceResetSong } from '../lib/practiceQueue'
import { useAppModeStore } from './useAppModeStore'

vi.mock('../lib/clickEngine', () => ({ stopClick: vi.fn() }))
vi.mock('../lib/localAudioEngine', () => ({ unloadLocalTrack: vi.fn() }))
vi.mock('../lib/practiceQueue', () => ({ practiceResetSong: vi.fn() }))

// useShowStateStore transitively imports showStateDb.ts, which instantiates a real PouchDB at
// module load - not viable in this test environment (same reason ShowTransportWidget.test.tsx
// mocks it). Module-mocked here purely for its `getState().state.playbackStatus` read.
const showStateGetState = vi.fn()
vi.mock('./useShowStateStore', () => ({ useShowStateStore: { getState: () => showStateGetState() } }))

const workspaceGetState = vi.fn()
vi.mock('./useWorkspaceStore', () => ({ useWorkspaceStore: { getState: () => workspaceGetState() } }))

const practiceGetState = vi.fn()
vi.mock('./usePracticeStateStore', () => ({ usePracticeStateStore: { getState: () => practiceGetState() } }))

beforeEach(() => {
  vi.clearAllMocks()
  useAppModeStore.setState({ mode: 'gig' })
  showStateGetState.mockReturnValue({ state: { playbackStatus: 'stopped' } })
  workspaceGetState.mockReturnValue({ activeWorkspaceId: 'ws-1' })
  practiceGetState.mockReturnValue({ get: () => ({ playbackStatus: 'stopped' }) })
})

describe('setMode', () => {
  it('stops Practice mode local playback/click when switching to Gig mode', () => {
    useAppModeStore.setState({ mode: 'practice' })
    useAppModeStore.getState().setMode('gig')

    expect(practiceResetSong).toHaveBeenCalledTimes(1)
    expect(unloadLocalTrack).toHaveBeenCalledTimes(1)
    expect(stopClick).toHaveBeenCalledTimes(1)
    expect(useAppModeStore.getState().mode).toBe('gig')
  })

  it('does nothing extra when switching from Gig to Practice', () => {
    useAppModeStore.getState().setMode('practice')

    expect(practiceResetSong).not.toHaveBeenCalled()
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

  it('refuses to switch out of Gig mode while a song is playing there', () => {
    showStateGetState.mockReturnValue({ state: { playbackStatus: 'playing' } })

    const switched = useAppModeStore.getState().setMode('practice')

    expect(switched).toBe(false)
    expect(useAppModeStore.getState().mode).toBe('gig')
  })

  it('switches out of Practice mode while a song is playing there, force-stopping and rearming it (#233)', () => {
    useAppModeStore.setState({ mode: 'practice' })
    practiceGetState.mockReturnValue({ get: () => ({ playbackStatus: 'playing' }) })

    const switched = useAppModeStore.getState().setMode('gig')

    expect(switched).toBe(true)
    expect(useAppModeStore.getState().mode).toBe('gig')
    expect(practiceResetSong).toHaveBeenCalledTimes(1)
    expect(unloadLocalTrack).toHaveBeenCalledTimes(1)
    expect(stopClick).toHaveBeenCalledTimes(1)
  })

  it('allows switching once Gig playback is no longer "playing"', () => {
    showStateGetState.mockReturnValue({ state: { playbackStatus: 'paused' } })

    const switched = useAppModeStore.getState().setMode('practice')

    expect(switched).toBe(true)
    expect(useAppModeStore.getState().mode).toBe('practice')
  })

  it("only checks the mode being left, not the destination mode's playback state", () => {
    // Gig's ShowState is playing, Practice's own echo is not - switching gig -> practice from Gig
    // mode should still be refused by Gig's own playing state, not Practice's unrelated one.
    showStateGetState.mockReturnValue({ state: { playbackStatus: 'playing' } })
    practiceGetState.mockReturnValue({ get: () => ({ playbackStatus: 'stopped' }) })

    const switched = useAppModeStore.getState().setMode('practice')

    expect(switched).toBe(false)
  })
})
