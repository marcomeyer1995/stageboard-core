import { describe, expect, it } from 'vitest'
import { createBandCatalog, type BandStore } from './bandCatalog.js'

/**
 * The band's life cycle as every host answers it (#962): found, list, delete, rename, the access code, the master
 * mode and the Device Ledger's block/remove. The logic is here; how a host stores a band is its `BandStore`.
 */
function fakeStore(overrides: Partial<BandStore> = {}) {
  const bands = new Map<string, { code: string; name: string; masterMode?: 'device' | 'account' }>()
  const logins = new Map<string, Map<string, { password: string; roles: string[] }>>()
  const deleted = new Set<string>()
  const devices = new Map<string, { revoked?: boolean; executionTarget?: string | null; name?: string }>()
  const store: BandStore = {
    bands: async () => [...bands.keys()],
    isDeleted: (id) => deleted.has(id),
    markDeleted: (id) => void deleted.add(id),
    create: async (id, name, founder) => {
      bands.set(id, { code: '12345678', name })
      logins.set(id, new Map([[`stageboard-${id}-${founder.founderId}~${founder.deviceId}`, { password: 'pw', roles: ['member', 'admin'] }]]))
      return { username: `stageboard-${id}-${founder.founderId}~${founder.deviceId}`, password: 'pw' }
    },
    remove: async (id) => void bands.delete(id),
    accessCode: async (id) => bands.get(id) ?? null,
    ensureAccessCode: async (id, fallback) => {
      if (!bands.has(id)) throw new Error('no such band')
      return bands.get(id)!
    },
    rotateAccessCode: async (id) => {
      const band = bands.get(id)
      if (!band) throw new Error('no such band')
      band.code = '87654321'
      return band.code
    },
    rename: async (id, name) => {
      const band = bands.get(id)
      if (band) band.name = name
    },
    setMasterMode: async (id, mode) => {
      const band = bands.get(id)
      if (band) band.masterMode = mode
    },
    login: async (id, username, password) => {
      const login = logins.get(id)?.get(username)
      return login?.password === password ? { name: username, roles: login.roles } : null
    },
    checkAdmin: async (id, username, password) => {
      const login = logins.get(id)?.get(username)
      return login?.password === password && login.roles.includes('admin') ? true : false
    },
    isAdminOfAnyBand: async (username, password) => {
      for (const perBand of logins.values()) {
        const login = perBand.get(username)
        if (login?.password === password && login.roles.includes('admin')) return true
      }
      return false
    },
    setDeviceRevoked: async (id, deviceId, revoked) => {
      if (!bands.has(id)) return 'unknown'
      devices.set(`${id}/${deviceId}`, { ...devices.get(`${id}/${deviceId}`), revoked })
      return 'ok'
    },
    forgetDevice: async (id, deviceId) => {
      if (!bands.has(id)) return 'unknown'
      const device = devices.get(`${id}/${deviceId}`)
      if (!device) return 'unknown'
      if (device.revoked) return 'blocked'
      if (device.executionTarget) return { usedBy: [device.executionTarget] }
      devices.delete(`${id}/${deviceId}`)
      return 'ok'
    },
    ...overrides,
  }
  return { store, bands, deleted, devices, addLogin: (band: string, username: string, password: string, roles: string[]) => logins.set(band, new Map([...(logins.get(band) ?? []), [username, { password, roles }]])) }
}

const proof = { adminUsername: 'stageboard-band-a-p1~tablet', adminPassword: 'pw' }

