import { afterEach, describe, expect, it, vi } from 'vitest'

// The native app (#348): Capacitor reports a native platform, the shell's plugin is a mock.
const plugin = vi.hoisted(() => ({ pin: vi.fn(), fingerprintOf: vi.fn(), downloadAndInstall: vi.fn(async () => {}) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => plugin }))
vi.stubEnv('VITE_APP_VERSION_CODE', '420')

const { checkForAppUpdate, installAppUpdate } = await import('./native')
const { useStageServerStore } = await import('../store/useStageServerStore')

afterEach(() => vi.unstubAllGlobals())

function serverOffers(versionCode: number) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ versionCode, versionName: `1.${versionCode}` }) })))
}

describe('app updates from the Stage-Server (#348)', () => {
  it('offers the server build only when it is newer than this app', async () => {
    useStageServerStore.getState().setUrl('https://192.168.178.158')
    serverOffers(421)
    expect(await checkForAppUpdate()).toEqual({ versionCode: 421, versionName: '1.421' })
    serverOffers(420)
    expect(await checkForAppUpdate()).toBeNull()
  })

  it('stays quiet without a server or when the server has no app', async () => {
    useStageServerStore.getState().setUrl(null)
    expect(await checkForAppUpdate()).toBeNull()
    useStageServerStore.getState().setUrl('https://192.168.178.158')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await checkForAppUpdate()).toBeNull()
  })

  it('downloads the APK from the paired server', async () => {
    useStageServerStore.getState().setUrl('https://192.168.178.158')
    await installAppUpdate()
    expect(plugin.downloadAndInstall).toHaveBeenCalledWith({ url: 'https://192.168.178.158/app/stageboard.apk' })
  })
})
