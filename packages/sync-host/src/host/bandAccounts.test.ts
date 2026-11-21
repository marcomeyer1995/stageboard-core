import { beforeEach, describe, expect, it } from 'vitest'
import { createBandAccounts, deviceUsername, memberUsername, type AccountDoc, type AccountStore, type BandAccounts } from './bandAccounts.js'

/** The band database as the accounts see it: documents by id (what replication carries between hosts). */
function memoryStore(): AccountStore & { docs: Map<string, AccountDoc> } {
  const docs = new Map<string, AccountDoc>()
  return {
    docs,
    get: async (id) => docs.get(id) ?? null,
    put: async (doc) => void docs.set(doc._id, doc),
    list: async (prefix) => [...docs.values()].filter((d) => d._id.startsWith(prefix)),
  }
}

const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

let store: ReturnType<typeof memoryStore>
let accounts: BandAccounts
beforeEach(() => {
  store = memoryStore()
  accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000 })
})

describe('names', () => {
  it('are the ones every device derives on its own: band, person, device', () => {
    expect(memberUsername('band', 'p1')).toBe('stageboard-band-p1')
    expect(deviceUsername('band', 'p1', 'd1')).toBe('stageboard-band-p1~d1')
  })
})

describe('a device login', () => {
  it('is made with a random password, kept only as a PBKDF2 verifier, and lets the device in with its roles', async () => {
    const { username, password } = await accounts.provisionDevice('p1', 'd1', false)
    expect(username).toBe('stageboard-band-p1~d1')
    expect(password.length).toBeGreaterThanOrEqual(24)
    const stored = JSON.stringify([...store.docs.values()])
    expect(stored).not.toContain(password)
    expect(await accounts.login(basic(username, password))).toEqual({ name: username, roles: ['member'] })
  })

  it('gives an admin device the admin role', async () => {
    const { username, password } = await accounts.provisionDevice('p1', 'd1', true)
    expect(await accounts.login(basic(username, password))).toEqual({ name: username, roles: ['member', 'admin'] })
  })

  it('is refused for a wrong password, an unknown name, a login of another band, and no login at all', async () => {
    const { username, password } = await accounts.provisionDevice('p1', 'd1', false)
    expect(await accounts.login(basic(username, 'wrong'))).toBeNull()
    expect(await accounts.login(basic('stageboard-band-p1~ghost', password))).toBeNull()
    expect(await accounts.login(basic('stageboard-other-p1~d1', password))).toBeNull()
    expect(await accounts.login(undefined)).toBeNull()
  })

  it('is reissued for the same device with a new password - the old one stops, other devices keep theirs', async () => {
    const first = await accounts.provisionDevice('p1', 'd1', false)
    const other = await accounts.provisionDevice('p1', 'd2', false)
    const again = await accounts.provisionDevice('p1', 'd1', false)
    expect(again.password).not.toBe(first.password)
    expect(await accounts.login(basic(first.username, first.password))).toBeNull()
    expect(await accounts.login(basic(again.username, again.password))).not.toBeNull()
    expect(await accounts.login(basic(other.username, other.password))).not.toBeNull()
  })

  it('is one document of its own, so two hosts never edit the same document', async () => {
    await accounts.provisionDevice('p1', 'd1', false)
    await accounts.provisionDevice('p1', 'd2', false)
    expect([...store.docs.keys()].sort()).toEqual(['account:stageboard-band-p1~d1', 'account:stageboard-band-p1~d2'])
  })

  it('also works with a login made by an older the database (SHA-1)', async () => {
    const { pbkdf2Sync } = await import('node:crypto')
    const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    store.docs.set('account:stageboard-band-p1~old', {
      _id: 'account:stageboard-band-p1~old',
      name: 'stageboard-band-p1~old',
      roles: ['member'],
      iterations: 1000,
      salt,
      derived_key: pbkdf2Sync('secret', salt, 1000, 20, 'sha1').toString('hex'),
      pbkdf2_prf: 'sha',
    })
    expect(await accounts.login(basic('stageboard-band-p1~old', 'secret'))).not.toBeNull()
  })
})

