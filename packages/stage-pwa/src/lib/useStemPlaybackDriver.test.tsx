import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SongVariant, TrackMeta } from 'shared-types'
import { useShowMode } from './showMode'
import { __resetStemMixForTests, useStemMixStore } from './stemMix'
import { loadStems, setStemGains, unloadStems } from './stemEngine'
import { setLocalTrackSilenced } from './localAudioEngine'
import { useStemPlaybackDriver } from './useStemPlaybackDriver'

vi.mock('./showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
vi.mock('./stemEngine', () => ({ loadStems: vi.fn(async () => true), setStemGains: vi.fn(), setStemLevelCurve: vi.fn(), syncStems: vi.fn(), unloadStems: vi.fn() }))
vi.mock('./localAudioEngine', () => ({ setLocalTrackSilenced: vi.fn() }))
vi.mock('./latencyCompensation', () => ({ useAudioOutputLatencyMs: () => 0 }))
vi.mock('./usePracticeElapsedMs', () => ({ practiceElapsedMsNow: () => null }))

const track = (id: string, extra: Partial<TrackMeta> = {}): TrackMeta => ({
  id,
  kind: 'stem',
  label: id,
  source: 'stem-separation',
  parentTrackId: 'mix',
  mimeType: 'audio/webm',
  addedAt: 0,
  ...extra,
})
const VARIANT = { id: 'v1', tracks: [track('mix', { kind: 'band-mix', parentTrackId: null, source: 'upload' }), track('drums'), track('bass')] } as unknown as SongVariant

function mockMode(mode: 'gig' | 'practice') {
  vi.mocked(useShowMode).mockReturnValue({
    mode,
    queue: { currentEntry: { id: 'e1' }, currentVariant: VARIANT },
    elapsedMs: null,
    playbackStatus: 'stopped',
    trackOverride: null,
  } as unknown as ReturnType<typeof useShowMode>)
}

vi.mock('./computeQueue', () => ({ resolveTrackForEntry: () => VARIANT.tracks[0] }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  __resetStemMixForTests()
})

describe('useStemPlaybackDriver (docs/22 §3)', () => {
  it('plays the track through the same engine as the stems, and the stems once switched on', async () => {
    mockMode('practice')
    const { rerender } = renderHook(() => useStemPlaybackDriver())
    await waitFor(() => expect(loadStems).toHaveBeenLastCalledWith('v1', ['mix']))
    await waitFor(() => expect(setLocalTrackSilenced).toHaveBeenLastCalledWith(true))
    expect(setStemGains).toHaveBeenLastCalledWith(new Map([['mix', 1]]))
    act(() => useStemMixStore.getState().setOn('v1', true))
    rerender()
    await waitFor(() => expect(loadStems).toHaveBeenLastCalledWith('v1', ['drums', 'bass']))
  })

  it('leaves Gig mode alone - the element plays there', () => {
    mockMode('gig')
    renderHook(() => useStemPlaybackDriver())
    expect(loadStems).not.toHaveBeenCalled()
    expect(unloadStems).toHaveBeenCalled()
    expect(setLocalTrackSilenced).toHaveBeenLastCalledWith(false)
  })
})
