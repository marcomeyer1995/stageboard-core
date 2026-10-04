import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The native app (#348) before pairing: no server address at all.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({}) }))

const { useStageServerStatus } = await import('./useStageServerStatus')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useStageServerStore } = await import('../store/useStageServerStore')

describe('useStageServerStatus in the unpaired native app', () => {
  it('reports "unpaired" and asks no server', async () => {
    useStageServerStore.getState().setUrl(null)
    const listWorkspaces = vi.fn(async () => null)
    const fetchActiveWorkspaceHardware = vi.fn(async () => null)
    const fetchServerInfo = vi.fn(async () => null)
    useWorkspaceStore.setState({ listWorkspaces, fetchActiveWorkspaceHardware, fetchServerInfo })

    const { result } = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(result.current.status).toBe('unpaired'))
    expect(listWorkspaces).not.toHaveBeenCalled()
    expect(fetchServerInfo).not.toHaveBeenCalled()
  })
})
