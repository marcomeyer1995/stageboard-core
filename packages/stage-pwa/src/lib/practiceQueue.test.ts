import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stopLocalTrack } from './localAudioEngine'
import { practiceAdvanceNext, practiceBeginLoop, practiceEndLoop, practicePauseSong, practiceSetActiveSetlist, practiceSetVariantOverride, practiceStopSong, practiceStopSongAtTrackEnd } from './practiceQueue'
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
const practiceLog = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('../store/usePracticeLogStore', () => ({ usePracticeLogStore: { getState: () => practiceLog } }))
vi.mock('../store/useActiveProfileStore', () => ({ useActiveProfileStore: { getState: () => ({ byWorkspace: { 'ws-1': 'p-me' } }) } }))

beforeEach(() => {
  vi.clearAllMocks()
  usePracticeStateStore.setState({ byWorkspace: {} })
})

describe('"Beendet" (#27)', () => {
  const state = () => usePracticeStateStore.getState().byWorkspace['ws-1']
  it('is set when the track ran out by itself and cleared by the next transport change', async () => {
    await practiceStopSongAtTrackEnd()
    expect(state()).toMatchObject({ playbackStatus: 'stopped', trackEnded: true })
    expect(stopLocalTrack).toHaveBeenCalled()
    await practicePauseSong()
    await practiceStopSong()
    expect(state()?.trackEnded).toBe(false)
  })

  it('a plain Stop is never "Beendet"', async () => {
    await practiceStopSong()
    expect(state()?.trackEnded).toBe(false)
  })
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

describe('practice log (Solo Üben, "Geübt" / "30 Tage")', () => {
  const ran = (ms: number) =>
    usePracticeStateStore.setState({
      byWorkspace: { 'ws-1': { ...usePracticeStateStore.getState().get('ws-1'), activeEntryId: 's1', playbackStatus: 'paused', playbackStartedAt: null, playbackAccumulatedMs: ms } },
    })

  it('records a take of the own profile when a song that really ran (20 s+) is stopped or left', async () => {
    ran(95_000)
    await practiceStopSong()
    expect(practiceLog.add).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'p-me', songId: 's1', activeMs: 95_000 }))
    ran(60_000)
    await practiceAdvanceNext()
    expect(practiceLog.add).toHaveBeenCalledTimes(2)
  })

  it('does not record a short check of the start', async () => {
    ran(8_000)
    await practiceStopSong()
    expect(practiceLog.add).not.toHaveBeenCalled()
  })

  it('a loop counts the time it played, not where it sits in the song (#430 review)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      ran(0)
      practiceBeginLoop(150_000)
      vi.setSystemTime(1_003_000)
      practiceEndLoop(152_000)
      await practiceStopSong()
      expect(practiceLog.add).not.toHaveBeenCalled()

      ran(30_000)
      practiceBeginLoop(150_000)
      vi.setSystemTime(1_028_000)
      practiceEndLoop(160_000)
      await practiceStopSong()
      expect(practiceLog.add).toHaveBeenCalledWith(expect.objectContaining({ activeMs: 55_000 }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('switching the variant ends the take like leaving the song', () => {
    ran(95_000)
    practiceSetVariantOverride('v-acoustic')
    expect(practiceLog.add).toHaveBeenCalledWith(expect.objectContaining({ songId: 's1', activeMs: 95_000 }))
  })
})
