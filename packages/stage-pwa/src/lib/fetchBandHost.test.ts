import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBandHost, hostUrlFromInput } from './fetchBandHost'

const stageServer = vi.hoisted(() => ({ url: 'https://paired.local:8443' as string | undefined }))
vi.mock('./stageServer', () => ({ getStageServerUrl: () => stageServer.url }))

afterEach(() => vi.unstubAllGlobals())

const FP = 'c'.repeat(64)

/** The own Stage-Server's answer to the lookup. */
function stubLookup(answer: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => answer }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('hostUrlFromInput (#914)', () => {
  it('adds https, drops a trailing slash and keeps the port', () => {
    expect(hostUrlFromInput('192.168.1.11:8443')).toBe('https://192.168.1.11:8443')
    expect(hostUrlFromInput(' https://stage.local/ ')).toBe('https://stage.local')
  })

  it('refuses plain http and empty input', () => {
    expect(hostUrlFromInput('http://192.168.1.11')).toBeNull()
    expect(hostUrlFromInput('  ')).toBeNull()
  })
})

describe('fetchBandHost (#914, #945)', () => {
  it('asks its own Stage-Server to look the address up - the page itself must not call a host it does not trust', async () => {
    const fetchMock = stubLookup({ hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: FP })
    expect(await fetchBandHost('10.0.0.2:8443')).toEqual({ hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: FP })
    expect(fetchMock).toHaveBeenCalledWith('https://paired.local:8443/host/look-up?address=https%3A%2F%2F10.0.0.2%3A8443', expect.anything())
  })

  it('leaves the fingerprint out when the host has none (no pinning)', async () => {
    stubLookup({ hostId: 'stage-pc', url: 'https://10.0.0.2' })
    expect(await fetchBandHost('https://10.0.0.2')).toEqual({ hostId: 'stage-pc', url: 'https://10.0.0.2' })
  })

  it('is null when its own server says the address is not a Stage-Server, or answers nonsense', async () => {
    stubLookup({ status: 'error' }, false)
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
    stubLookup({ hostId: 'stage-pc' })
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
  })

  it('is null without a Stage-Server of its own, without an address, or when the request throws', async () => {
    stageServer.url = undefined
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
    stageServer.url = 'https://paired.local:8443'
    expect(await fetchBandHost('http://10.0.0.2')).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
  })
})
