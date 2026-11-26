import { beforeEach, describe, expect, it } from 'vitest'
import { createBandAccounts, type AccountDoc, type AccountStore, type BandAccounts } from './bandAccounts.js'
import { createBandJoin, type BandJoin } from './bandJoin.js'
import { createBandMembers, type BandMembers } from './bandMembers.js'
import { createPinThrottle } from './pinThrottle.js'

const CODE = '57832943'
const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

let accounts: BandAccounts
let join: BandJoin
let members: BandMembers
let profiles: Record<string, { stageRoles?: string[] }>
let admin: { adminUsername: string; adminPassword: string }

beforeEach(async () => {
  const docs = new Map<string, AccountDoc>()
  const store: AccountStore = {
    get: async (id) => docs.get(id) ?? null,
    put: async (doc) => void docs.set(doc._id, doc),
    list: async (prefix) => [...docs.values()].filter((d) => d._id.startsWith(prefix)),
  }
  accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000 })
  profiles = { anna: { stageRoles: ['admin'] }, cleo: { stageRoles: ['admin'] }, ben: { stageRoles: ['drums'] } }
  const deps = {
    accounts,
    throttle: createPinThrottle({ maxFailures: 3, lockoutMs: 60_000, now: () => 0 }),
    workspaceId: 'band',
    accessCode: async () => CODE,
    profile: async (id: string) => profiles[id] ?? null,
  }
  join = createBandJoin(deps)
  members = createBandMembers({ ...deps, join, adminProfileIds: async () => Object.entries(profiles).filter(([, p]) => (p.stageRoles ?? []).includes('admin')).map(([id]) => id), loginThrottle: createPinThrottle({ maxFailures: 3, lockoutMs: 60_000, now: () => 0 }) })
  const made = await join.join('anna', { code: CODE, password: '4711', deviceId: 'anna-tab' })
  const creds = made.body as { username: string; password: string }
  admin = { adminUsername: creds.username, adminPassword: creds.password }
})

const body = (r: { body?: unknown }) => r.body as Record<string, unknown>

describe('who may manage members', () => {
  it('only an admin of this band: a wrong password, a plain member, another band\'s login and a made-up name are 403', async () => {
    const ben = await join.join('ben', { code: CODE, deviceId: 'ben-tab' })
    const b = body(ben)
    for (const proof of [
      { adminUsername: admin.adminUsername, adminPassword: 'wrong' },
      { adminUsername: b.username as string, adminPassword: b.password as string },
      { adminUsername: 'stageboard-other-p~d', adminPassword: 'x' },
      { adminUsername: 'nobody', adminPassword: 'x' },
    ]) {
      expect((await members.create({ ...proof, profileId: 'dora' })).status).toBe(403)
    }
  })

  it('is locked for a while after too many wrong tries - even with the right password', async () => {
    for (let i = 0; i < 3; i++) await members.create({ adminUsername: admin.adminUsername, adminPassword: 'wrong', profileId: 'dora' })
    expect((await members.create({ ...admin, profileId: 'dora' })).status).toBe(403)
  })
})

describe('adding a member', () => {
  it('an admin gets the PIN the admin chose, kept as a verifier only', async () => {
    const r = await members.create({ ...admin, profileId: 'cleo', password: '1234', isAdmin: true })
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ username: 'stageboard-band-cleo', password: '1234' })
    expect(await accounts.checkPin('cleo', '1234')).toBe(true)
  })

  it('an admin without a chosen PIN gets a fresh 4-digit one; a PIN that is not 4 digits is 400', async () => {
    const r = await members.create({ ...admin, profileId: 'cleo', isAdmin: true })
    expect(body(r).password).toMatch(/^\d{4}$/)
    expect(await accounts.checkPin('cleo', body(r).password as string)).toBe(true)
    expect((await members.create({ ...admin, profileId: 'cleo', password: 'abc', isAdmin: true })).status).toBe(400)
  })

  it('a plain member needs no PIN and none is stored', async () => {
    const r = await members.create({ ...admin, profileId: 'ben' })
    expect(r.status).toBe(201)
    expect(await accounts.hasPin('ben')).toBe(false)
  })
})

describe('giving and taking admin', () => {
  it('changes the roles of that person\'s devices', async () => {
    const ben = body(await join.join('ben', { code: CODE, deviceId: 'ben-tab' }))
    expect((await members.setAdmin('ben', { ...admin, isAdmin: true })).status).toBe(204)
    expect((await accounts.login(basic(ben.username as string, ben.password as string)))?.roles).toEqual(['member', 'admin'])
  })

  it('keeps at least one admin, and no admin takes away their own rights', async () => {
    profiles = { anna: { stageRoles: ['admin'] }, ben: {} } // anna is the only admin the roster knows
    expect(body(await members.setAdmin('anna', { ...admin, isAdmin: false })).message).toBe('At least one admin must remain')
    profiles = { anna: { stageRoles: ['admin'] }, cleo: { stageRoles: ['admin'] }, ben: {} }
    expect(body(await members.setAdmin('anna', { ...admin, isAdmin: false })).message).toBe('An admin cannot revoke their own admin rights')
    expect((await members.setAdmin('cleo', { ...admin, isAdmin: false })).status).toBe(204)
  })
})

describe('removing a member', () => {
  it('revokes the devices and the PIN of that person', async () => {
    const ben = body(await join.join('ben', { code: CODE, deviceId: 'ben-tab' }))
    expect((await members.remove('ben', admin)).status).toBe(204)
    expect(await accounts.login(basic(ben.username as string, ben.password as string))).toBeNull()
  })

  it('never the admin who asks', async () => {
    const r = await members.remove('anna', admin)
    expect(r.status).toBe(400)
    expect(body(r).message).toBe('An admin cannot remove their own profile')
  })

  it('never the last admin of the roster', async () => {
    profiles = { cleo: { stageRoles: ['admin'] }, ben: {} } // the roster knows no other admin than cleo
    const r = await members.remove('cleo', admin)
    expect(r.status).toBe(400)
    expect(body(r).message).toBe('At least one admin must remain')
  })
})

