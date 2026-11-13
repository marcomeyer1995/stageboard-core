import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalDevice, ShowCue } from 'shared-types'
// workspaceDb.ts constructs a real PouchDB at module load time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const kemper: LogicalDevice = { id: 'ld-kemper', name: 'Kemper', capability: 'kemper-control', pluginId: null, executionTarget: 'me' } as LogicalDevice
const cues: ShowCue[] = [
  { id: 'verse', timeMs: 0, type: 'kemper.selectRig', targetLogicalDeviceId: 'ld-kemper', payload: { performance: 1, slot: 1 } },
  { id: 'chorus', timeMs: 4_000, type: 'kemper.selectRig', targetLogicalDeviceId: 'ld-kemper', payload: { performance: 1, slot: 2 } },
  { id: 'solo', timeMs: 8_000, type: 'kemper.selectRig', targetLogicalDeviceId: 'ld-kemper', payload: { performance: 1, slot: 3 } },
]

const world = vi.hoisted(() => ({ mode: 'practice' as 'gig' | 'practice', devices: null as unknown, fireCue: vi.fn() }))
vi.mock('./showMode', () => ({
  useShowModeSong: () => ({ mode: world.mode, queue: { currentVariant: { id: 'v1', cues }, currentSong: { id: 's1', title: 'Song' } } }),
}))
vi.mock('./usePracticeRoute', () => ({ usePracticeDevices: () => world.devices }))
vi.mock('./cueFiring', () => ({ fireCue: world.fireCue }))

import { useCueScheduler } from './useCueScheduler'
import { usePracticeStateStore } from '../store/usePracticeStateStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

const patch = (state: Parameters<ReturnType<typeof usePracticeStateStore.getState>['patch']>[1]) =>
  act(() => usePracticeStateStore.getState().patch(useWorkspaceStore.getState().activeWorkspaceId, state))
const play = (accumulatedMs: number) => patch({ playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: accumulatedMs })
const sent = () => world.fireCue.mock.calls.map(([cue, ctx]) => `${(cue as ShowCue).id}${(ctx as { timing?: unknown }).timing ? '' : ' (chase)'}`)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  world.mode = 'practice'
  world.devices = [kemper]
  world.fireCue.mockReset().mockResolvedValue({ target: 'Kemper', ok: true })
})

afterEach(() => {
  patch({ playbackStatus: 'stopped', playbackStartedAt: null, playbackAccumulatedMs: 0, playbackJump: null })
  vi.useRealTimers()
})

describe('cues while practising (#799 step 4)', () => {
  it('without a practice setup nothing is sent', () => {
    world.devices = null
    renderHook(() => useCueScheduler())
    play(0)
    act(() => void vi.advanceTimersByTime(5_000))
    expect(world.fireCue).not.toHaveBeenCalled()
  })

  it('by a setup: the cues go out on the practice clock, never as server cues, never into the Nachbericht', async () => {
    const append = vi.spyOn(useShowLogStore.getState(), 'append')
    renderHook(() => useCueScheduler())
    play(0)
    expect(sent()).toEqual(['verse'])
    act(() => void vi.advanceTimersByTime(3_700))
    expect(sent()).toEqual(['verse'])
    act(() => void vi.advanceTimersByTime(200))
    expect(sent()).toEqual(['verse', 'chorus'])
    const ctx = world.fireCue.mock.calls[1]![1] as { sendsServerCues: boolean; timing: { scheduledAt: number } }
    expect(ctx.sendsServerCues).toBe(false)
    // Song time 4 s after a start at 1 000 000, in server time (no offset in the test).
    expect(ctx.timing.scheduledAt).toBe(1_004_000)
    await act(async () => {})
    expect(append).not.toHaveBeenCalled()
  })

  it('a take inside the song first sends the state it holds there; resuming at the same spot sends nothing again', () => {
    renderHook(() => useCueScheduler())
    play(5_000)
    expect(sent()).toEqual(['chorus (chase)'])
    act(() => void vi.advanceTimersByTime(1_000))
    patch({ playbackStatus: 'paused', playbackStartedAt: null, playbackAccumulatedMs: 6_000 })
    play(6_000)
    expect(sent()).toEqual(['chorus (chase)'])
    act(() => void vi.advanceTimersByTime(2_000))
    expect(sent()).toEqual(['chorus (chase)', 'solo'])
  })

  it('the loop trainer\'s speed stretches the moments', () => {
    renderHook(() => useCueScheduler())
    patch({ playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: 0, playbackRate: 0.5 })
    act(() => void vi.advanceTimersByTime(7_700))
    expect(sent()).toEqual(['verse'])
    act(() => void vi.advanceTimersByTime(200))
    expect(sent()).toEqual(['verse', 'chorus'])
    expect((world.fireCue.mock.calls[1]![1] as { timing: { scheduledAt: number } }).timing.scheduledAt).toBe(1_008_000)
  })
})
