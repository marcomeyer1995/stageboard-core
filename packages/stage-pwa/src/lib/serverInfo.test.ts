import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchServerAddress } from './serverInfo'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchServerAddress', () => {
  it('returns the lanIp and certificate fingerprint from GET /server-info', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        expect(url).toBe('https://stage.example/server-info')
        return { ok: true, json: async () => ({ lanIp: '192.168.1.5', certFingerprint: 'ab12' }) }
      }),
    )

    expect(await fetchServerAddress()).toEqual({ lanIp: '192.168.1.5', certFingerprint: 'ab12' })
  })

  it('returns null when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    expect(await fetchServerAddress()).toBeNull()
  })

  it('returns null on a network error rather than throwing', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )

    expect(await fetchServerAddress()).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    expect(await fetchServerAddress()).toBeNull()
  })
})
