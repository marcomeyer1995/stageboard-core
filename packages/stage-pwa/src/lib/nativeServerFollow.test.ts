import { afterEach, describe, expect, it, vi } from 'vitest'

// The native app (#351): Capacitor reports a native platform; both shell plugins are mocks.
const plugins = vi.hoisted(() => ({
  trust: { pin: vi.fn(async () => {}), pinned: vi.fn(async () => ({ fingerprint: 'aa' as string | null })), fingerprintOf: vi.fn(), downloadAndInstall: vi.fn() },
  discovery: { discover: vi.fn(async () => ({ servers: [] as { name: string; address: string; port: number; fingerprint: string | null }[] })) },
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: (name: string) => (name === 'ServerDiscovery' ? plugins.discovery : plugins.trust),
}))

const { discoverServers, followServerIfMoved, pickMovedServer } = await import('./native')
const { useStageServerStore } = await import('../store/useStageServerStore')

afterEach(() => {
  vi.unstubAllGlobals()
  plugins.trust.pin.mockClear()
  plugins.discovery.discover.mockClear()
})

describe('finding Stage-Servers on the network (#351)', () => {
  it('lists announced servers; the port only appears when it is not 443', async () => {
    plugins.discovery.discover.mockResolvedValueOnce({
      servers: [
        { name: 'StageBoard Test', address: '192.168.178.158', port: 8443, fingerprint: 'aa' },
        { name: 'StageBoard Laptop', address: '192.168.178.158', port: 443, fingerprint: 'aa' },
      ],
    })
    expect(await discoverServers()).toEqual([
      { name: 'StageBoard Laptop', host: '192.168.178.158', fingerprint: 'aa' },
      { name: 'StageBoard Test', host: '192.168.178.158:8443', fingerprint: 'aa' },
    ])
  })

  it('the paired server at a new address is the one with exactly the pinned fingerprint', () => {
    const found = [
      { name: 'Other', host: '10.0.0.9', fingerprint: 'bb' },
      { name: 'Ours', host: '10.0.0.7', fingerprint: 'aa' },
    ]
    expect(pickMovedServer(found, 'aa', '192.168.178.158')?.host).toBe('10.0.0.7')
    expect(pickMovedServer(found, 'cc', '192.168.178.158')).toBeNull() // never a different certificate
    expect(pickMovedServer(found, 'aa', '10.0.0.7')).toBeNull() // same address: nothing moved
  })
})

describe('followServerIfMoved (#351)', () => {
  it('does nothing while the stored server answers', async () => {
    useStageServerStore.getState().setUrl('https://192.168.178.158')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
    expect(await followServerIfMoved()).toBe('reachable')
    expect(plugins.discovery.discover).not.toHaveBeenCalled()
  })

  it('unreachable: finds it by its certificate at the new address and switches there', async () => {
    useStageServerStore.getState().setUrl('https://192.168.178.158')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unreachable') }))
    plugins.discovery.discover.mockResolvedValueOnce({ servers: [{ name: 'Ours', address: '10.0.0.7', port: 443, fingerprint: 'aa' }] })
    expect(await followServerIfMoved()).toBe('moved')
    expect(plugins.trust.pin).toHaveBeenCalledWith({ host: '10.0.0.7', fingerprint: 'aa' })
    expect(useStageServerStore.getState().url).toBe('https://10.0.0.7')
  })

  it('unreachable and only servers with other certificates around: stays put', async () => {
    useStageServerStore.getState().setUrl('https://192.168.178.158')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unreachable') }))
    plugins.discovery.discover.mockResolvedValueOnce({ servers: [{ name: 'Stranger', address: '10.0.0.9', port: 443, fingerprint: 'bb' }] })
    expect(await followServerIfMoved()).toBe('not-found')
    expect(plugins.trust.pin).not.toHaveBeenCalled()
    expect(useStageServerStore.getState().url).toBe('https://192.168.178.158')
  })
})
