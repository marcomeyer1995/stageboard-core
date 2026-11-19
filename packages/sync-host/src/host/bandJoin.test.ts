import { beforeEach, describe, expect, it } from 'vitest'
import { createBandAccounts, type AccountDoc, type AccountStore, type BandAccounts } from './bandAccounts.js'
import { createBandJoin, type BandJoin } from './bandJoin.js'
import { createPinThrottle } from './pinThrottle.js'

const CODE = '57832943' // recovery suffix: 2943
const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

let accounts: BandAccounts
let join: BandJoin
let profiles: Record<string, { stageRoles?: string[] }>
beforeEach(() => {
  const docs = new Map<string, AccountDoc>()
  const store: AccountStore = {
    get: async (id) => docs.get(id) ?? null,
    put: async (doc) => void docs.set(doc._id, doc),
    list: async (prefix) => [...docs.values()].filter((d) => d._id.startsWith(prefix)),
  }
  accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000 })
  profiles = { anna: { stageRoles: ['admin'] }, ben: { stageRoles: ['drums'] } }
  join = createBandJoin({
    accounts,
    throttle: createPinThrottle({ maxFailures: 3, lockoutMs: 60_000, now: () => 0 }),
    accessCode: async () => CODE,
    profile: async (id) => profiles[id] ?? null,
  })
})

const body = (r: { body?: unknown }) => r.body as Record<string, unknown>

describe('joining as a member of the band', () => {
  it('needs the band code: a wrong one is 403, a missing person 404', async () => {
    expect((await join.join('ben', { code: 'nope', deviceId: 'd1' })).status).toBe(403)
    expect((await join.join('ghost', { code: CODE, deviceId: 'd1' })).status).toBe(404)
  })

  it('lets a non-admin in without any password - the first time 201, later 200 - with a login that works', async () => {
    const first = await join.join('ben', { code: CODE, deviceId: 'd1' })
    expect(first.status).toBe(201)
    expect(body(first)).toMatchObject({ username: 'stageboard-band-ben~d1', isAdmin: false })
    const again = await join.join('ben', { code: CODE, deviceId: 'd2' })
    expect(again.status).toBe(200)
    expect(await accounts.login(basic(body(first).username as string, body(first).password as string))).toEqual({ name: 'stageboard-band-ben~d1', roles: ['member'] })
  })

  it('ignores a password for a non-admin', async () => {
    expect((await join.join('ben', { code: CODE, password: 'whatever', deviceId: 'd1' })).status).toBe(201)
  })
})

describe('joining as an admin', () => {
  it('the first time needs a 4-digit PIN, which becomes that admin\'s PIN', async () => {
    expect((await join.join('anna', { code: CODE, deviceId: 'd1' })).status).toBe(400)
    expect((await join.join('anna', { code: CODE, password: 'abc', deviceId: 'd1' })).status).toBe(400)
    const made = await join.join('anna', { code: CODE, password: '4711', deviceId: 'd1' })
    expect(made.status).toBe(201)
    expect(body(made)).toMatchObject({ isAdmin: true })
    expect(await accounts.checkPin('anna', '4711')).toBe(true)
  })

  it('afterwards needs that PIN (or the recovery code): none 403, wrong 403, right 200', async () => {
    await join.join('anna', { code: CODE, password: '4711', deviceId: 'd1' })
    expect((await join.join('anna', { code: CODE, deviceId: 'd2' })).status).toBe(403)
    expect((await join.join('anna', { code: CODE, password: '0000', deviceId: 'd2' })).status).toBe(403)
    const ok = await join.join('anna', { code: CODE, password: '4711', deviceId: 'd2' })
    expect(ok.status).toBe(200)
    expect(body(ok)).toMatchObject({ isAdmin: true })
  })

  it('accepts the last 4 digits of the band code as the recovery way in - and does not change the PIN', async () => {
    await join.join('anna', { code: CODE, password: '4711', deviceId: 'd1' })
    expect((await join.join('anna', { code: CODE, password: '2943', deviceId: 'd2' })).status).toBe(200)
    expect(await accounts.checkPin('anna', '4711')).toBe(true)
  })

  it('locks after too many wrong PINs - 429 with the seconds to wait, even for the right PIN', async () => {
    await join.join('anna', { code: CODE, password: '4711', deviceId: 'd1' })
    for (let i = 0; i < 3; i++) await join.join('anna', { code: CODE, password: '0000', deviceId: 'd2' })
    const locked = await join.join('anna', { code: CODE, password: '4711', deviceId: 'd2' })
    expect(locked.status).toBe(429)
    expect(body(locked).retryAfterSeconds).toBe(60)
    expect(locked.headers).toEqual({ 'Retry-After': '60' })
  })
})

describe('checking an admin PIN without becoming anyone', () => {
  beforeEach(async () => {
    await join.join('anna', { code: CODE, password: '4711', deviceId: 'd1' })
  })

  it('is ok for the right PIN and for the recovery code, 403 for a wrong one, and for someone who is no admin', async () => {
    expect((await join.verifyPin({ profileId: 'anna', pin: '4711' })).status).toBe(200)
    expect((await join.verifyPin({ profileId: 'anna', pin: '2943' })).status).toBe(200)
    expect((await join.verifyPin({ profileId: 'anna', pin: '0000' })).status).toBe(403)
    expect((await join.verifyPin({ profileId: 'ben', pin: '2943' })).status).toBe(403)
    expect((await join.verifyPin({ profileId: 'ghost', pin: '2943' })).status).toBe(403)
  })

  it('shares its count of wrong tries with joining - one set of guesses, not two', async () => {
    await join.verifyPin({ profileId: 'anna', pin: '0000' })
    await join.verifyPin({ profileId: 'anna', pin: '0001' })
    await join.join('anna', { code: CODE, password: '0002', deviceId: 'd2' })
    expect((await join.verifyPin({ profileId: 'anna', pin: '4711' })).status).toBe(429)
  })
})
