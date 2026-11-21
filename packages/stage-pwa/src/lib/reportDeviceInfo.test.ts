import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncStore } from '../store/useSyncStore'
import { reportDeviceInfo } from './reportDeviceInfo'

const REPORT = { deviceId: 'device-1', os: 'iPad', environment: 'browser' as const, syncStatus: 'idle' as const }

afterEach(() => {
  useSyncStore.setState({ notOnServer: {} })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('reportDeviceInfo', () => {
  it('POSTs the report to the workspace-scoped device-info report endpoint', async () => {
    vi.stubEnv('VITE_HOST_URL', 'https://stage.example')
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

  it('does nothing when no Host is configured', async () => {
    vi.stubEnv('VITE_HOST_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await reportDeviceInfo('band-a', REPORT)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not report a band the Host does not have (#897)', async () => {
    vi.stubEnv('VITE_HOST_URL', 'https://stage.example')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useSyncStore.setState({ notOnServer: { 'band-a': true } })

    await reportDeviceInfo('band-a', REPORT)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a network failure - the caller has no fallback to run', async () => {
    vi.stubEnv('VITE_HOST_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(reportDeviceInfo('band-a', REPORT)).resolves.toBeUndefined()
  })
})