describe('the band life cycle', () => {
  it('founds the first band on a host that holds none - no proof needed - and hands back the founder login', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    const answer = await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect(answer.status).toBe(201)
    expect(answer.body).toMatchObject({ username: 'stageboard-band-a-p1~tablet', password: 'pw' })
  })

  it('refuses a second band without an admin login of a band on this host - and accepts one with it', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    const refused = await catalog.create({ workspaceId: 'band-b', founderId: 'p1', workspaceName: 'Band B', deviceId: 'phone' })
    expect(refused.status).toBe(403)
    expect(refused.body).toMatchObject({ code: 'admin-required' })
    const accepted = await catalog.create({ workspaceId: 'band-b', founderId: 'p1', workspaceName: 'Band B', deviceId: 'phone', ...proof })
    expect(accepted.status).toBe(201)
  })

  it('does not take an admin login of another band for this one', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    await catalog.create({ workspaceId: 'band-b', founderId: 'p1', workspaceName: 'Band B', deviceId: 'phone', ...proof })
    expect((await catalog.accessCode('band-b', { adminUsername: 'stageboard-band-a-p1~tablet', adminPassword: 'pw' })).status).toBe(403)
  })

  it('lets the host machine found a band itself, without any admin proof', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store, isSelfRequest: (address) => address === '127.0.0.1' })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect((await catalog.create({ workspaceId: 'band-b', founderId: 'p1', workspaceName: 'Band B', deviceId: 'laptop' }, '127.0.0.1')).status).toBe(201)
  })

  it('refuses a band id that extends another one - logins are named after it', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band', founderId: 'p1', workspaceName: 'Band', deviceId: 'tablet' })
    const answer = await catalog.create({ workspaceId: 'band-2', founderId: 'p1', workspaceName: 'Band 2', deviceId: 'phone', ...proof })
    expect(answer.status).toBe(400)
  })

  it('never founds a deleted band again, and says why', async () => {
    const { store, deleted } = fakeStore()
    const catalog = createBandCatalog({ store })
    deleted.add('band-a')
    const answer = await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect(answer.status).toBe(409)
    expect(answer.body).toMatchObject({ code: 'deleted' })
  })

  it('answers 409 for a band that already exists instead of handing a stranger an admin login', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect((await catalog.create({ workspaceId: 'band-a', founderId: 'x', workspaceName: 'Band A', deviceId: 'y' })).status).toBe(409)
  })

  it('lists every band with its display name', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect((await catalog.list()).body).toEqual([{ workspaceId: 'band-a', workspaceName: 'Band A' }])
  })

  it('deletes a band only for its admin, and marks it deleted so it is never founded again', async () => {
    const { store, deleted } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect((await catalog.remove('band-a', { adminUsername: 'nobody', adminPassword: 'pw' })).status).toBe(403)
    expect((await catalog.remove('band-a', proof)).status).toBe(204)
    expect(await store.bands()).toEqual([])
    expect(deleted.has('band-a')).toBe(true)
  })

  it('renames, reads and rotates the access code, and sets the master mode - admin only', async () => {
    const { store, bands } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    expect((await catalog.accessCode('band-a', { adminUsername: 'x', adminPassword: 'y' })).status).toBe(403)
    expect((await catalog.accessCode('band-a', proof)).body).toEqual({ code: '12345678' })
    expect((await catalog.rotateAccessCode('band-a', proof)).body).toEqual({ code: '87654321' })
    expect((await catalog.rename('band-a', { name: 'Neue Band', ...proof })).status).toBe(200)
    expect(bands.get('band-a')?.name).toBe('Neue Band')
    expect((await catalog.setMasterMode('band-a', { masterMode: 'account', ...proof })).status).toBe(200)
    expect(bands.get('band-a')?.masterMode).toBe('account')
  })

  it('blocks and removes a device only for an admin, and never removes a blocked or a used one', async () => {
    const { store, devices } = fakeStore()
    const catalog = createBandCatalog({ store })
    await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'tablet' })
    devices.set('band-a/fire', {})
    expect((await catalog.revokeDevice('band-a', { deviceId: 'fire', revoked: true, adminUsername: 'x', adminPassword: 'y' })).status).toBe(403)
    expect((await catalog.revokeDevice('band-a', { deviceId: 'fire', revoked: true, ...proof })).status).toBe(204)
    expect((await catalog.forgetDevice('band-a', { deviceId: 'fire', ...proof })).status).toBe(409)
    devices.set('band-a/fire', { revoked: false, executionTarget: 'lighting' })
    expect((await catalog.forgetDevice('band-a', { deviceId: 'fire', ...proof })).status).toBe(409)
    devices.set('band-a/fire', { revoked: false })
    expect((await catalog.forgetDevice('band-a', { deviceId: 'fire', ...proof })).status).toBe(204)
    devices.set('band-a/unknown', {})
    expect((await catalog.forgetDevice('band-a', { deviceId: 'missing', ...proof })).status).toBe(404)
  })

  it('answers a band this host does not hold like a refused login, never a 500', async () => {
    const { store } = fakeStore()
    const catalog = createBandCatalog({ store })
    expect((await catalog.rename('nope', { name: 'x', ...proof })).status).toBe(403)
    expect((await catalog.accessCode('nope', proof)).status).toBe(403)
  })
})