describe('an admin PIN', () => {
  it('is kept as a verifier only, and only the right PIN passes', async () => {
    await accounts.setPin('p1', '4711')
    // Exact JSON strings, not a substring search: the salt and the hash are random hex and contain "4711" by chance about
    // once in 500 runs - what must never appear is the PIN as a value of its own.
    expect(JSON.stringify([...store.docs.values()])).not.toContain('"4711"')
    expect(await accounts.checkPin('p1', '4711')).toBe(true)
    expect(await accounts.checkPin('p1', '4712')).toBe(false)
  })

  it('is false for a person without one, and for another person\'s PIN', async () => {
    await accounts.setPin('p1', '4711')
    expect(await accounts.checkPin('p2', '4711')).toBe(false)
  })

  it('can be set again - the old PIN stops', async () => {
    await accounts.setPin('p1', '4711')
    await accounts.setPin('p1', '1234')
    expect(await accounts.checkPin('p1', '4711')).toBe(false)
    expect(await accounts.checkPin('p1', '1234')).toBe(true)
  })

  it('is kept apart from the device logins: it never lets a device in', async () => {
    await accounts.setPin('p1', '4711')
    expect(await accounts.login(basic('stageboard-band-p1', '4711'))).toBeNull()
  })
})

describe('taking a person out', () => {
  it('revokes every device login of that person and the PIN - and leaves everybody else alone', async () => {
    const a1 = await accounts.provisionDevice('p1', 'd1', true)
    const a2 = await accounts.provisionDevice('p1', 'd2', true)
    const b = await accounts.provisionDevice('p2', 'd3', false)
    await accounts.setPin('p1', '4711')
    await accounts.removeMember('p1')
    expect(await accounts.login(basic(a1.username, a1.password))).toBeNull()
    expect(await accounts.login(basic(a2.username, a2.password))).toBeNull()
    expect(await accounts.checkPin('p1', '4711')).toBe(false)
    expect(await accounts.login(basic(b.username, b.password))).not.toBeNull()
  })

  it('keeps a revoked login as a document (so it replicates), without its verifier', async () => {
    const a = await accounts.provisionDevice('p1', 'd1', false)
    await accounts.removeMember('p1')
    const doc = store.docs.get(`account:${a.username}`)!
    expect(doc.revoked).toBe(true)
    expect(doc.derived_key).toBeUndefined()
  })

  it('lets the same device be let in again later - a new login, not the old one', async () => {
    const first = await accounts.provisionDevice('p1', 'd1', false)
    await accounts.removeMember('p1')
    const again = await accounts.provisionDevice('p1', 'd1', false)
    expect(await accounts.login(basic(again.username, again.password))).not.toBeNull()
    expect(await accounts.login(basic(first.username, first.password))).toBeNull()
  })
})

describe('a person becoming admin or not', () => {
  it('changes the roles of every device of that person at once', async () => {
    const d1 = await accounts.provisionDevice('p1', 'd1', false)
    const d2 = await accounts.provisionDevice('p1', 'd2', false)
    await accounts.setAdmin('p1', true)
    expect((await accounts.login(basic(d1.username, d1.password)))?.roles).toEqual(['member', 'admin'])
    expect((await accounts.login(basic(d2.username, d2.password)))?.roles).toEqual(['member', 'admin'])
    await accounts.setAdmin('p1', false)
    expect((await accounts.login(basic(d1.username, d1.password)))?.roles).toEqual(['member'])
  })
})

describe('what a login check remembers', () => {
  it('is only for a short while, so a device removed on another host stops working soon', async () => {
    let t = 0
    const timed = createBandAccounts({ store, workspaceId: 'band', iterations: 1000, rememberMs: 1000, now: () => t })
    const other = createBandAccounts({ store, workspaceId: 'band', iterations: 1000 }) // another host, same band
    const a = await timed.provisionDevice('p1', 'd1', false)
    const auth = basic(a.username, a.password)
    expect(await timed.login(auth)).not.toBeNull()
    await other.removeMember('p1')
    expect(await timed.login(auth)).not.toBeNull() // still remembered - it cannot know yet
    t = 1500
    expect(await timed.login(auth)).toBeNull()
  })

  it('is forgotten at once for what this host changes itself', async () => {
    const a = await accounts.provisionDevice('p1', 'd1', true)
    const auth = basic(a.username, a.password)
    expect(await accounts.login(auth)).not.toBeNull()
    await accounts.setAdmin('p1', false)
    expect((await accounts.login(auth))?.roles).toEqual(['member'])
    await accounts.removeMember('p1')
    expect(await accounts.login(auth)).toBeNull()
  })
})

