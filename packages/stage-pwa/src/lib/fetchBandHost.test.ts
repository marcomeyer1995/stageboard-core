import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBandHost, hostUrlFromInput } from './fetchBandHost'

afterEach(() => vi.unstubAllGlobals())

const FP = 'c'.repeat(64)
/** A fake host: `/time` and `/server-info` answers by path. */
function stubHost(answers: Record<string, unknown | null>) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname
    const body = answers[path]
    return body === null || body === undefined ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => body }
  })
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

describe('fetchBandHost (#914)', () => {
  it('reads the host id from /time and the fingerprint from /server-info', async () => {
    stubHost({ '/time': { serverTime: 1, hostId: 'stage-pc', epoch: 1 }, '/server-info': { lanIp: '10.0.0.2', certFingerprint: FP } })
    expect(await fetchBandHost('10.0.0.2:8443')).toEqual({ hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: FP })
  })

  it('leaves the fingerprint out when the host has none (no pinning)', async () => {
    stubHost({ '/time': { serverTime: 1, hostId: 'stage-pc', epoch: 1 }, '/server-info': { lanIp: '10.0.0.2', certFingerprint: null } })
    expect(await fetchBandHost('https://10.0.0.2')).toEqual({ hostId: 'stage-pc', url: 'https://10.0.0.2' })
  })

  it('is null for a host that does not answer, or one built before host ids existed', async () => {
    stubHost({})
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
    stubHost({ '/time': { serverTime: 1 }, '/server-info': { lanIp: '10.0.0.2', certFingerprint: FP } })
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
  })

  it('is null for a fingerprint in the wrong form, instead of storing it', async () => {
    stubHost({ '/time': { serverTime: 1, hostId: 'x', epoch: 1 }, '/server-info': { certFingerprint: 'AA:BB' } })
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
  })

  it('is null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await fetchBandHost('https://10.0.0.2')).toBeNull()
  })
})
