import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddonReleaseManifest, PluginInstallation } from 'shared-types'

const sourcesPut = vi.hoisted(() => vi.fn())
vi.mock('./workspaceCollection', () => ({ createWorkspaceCollection: () => ({ put: sourcesPut, switchWorkspace: vi.fn() }) }))
vi.mock('./stageServer', () => ({ getStageServerUrl: () => 'https://host:8443' }))
vi.mock('../store/useWorkspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: [{ id: 'band', username: 'stageboard-band-admin~dev', password: 'pw' }] }) },
}))

const { installRepositoryAddon, installationFromManifest, isKnownPublisher, previewRepositoryAddon, RepositoryAddonError } = await import('./addonRepository')

const manifest: AddonReleaseManifest = {
  id: 'nux-mg30',
  name: 'NUX MG-30',
  version: '0.1.0',
  runtime: 'client',
  capabilities: ['mg30-control'],
  transports: [],
  hardwareIds: [],
  apiVersion: 1,
  permissions: ['midi-out:NUX MG-30'],
  files: [{ name: 'client.js', sha256: 'a'.repeat(64), size: 10 }],
  clientFile: 'client.js',
  changes: 'First',
}
const preview = { repository: 'https://github.com/marcomeyer1995/stageboard-addon-nux-mg30', publisher: 'marcomeyer1995', release: 'v0.1.0', downloadBytes: 10, manifest }

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  sourcesPut.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('installationFromManifest (#852 step 3)', () => {
  it('the client bundle from the host copy, release-only fields left out', () => {
    const installation = installationFromManifest(manifest, undefined, 7)
    expect(installation).toMatchObject({ id: 'nux-mg30', version: '0.1.0', clientSource: '/addons/nux-mg30/0.1.0/client.js', enabled: true, installedAt: 7, permissions: ['midi-out:NUX MG-30'] })
    expect(installation).not.toHaveProperty('files')
    expect(installation).not.toHaveProperty('changes')
  })

  it("an update keeps the band's own state", () => {
    const existing = { ...installationFromManifest(manifest, undefined, 1), version: '0.0.1', enabled: false, settings: { a: 1 } } as PluginInstallation
    expect(installationFromManifest(manifest, existing, 9)).toMatchObject({ enabled: false, installedAt: 1, settings: { a: 1 }, version: '0.1.0' })
  })
})

describe('publisher', () => {
  it("StageBoard's own is known, others only once confirmed", () => {
    expect(isKnownPublisher('marcomeyer1995')).toBe(true)
    expect(isKnownPublisher('someone')).toBe(false)
    expect(isKnownPublisher('someone', true)).toBe(true)
  })
})

describe('installRepositoryAddon', () => {
  it('asks the host for the version the admin saw, then writes installation and source', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...preview, keptVersions: ['0.1.0', '0.0.1'] }) })
    const put = vi.fn().mockResolvedValue(undefined)
    const existing = { ...installationFromManifest(manifest, undefined, 1), version: '0.0.1' } as PluginInstallation
    await installRepositoryAddon('band', preview, existing, false, put)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://host:8443/workspaces/band/addons/install')
    expect(JSON.parse(init.body)).toEqual({ repository: preview.repository, expectedVersion: '0.1.0', previousVersion: '0.0.1' })
    expect(init.headers.Authorization).toBe(`Basic ${btoa('stageboard-band-admin~dev:pw')}`)
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ id: 'nux-mg30', clientSource: '/addons/nux-mg30/0.1.0/client.js' }))
    expect(sourcesPut).toHaveBeenCalledWith(expect.objectContaining({ id: 'nux-mg30', repository: preview.repository, installedVersion: '0.1.0', keptVersions: ['0.1.0', '0.0.1'], publisherConfirmed: true }))
  })

  it("writes nothing when the host refuses - the host's code for the admin", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ code: 'checksum' }) })
    const put = vi.fn()
    await expect(installRepositoryAddon('band', preview, undefined, false, put)).rejects.toMatchObject({ code: 'checksum' })
    expect(put).not.toHaveBeenCalled()
    expect(sourcesPut).not.toHaveBeenCalled()
  })

  it('a member who is not admin gets "not-admin", an unreachable host "offline"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
    await expect(previewRepositoryAddon('band', 'github.com/a/b')).rejects.toBeInstanceOf(RepositoryAddonError)
    fetchMock.mockRejectedValueOnce(new Error('down'))
    await expect(previewRepositoryAddon('band', 'github.com/a/b')).rejects.toMatchObject({ code: 'offline' })
  })
})