describe('resetting an admin PIN', () => {
  it('gives another admin a fresh 4-digit PIN to read out, and the old one stops', async () => {
    await accounts.setPin('cleo', '1234')
    const r = await members.resetPin('cleo', admin)
    expect(r.status).toBe(200)
    const pin = body(r).password as string
    expect(pin).toMatch(/^\d{4}$/)
    expect(await accounts.checkPin('cleo', pin)).toBe(true)
    expect(await accounts.checkPin('cleo', '1234')).toBe(false)
    expect(body(r).username).toBe('stageboard-band-cleo')
  })

  it('is 404 for a person that does not exist and 400 for one who is no admin', async () => {
    expect((await members.resetPin('ghost', admin)).status).toBe(404)
    expect((await members.resetPin('ben', admin)).status).toBe(400)
  })

  it('leaves the devices of that admin signed in', async () => {
    const cleo = body(await join.join('cleo', { code: CODE, password: '1234', deviceId: 'cleo-tab' }))
    await members.resetPin('cleo', admin)
    expect(await accounts.login(basic(cleo.username as string, cleo.password as string))).not.toBeNull()
  })
})

describe('an admin choosing their own PIN', () => {
  it('works from their own device: the PIN changes and the device gets a fresh login', async () => {
    const r = await members.setOwnPin('anna', { callerUsername: admin.adminUsername, callerPassword: admin.adminPassword, newPin: '9999', deviceId: 'anna-tab' })
    expect(r.status).toBe(200)
    expect(body(r)).toMatchObject({ username: admin.adminUsername, isAdmin: true })
    expect(await accounts.checkPin('anna', '9999')).toBe(true)
    expect(await accounts.checkPin('anna', '4711')).toBe(false)
  })

  it('is only for one\'s own account: another person\'s device, a plain member and a wrong password are 403', async () => {
    const cleo = body(await join.join('cleo', { code: CODE, password: '1234', deviceId: 'cleo-tab' }))
    expect((await members.setOwnPin('anna', { callerUsername: cleo.username as string, callerPassword: cleo.password as string, newPin: '9999', deviceId: 'x' })).status).toBe(403)
    expect((await members.setOwnPin('anna', { callerUsername: admin.adminUsername, callerPassword: 'wrong', newPin: '9999', deviceId: 'x' })).status).toBe(403)
    const ben = body(await join.join('ben', { code: CODE, deviceId: 'ben-tab' }))
    expect((await members.setOwnPin('ben', { callerUsername: ben.username as string, callerPassword: ben.password as string, newPin: '9999', deviceId: 'x' })).status).toBe(403)
  })
})

describe('a device taking on another person', () => {
  it('re-picking its own current person changes nothing and hands back the same login', async () => {
    const r = await members.activate('anna', { callerUsername: admin.adminUsername, callerPassword: admin.adminPassword, deviceId: 'anna-tab' })
    expect(r.status).toBe(200)
    expect(body(r)).toEqual({ username: admin.adminUsername, password: admin.adminPassword, isAdmin: true })
  })

  it('becoming a plain member needs nothing more than being in the band', async () => {
    const r = await members.activate('ben', { callerUsername: admin.adminUsername, callerPassword: admin.adminPassword, deviceId: 'anna-tab' })
    expect(r.status).toBe(201)
    expect(body(r)).toMatchObject({ username: 'stageboard-band-ben~anna-tab', isAdmin: false })
  })

  it('becoming an admin needs that admin\'s PIN, or the recovery suffix', async () => {
    const ben = body(await join.join('ben', { code: CODE, deviceId: 'ben-tab' }))
    const as = (password?: string) => members.activate('anna', { callerUsername: ben.username as string, callerPassword: ben.password as string, deviceId: 'ben-tab', ...(password ? { password } : {}) })
    expect((await as()).status).toBe(403)
    expect((await as('0000')).status).toBe(403)
    expect((await as('4711')).status).toBe(200)
    expect((await as('2943')).status).toBe(200)
  })

  it('re-picking oneself answers the rights the login has now - an admin promoting or demoting reaches the device (#978)', async () => {
    const ben = body(await join.join('ben', { code: CODE, deviceId: 'ben-tab' }))
    const again = () => members.activate('ben', { callerUsername: ben.username as string, callerPassword: ben.password as string, deviceId: 'ben-tab' })
    expect(body(await again())).toEqual({ username: ben.username, password: ben.password, isAdmin: false })
    profiles.ben = { stageRoles: ['drums', 'admin'] }
    expect((await members.setAdmin('ben', { ...admin, isAdmin: true })).status).toBe(204)
    expect(body(await again())).toEqual({ username: ben.username, password: ben.password, isAdmin: true })
    profiles.ben = { stageRoles: ['drums'] }
    expect((await members.setAdmin('ben', { ...admin, isAdmin: false })).status).toBe(204)
    expect(body(await again())).toEqual({ username: ben.username, password: ben.password, isAdmin: false })
  })

  it('is 403 for a caller that is not signed in to this band', async () => {
    expect((await members.activate('ben', { callerUsername: 'stageboard-other-p~d', callerPassword: 'x', deviceId: 'd' })).status).toBe(403)
    expect((await members.activate('ben', { callerUsername: admin.adminUsername, callerPassword: 'wrong', deviceId: 'd' })).status).toBe(403)
  })
})
