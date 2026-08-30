import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportClientHealth } from './reportClientHealth'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('reportClientHealth', () => {
  it('POSTs the plugin name and status to the workspace-scoped report endpoint', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await reportClientHealth('band-a', 'generic-webmidi', 'online')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://stage.example/plugin-health/band-a/report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pluginName: 'generic-webmidi', status: 'online' }),
      }),
    )
  })

  it('does nothing when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await reportClientHealth('band-a', 'generic-webmidi', 'offline')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a network failure - the caller has no fallback to run', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(reportClientHealth('band-a', 'generic-webmidi', 'online')).resolves.toBeUndefined()
  })
})
