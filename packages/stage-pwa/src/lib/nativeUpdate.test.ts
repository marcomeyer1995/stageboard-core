import { afterEach, describe, expect, it, vi } from 'vitest'

// The native app (#348): Capacitor reports a native platform, the shell's plugin is a mock.
const plugin = vi.hoisted(() => ({ pin: vi.fn(), fingerprintOf: vi.fn(), downloadAndInstall: vi.fn(async () => {}) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => plugin }))
vi.stubEnv('VITE_APP_VERSION_CODE', '420')
// Which host hands out the app is jobHost's choice (tested there); here it is the paired host unless a test says otherwise.
const jobHost = vi.hoisted(() => ({ base: undefined as string | null | undefined }))
vi.mock('./jobHost', async () => {
  const { getHostUrl } = await import('./hostUrl')
  return { resolveHostFor: async () => ({ base: jobHost.base === undefined ? getHostUrl() : jobHost.base, message: 'x' }) }
})

const { checkForAppUpdate, installAppUpdate } = await import('./native')
const { useHostUrlStore } = await import('../store/useHostUrlStore')

afterEach(() => {
  vi.unstubAllGlobals()
  jobHost.base = undefined
})

function serverOffers(versionCode: number) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ versionCode, versionName: `1.${versionCode}` }) })))
}

describe('app updates from the Host (#348)', () => {
  it('offers the server build only when it is newer than this app', async () => {
    useHostUrlStore.getState().setUrl('https://192.168.178.158')
    serverOffers(421)
    expect(await checkForAppUpdate()).toEqual({ versionCode: 421, versionName: '1.421' })
    serverOffers(420)
    expect(await checkForAppUpdate()).toBeNull()
  })

  it('stays quiet without a server or when the server has no app', async () => {
    useHostUrlStore.getState().setUrl(null)
    expect(await checkForAppUpdate()).toBeNull()
    useHostUrlStore.getState().setUrl('https://192.168.178.158')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await checkForAppUpdate()).toBeNull()
  })

  it('downloads the APK from the paired server', async () => {
    useHostUrlStore.getState().setUrl('https://192.168.178.158')
    serverOffers(421)
    await checkForAppUpdate()
    await installAppUpdate()
    expect(plugin.downloadAndInstall).toHaveBeenCalledWith({ url: 'https://192.168.178.158/app/stageboard.apk' })
  })

  it('on a tablet host that does not hand out the app, asks the band\'s laptop host and downloads from it (#962)', async () => {
    useHostUrlStore.getState().setUrl('https://192.168.178.160:8443')
    jobHost.base = 'https://192.168.178.158'
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ versionCode: 430, versionName: '1.430' }) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await checkForAppUpdate()).toEqual({ versionCode: 430, versionName: '1.430' })
    expect(fetchMock).toHaveBeenCalledWith('https://192.168.178.158/app/version.json')
    await installAppUpdate()
    expect(plugin.downloadAndInstall).toHaveBeenLastCalledWith({ url: 'https://192.168.178.158/app/stageboard.apk' })
  })

  it('offers nothing when no host of the band hands out the app', async () => {
    useHostUrlStore.getState().setUrl('https://192.168.178.160:8443')
    jobHost.base = null
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await checkForAppUpdate()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
