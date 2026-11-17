import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchServerAddress, hostWithPort } from './serverInfo'

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

    expect(await fetchServerAddress()).toEqual({ host: '192.168.1.5', certFingerprint: 'ab12' })
  })

  it('puts the port into the host when the server is not on 443 (#896)', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example:8443')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lanIp: '192.168.1.5', port: 8443, certFingerprint: null }) }))
    expect(await fetchServerAddress()).toEqual({ host: '192.168.1.5:8443', certFingerprint: null })
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

describe('hostWithPort', () => {
  it('leaves 443 and an unknown port out, adds any other', () => {
    expect(hostWithPort('10.0.0.2', 443)).toBe('10.0.0.2')
    expect(hostWithPort('10.0.0.2', undefined)).toBe('10.0.0.2')
    expect(hostWithPort('10.0.0.2', null)).toBe('10.0.0.2')
    expect(hostWithPort('10.0.0.2', 8443)).toBe('10.0.0.2:8443')
  })
})
