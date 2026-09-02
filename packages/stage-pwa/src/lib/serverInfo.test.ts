import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLanIp } from './serverInfo'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchLanIp', () => {
  it('returns the lanIp from GET /server-info', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        expect(url).toBe('https://stage.example/server-info')
        return { ok: true, json: async () => ({ lanIp: '192.168.1.5' }) }
      }),
    )

    expect(await fetchLanIp()).toBe('192.168.1.5')
  })

  it('returns null when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    expect(await fetchLanIp()).toBeNull()
  })

  it('returns null on a network error rather than throwing', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )

    expect(await fetchLanIp()).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    expect(await fetchLanIp()).toBeNull()
  })
})
