import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWorkspaceResource } from './useWorkspaceResource'

const noStart = () => null

describe('useWorkspaceResource', () => {
  it('re-inits when the workspace changes', async () => {
    const init = vi.fn(async () => undefined)
    const { rerender } = renderHook(({ ws }) => useWorkspaceResource(init, noStart, ws), { initialProps: { ws: 'a' } })
    expect(init).toHaveBeenCalledTimes(1)
    rerender({ ws: 'b' })
    expect(init).toHaveBeenCalledTimes(2)
    expect(init).toHaveBeenLastCalledWith('b')
  })

  it('re-inits when the restart key changes - the server address, so a live stream moves with a host switch (#947)', async () => {
    const init = vi.fn(async () => undefined)
    const { rerender } = renderHook(({ url }) => useWorkspaceResource(init, noStart, 'band', url), { initialProps: { url: 'https://laptop:8443' } })
    expect(init).toHaveBeenCalledTimes(1)
    rerender({ url: 'https://laptop:8443' })
    expect(init).toHaveBeenCalledTimes(1)
    rerender({ url: 'https://tablet:8443' })
    expect(init).toHaveBeenCalledTimes(2)
    expect(init).toHaveBeenLastCalledWith('band')
  })

  it('cancels the previous sync when it restarts', async () => {
    const cancel = vi.fn()
    const startSync = vi.fn(() => ({ cancel }) as never)
    const { rerender } = renderHook(({ url }) => useWorkspaceResource(async () => undefined, startSync, 'band', url), { initialProps: { url: 'a' } })
    await Promise.resolve()
    await Promise.resolve()
    rerender({ url: 'b' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
