import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportDeviceInfo } from './reportDeviceInfo'

const REPORT = { deviceId: 'device-1', os: 'iPad', environment: 'browser' as const, syncStatus: 'idle' as const }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('reportDeviceInfo', () => {
  it('POSTs the report to the workspace-scoped device-info report endpoint', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await reportDeviceInfo('band-a', REPORT)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://stage.example/workspaces/band-a/device-info/report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(REPORT),
      }),
    )
  })

  it('does nothing when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await reportDeviceInfo('band-a', REPORT)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a network failure - the caller has no fallback to run', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(reportDeviceInfo('band-a', REPORT)).resolves.toBeUndefined()
  })
})
