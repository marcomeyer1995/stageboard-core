import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'

describe('App stays calm while a song plays (PlaybackDrivers)', () => {
  it('calls no hook that re-renders per frame or on a timer - those belong in PlaybackDrivers', () => {
    const ticking = /\b(useShowMode|usePlaybackElapsedMs|usePracticeElapsedMs|useNow|useCueScheduler|useAudioOutputDriver|useClickOutputDriver|useAutoStopDriver|useTrackDurationBackfill|useFootswitch|useSongAlerts|useMasterSelfCheck|useLoopTrainerDriver)\(/
    const hits = appSource.split('\n').filter((line) => ticking.test(line) && !line.trim().startsWith('//'))
    expect(hits).toEqual([])
  })
})
