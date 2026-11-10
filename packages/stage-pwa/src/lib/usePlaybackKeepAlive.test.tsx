import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }))
const native = vi.hoisted(() => ({ on: true }))
vi.mock('./native', () => ({ isNativeApp: () => native.on }))
vi.mock('../store/useAppModeStore', async () => {
  const { create } = await import('zustand')
  return { useAppModeStore: create(() => ({ mode: 'practice' as 'gig' | 'practice' })) }
})

vi.mock('../store/useWorkspaceStore', async () => {
  const { create } = await import('zustand')
  return { useWorkspaceStore: create(() => ({ activeWorkspaceId: 'band' })) }
})

const { useAppModeStore } = await import('../store/useAppModeStore')
const { usePracticeStateStore } = await import('../store/usePracticeStateStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { usePlaybackKeepAlive } = await import('./usePlaybackKeepAlive')

const ws = () => useWorkspaceStore.getState().activeWorkspaceId

beforeEach(() => {
  plugin.start.mockClear()
  plugin.stop.mockClear()
  native.on = true
  useAppModeStore.setState({ mode: 'practice' })
  usePracticeStateStore.setState({ byWorkspace: {} })
})

describe('usePlaybackKeepAlive (N1, 2026-11-10)', () => {
  it('runs for the whole Gig, also while paused', () => {
    useAppModeStore.setState({ mode: 'gig' })
    renderHook(() => usePlaybackKeepAlive())
    expect(plugin.start).toHaveBeenCalledTimes(1)
    act(() => useAppModeStore.setState({ mode: 'practice' }))
    expect(plugin.stop).toHaveBeenCalled()
  })

  it('runs in practice only while something plays', () => {
    renderHook(() => usePlaybackKeepAlive())
    expect(plugin.start).not.toHaveBeenCalled()
    expect(plugin.stop).toHaveBeenCalledTimes(1) // left over from before a reload
    act(() => usePracticeStateStore.getState().patch(ws(), { playbackStatus: 'playing' }))
    expect(plugin.start).toHaveBeenCalledTimes(1)
    plugin.stop.mockClear()
    act(() => usePracticeStateStore.getState().patch(ws(), { playbackStatus: 'paused' }))
    expect(plugin.stop).toHaveBeenCalled()
    expect(plugin.start).toHaveBeenCalledTimes(1)
  })

  it('does nothing in the browser', () => {
    native.on = false
    useAppModeStore.setState({ mode: 'gig' })
    renderHook(() => usePlaybackKeepAlive())
    expect(plugin.start).not.toHaveBeenCalled()
    expect(plugin.stop).not.toHaveBeenCalled()
  })
})
