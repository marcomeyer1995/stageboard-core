import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const executor = vi.hoisted(() => ({ value: { where: 'self' } as { where: 'self' } | { where: 'host'; url: string } | { where: 'none'; needs: string | null; note: string | null } }))
const local = vi.hoisted(() => ({ call: vi.fn(async () => ({ ok: true as const, body: { from: 'device' } })) }))
let hostUrl: string | undefined = 'https://laptop'
vi.mock('./jobHost', () => ({ resolveExecutorFor: vi.fn(async () => executor.value) }))
vi.mock('./executorSelf', () => ({ loadOf: () => 'light', selfFor: async () => ({ canRun: true, power: 8 }) }))
vi.mock('./addonWork', () => ({ localAddonMethods: local }))
vi.mock('./hostUrl', () => ({ getHostUrl: () => hostUrl, HOST_UNREACHABLE_MESSAGE: 'unreachable', NO_HOST_MESSAGE: 'no host' }))
vi.mock('./lookupClient', () => ({ bandParam: () => '&workspace=band' }))

const { callAddonMethod } = await import('./addonMethodClient')

beforeEach(() => {
  hostUrl = 'https://laptop'
  local.call.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, body: { from: 'host' } }), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('callAddonMethod: this device first, then a host (#964)', () => {
  it('runs on this device when the choice says so - no request leaves it', async () => {
    executor.value = { where: 'self' }
    expect(await callAddonMethod('youtube-download', 'search', { query: 'x' })).toEqual({ ok: true, body: { from: 'device' } })
    expect(local.call).toHaveBeenCalledWith('youtube-download', 'search', { query: 'x' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks the chosen host otherwise', async () => {
    executor.value = { where: 'host', url: 'https://laptop' }
    expect(await callAddonMethod('youtube-download', 'search', { query: 'x' })).toEqual({ ok: true, body: { from: 'host' } })
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe('https://laptop/addons/youtube-download/methods/search?workspace=band')
    expect(local.call).not.toHaveBeenCalled()
  })

  it('says what is missing when nobody can, and that no host is set when none is', async () => {
    executor.value = { where: 'none', needs: 'yt-dlp', note: 'install it' }
    expect(await callAddonMethod('youtube-download', 'search', {})).toEqual({ ok: false, error: { code: 'host.none', message: 'Missing: yt-dlp. install it' } })
    hostUrl = undefined
    expect(await callAddonMethod('youtube-download', 'search', {})).toEqual({ ok: false, error: { code: 'host.none', message: 'no host' } })
  })
})
