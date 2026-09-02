import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportPresence } from './reportPresence'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('reportPresence', () => {
  it('POSTs the deviceId and profileId to the workspace-scoped presence report endpoint', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await reportPresence('band-a', 'device-1', 'p1')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://stage.example/workspaces/band-a/presence/report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deviceId: 'device-1', profileId: 'p1' }),
      }),
    )
  })

  it('does nothing when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await reportPresence('band-a', 'device-1', 'p1')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a network failure - the caller has no fallback to run', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(reportPresence('band-a', 'device-1', 'p1')).resolves.toBeUndefined()
  })
})
