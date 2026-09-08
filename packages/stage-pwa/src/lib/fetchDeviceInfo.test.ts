import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DEVICE_INFO } from 'shared-types'
import { fetchDeviceInfo } from './fetchDeviceInfo'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchDeviceInfo', () => {
  it('GETs the workspace-scoped device-info endpoint and returns the parsed snapshot', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    const snapshot = { devices: { 'device-1': { ip: '10.0.0.1' } } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchDeviceInfo('band-a')

    expect(fetchMock).toHaveBeenCalledWith('https://stage.example/workspaces/band-a/device-info')
    expect(result).toEqual(snapshot)
  })

  it('returns the default (empty) snapshot when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchDeviceInfo('band-a')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual(DEFAULT_DEVICE_INFO)
  })

  it('returns null (keep showing the last-known snapshot) on a non-ok response', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    expect(await fetchDeviceInfo('band-a')).toBeNull()
  })

  it('returns null on a network failure, without throwing', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(fetchDeviceInfo('band-a')).resolves.toBeNull()
  })
})
