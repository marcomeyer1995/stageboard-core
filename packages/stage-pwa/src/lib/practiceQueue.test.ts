import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stopLocalTrack } from './localAudioEngine'
import { practiceSetActiveSetlist } from './practiceQueue'
import { usePracticeStateStore } from '../store/usePracticeStateStore'

vi.mock('./localAudioEngine', () => ({
  pauseLocalTrack: vi.fn(),
  playLocalTrack: vi.fn(),
  stopLocalTrack: vi.fn(),
}))
vi.mock('../store/useSetlistsStore', () => ({ useSetlistsStore: { getState: () => ({ setlists: [] }) } }))
vi.mock('../store/useSongsStore', () => ({ useSongsStore: { getState: () => ({ songs: [] }) } }))
vi.mock('../store/useSongVariantsStore', () => ({ useSongVariantsStore: { getState: () => ({ variants: [] }) } }))
vi.mock('../store/useWorkspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ activeWorkspaceId: 'ws-1' }) } }))

beforeEach(() => {
  vi.clearAllMocks()
  usePracticeStateStore.setState({ byWorkspace: {} })
})

describe('practiceSetActiveSetlist', () => {
  it('selects the setlist, resets position/overrides and stops playback', () => {
    usePracticeStateStore.getState().patch('ws-1', {
      activeEntryId: 'e1',
      trackOverride: 't1',
      clickTrackOverride: 'on',
      clickExtendMs: 500,
      playbackStatus: 'playing',
      playbackStartedAt: 1,
      playbackAccumulatedMs: 900,
    })

    practiceSetActiveSetlist('sl-1')

    expect(usePracticeStateStore.getState().get('ws-1')).toMatchObject({
      activeSetlistId: 'sl-1',
      activeEntryId: null,
      trackOverride: null,
      clickTrackOverride: null,
      clickExtendMs: 0,
      playbackStatus: 'stopped',
      playbackAccumulatedMs: 0,
    })
    expect(stopLocalTrack).toHaveBeenCalledTimes(1)
  })

  it('null falls back to the whole catalog', () => {
    practiceSetActiveSetlist('sl-1')
    practiceSetActiveSetlist(null)
    expect(usePracticeStateStore.getState().get('ws-1').activeSetlistId).toBeNull()
  })
})
