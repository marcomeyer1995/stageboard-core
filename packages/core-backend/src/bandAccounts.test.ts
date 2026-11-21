import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBandAccountsFor } from './bandAccounts.js'

const config = { url: 'http://db', user: 'admin', password: 'pw' }
const basic = (user: string, password: string) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

/** A database with documents and revisions, the way the host answers: what the adapter really talks to. */
let docs: Map<string, Record<string, unknown>>
let seenAuth: Set<string>
beforeEach(() => {
  docs = new Map()
  seenAuth = new Set()
  let rev = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string>
      seenAuth.add(headers.Authorization ?? '')
      const path = decodeURIComponent(new URL(url).pathname)
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
      const all = path.match(/^\/(stageboard-[^/]+)\/_all_docs$/)
      if (all) {
        const q = new URL(url).searchParams
        const start = JSON.parse(q.get('startkey') ?? '""') as string
        const end = JSON.parse(q.get('endkey') ?? '"\\uffff"') as string
        return json(200, { rows: [...docs.entries()].filter(([id]) => id >= start && id <= end).map(([id, doc]) => ({ id, doc })) })
      }
      const one = path.match(/^\/(stageboard-[^/]+)\/(.+)$/)
      if (!one) return json(404, {})
      const id = one[2]!
      if ((init.method ?? 'GET') === 'GET') return docs.has(id) ? json(200, docs.get(id)) : json(404, { error: 'not_found' })
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      const old = docs.get(id)
      if (old && old._rev !== body._rev) return json(409, { error: 'conflict' })
      docs.set(id, { ...body, _rev: `${++rev}-x` })
      return json(201, { ok: true })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('the band accounts as the Host holds them (documents of the band database, over HTTP)', () => {
  it('writes a login as the server admin, reads it back and lets the device in', async () => {
    const accountsFor = createBandAccountsFor(config, { iterations: 1000 })
    const { username, password } = await accountsFor('band').provisionDevice('p1', 'd1', false)
    expect(docs.has(`account:${username}`)).toBe(true)
    expect(seenAuth).toEqual(new Set([basic('admin', 'pw')]))
    expect(await accountsFor('band').login(basic(username, password))).toEqual({ name: username, roles: ['member'] })
  })

  it('replaces a document it wrote before (a reissue) without a conflict', async () => {
    const accounts = createBandAccountsFor(config, { iterations: 1000 })('band')
    const first = await accounts.provisionDevice('p1', 'd1', false)
    const again = await accounts.provisionDevice('p1', 'd1', false)
    expect(await accounts.login(basic(first.username, first.password))).toBeNull()
    expect(await accounts.login(basic(again.username, again.password))).not.toBeNull()
  })

  it('is one instance per band - the remembered logins of one band are never another band\'s', async () => {
    const accountsFor = createBandAccountsFor(config, { iterations: 1000 })
    expect(accountsFor('band')).toBe(accountsFor('band'))
    const a = await accountsFor('band').provisionDevice('p1', 'd1', false)
    expect(await accountsFor('other').login(basic(a.username, a.password))).toBeNull()
  })

  it('says null (not an error) for a band whose database does not exist', async () => {
    const accountsFor = createBandAccountsFor(config, { iterations: 1000 })
    expect(await accountsFor('nobody').login(basic('stageboard-nobody-p~d', 'x'))).toBeNull()
  })

  it('passes a database error on instead of reading it as "no such account"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const accounts = createBandAccountsFor(config, { iterations: 1000 })('band')
    await expect(accounts.hasPin('p1')).rejects.toThrow()
    await expect(accounts.login(basic('stageboard-band-p1~d', 'x'))).rejects.toThrow()
  })

  it('gives the host role to a device the band lists as a host, as the host asks for the list', async () => {
    const accountsFor = createBandAccountsFor(config, { iterations: 1000, hostDevices: async (workspaceId) => (workspaceId === 'band' ? ['tablet'] : []) })
    const tablet = await accountsFor('band').provisionDevice('p1', 'tablet', false)
    expect((await accountsFor('band').login(basic(tablet.username, tablet.password)))?.roles).toEqual(['member', 'host'])
    const elsewhere = await accountsFor('other').provisionDevice('p1', 'tablet', false) // listed in no other band
    expect((await accountsFor('other').login(basic(elsewhere.username, elsewhere.password)))?.roles).toEqual(['member'])
  })
})
