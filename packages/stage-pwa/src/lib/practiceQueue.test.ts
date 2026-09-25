import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stopLocalTrack } from './localAudioEngine'
import { practiceAdvanceNext, practiceSetActiveSetlist, practiceSetVariantOverride } from './practiceQueue'
import { usePracticeStateStore } from '../store/usePracticeStateStore'

vi.mock('./localAudioEngine', () => ({
  pauseLocalTrack: vi.fn(),
  playLocalTrack: vi.fn(),
  stopLocalTrack: vi.fn(),
}))
vi.mock('../store/useSetlistsStore', () => ({ useSetlistsStore: { getState: () => ({ setlists: [] }) } }))
vi.mock('../store/useSongsStore', () => ({
  useSongsStore: {
    getState: () => ({
      songs: [
        { id: 's1', title: 'A', bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] },
        { id: 's2', title: 'B', bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] },
      ],
    }),
  },
}))
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
      variantOverride: 'v-acoustic',
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
      variantOverride: null,
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

describe('practiceSetVariantOverride', () => {
  it('switches the variant, drops the track override and stops playback', () => {
    usePracticeStateStore.getState().patch('ws-1', {
      trackOverride: 't1',
      clickExtendMs: 500,
      playbackStatus: 'playing',
      playbackStartedAt: 1,
      playbackAccumulatedMs: 900,
    })

    practiceSetVariantOverride('v-acoustic')

    expect(usePracticeStateStore.getState().get('ws-1')).toMatchObject({
      variantOverride: 'v-acoustic',
      trackOverride: null,
      clickExtendMs: 0,
      playbackStatus: 'stopped',
      playbackAccumulatedMs: 0,
    })
    expect(stopLocalTrack).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the same variant is chosen again (no needless stop)', () => {
    practiceSetVariantOverride('v-acoustic')
    vi.mocked(stopLocalTrack).mockClear()
    usePracticeStateStore.getState().patch('ws-1', { playbackStatus: 'playing' })

    practiceSetVariantOverride('v-acoustic')

    expect(usePracticeStateStore.getState().get('ws-1').playbackStatus).toBe('playing')
    expect(stopLocalTrack).not.toHaveBeenCalled()
  })

  it('is reset when moving on to the next song, like the track override', async () => {
    practiceSetVariantOverride('v-acoustic')

    await practiceAdvanceNext()

    expect(usePracticeStateStore.getState().get('ws-1')).toMatchObject({ activeEntryId: 's2', variantOverride: null })
  })
})