describe('the host role', () => {
  const asHosts = (hostIds: string[]) => createBandAccounts({ store, workspaceId: 'band', iterations: 1000, hostDevices: async () => hostIds })

  it('is given to the login of a device the band lists as a host - on top of its roles, never stored', async () => {
    const accounts = asHosts(['tablet'])
    const tablet = await accounts.provisionDevice('p1', 'tablet', false)
    const other = await accounts.provisionDevice('p1', 'fire', false)
    expect(await accounts.login(basic(tablet.username, tablet.password))).toEqual({ name: tablet.username, roles: ['member', 'host'] })
    expect((await accounts.login(basic(other.username, other.password)))?.roles).toEqual(['member'])
    expect(store.docs.get(`account:${tablet.username}`)?.roles).toEqual(['member'])
  })

  it('comes with the admin role as well, for an admin who is on a host device', async () => {
    const accounts = asHosts(['laptop'])
    const admin = await accounts.provisionDevice('p2', 'laptop', true)
    expect((await accounts.login(basic(admin.username, admin.password)))?.roles).toEqual(['member', 'admin', 'host'])
  })

  it('goes when the device is no longer listed (after the remembered login has run out)', async () => {
    let t = 0
    let listed = ['tablet']
    const accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000, rememberMs: 1000, now: () => t, hostDevices: async () => listed })
    const tablet = await accounts.provisionDevice('p1', 'tablet', false)
    expect((await accounts.login(basic(tablet.username, tablet.password)))?.roles).toContain('host')
    listed = []
    t = 1500
    expect((await accounts.login(basic(tablet.username, tablet.password)))?.roles).toEqual(['member'])
  })

  it('is not given to a revoked login, nor by a device id that only ends alike', async () => {
    const accounts = asHosts(['tablet'])
    const fake = await accounts.provisionDevice('p1', 'my-tablet', false) // ends in "tablet", is not "tablet"
    expect((await accounts.login(basic(fake.username, fake.password)))?.roles).toEqual(['member'])
    const real = await accounts.provisionDevice('p1', 'tablet', false)
    await accounts.removeMember('p1')
    expect(await accounts.login(basic(real.username, real.password))).toBeNull()
  })

  it('does not stop a login when the list cannot be read - it only has no host role then', async () => {
    const accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000, hostDevices: async () => { throw new Error('no settings yet') } })
    const tablet = await accounts.provisionDevice('p1', 'tablet', false)
    expect((await accounts.login(basic(tablet.username, tablet.password)))?.roles).toEqual(['member'])
  })

  it('is not there at all when the band has no list of hosts to ask', async () => {
    const accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000 })
    const tablet = await accounts.provisionDevice('p1', 'tablet', false)
    expect((await accounts.login(basic(tablet.username, tablet.password)))?.roles).toEqual(['member'])
  })
})

describe('the remembered logins do not grow without end', () => {
  it('forget the ones that ran out, so reissued logins that nobody uses again leave nothing behind', async () => {
    let t = 0
    const accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000, rememberMs: 1000, now: () => t, maxRemembered: 5 })
    const logins: { username: string; password: string }[] = []
    for (let i = 0; i < 20; i++) {
      const device = await accounts.provisionDevice('p1', `d${i}`, false)
      logins.push(device)
      expect(await accounts.login(basic(device.username, device.password))).not.toBeNull()
      t += 400 // each is remembered for 1000 ms: only the last few are still good
    }
    expect(accounts.rememberedCount()).toBeLessThanOrEqual(5)
  })

  it('never drop one that is still good to make room - it is only the newest of a full cache that has to wait for its turn', async () => {
    let t = 0
    const accounts = createBandAccounts({ store, workspaceId: 'band', iterations: 1000, rememberMs: 60_000, now: () => t, maxRemembered: 3 })
    for (let i = 0; i < 6; i++) {
      const device = await accounts.provisionDevice('p1', `d${i}`, false)
      expect(await accounts.login(basic(device.username, device.password))).not.toBeNull() // still answers, remembered or not
    }
    expect(accounts.rememberedCount()).toBeLessThanOrEqual(3)
  })
})
