import { pbkdf2Sync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import { createCouchHost, type Catalog } from 'sync-host/couch-host'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUser, ensureDb, getDoc, putDoc, putSecurity, type CouchConfig } from './couch.js'
import { bandsOfUserIds, HOST_ACCOUNTS_DOC_ID, hostAccountsOf, publishHostAccounts, watchHostAccounts, type HostAccountsDoc } from './hostAccounts.js'
import { deviceUsername, memberUsername, ROSTER_VALIDATOR_SOURCE, workspaceDbName } from './workspaceProvisioning.js'

PouchDB.plugin(MemoryAdapter)

let server: Server
let config: CouchConfig
const band = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const other = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const db = workspaceDbName(band)

beforeAll(async () => {
  const names = new Set<string>()
  const catalog: Catalog = { list: async () => [...names], add: async (x) => void names.add(x), remove: async (x) => void names.delete(x) }
  const host = createCouchHost({ storage: (name) => new PouchDB(`hostacc-${name}`, { adapter: 'memory' }), catalog, admin: { user: 'admin', password: 'secret' }, longpollMaxMs: 1500 })
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const body = raw.length === 0 ? undefined : JSON.parse(raw.toString('utf8'))
    const out = await host({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, authorization: req.headers.authorization })
    res.writeHead(out.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(out.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  config = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, user: 'admin', password: 'secret' }
  for (const id of [band, other]) {
    await ensureDb(config, workspaceDbName(id))
    await putSecurity(config, workspaceDbName(id), { admins: { names: [], roles: ['admin'] }, members: { names: [], roles: ['member', 'admin'] } })
    await putDoc(config, workspaceDbName(id), { _id: '_design/roster', validate_doc_update: ROSTER_VALIDATOR_SOURCE } as never)
  }
  await createUser(config, memberUsername(band, 'p-admin'), '1234', ['member', 'admin'])
  await createUser(config, deviceUsername(band, 'p-admin', 'redmi'), 'long-random-device-password-1', ['member', 'admin'])
  await createUser(config, deviceUsername(band, 'p-drums', 'fire'), 'long-random-device-password-2', ['member'])
  await createUser(config, deviceUsername(other, 'p-x', 'phone'), 'long-random-device-password-3', ['member'])
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const accountsOf = async () => ((await getDoc<HostAccountsDoc>(config, db, HOST_ACCOUNTS_DOC_ID))?.accounts ?? []).map((a) => a.name)

describe('host accounts (docs/25 §6b, C)', () => {
  it('only device logins of this band - never the PIN anchor, never another band', async () => {
    expect(await publishHostAccounts(config, db)).toBe(true)
    expect(await accountsOf()).toEqual([deviceUsername(band, 'p-admin', 'redmi'), deviceUsername(band, 'p-drums', 'fire')].sort())
    expect(await publishHostAccounts(config, db)).toBe(false)
  })

  it('the published key checks the device password the way a host would', async () => {
    const doc = await getDoc<HostAccountsDoc>(config, db, HOST_ACCOUNTS_DOC_ID)
    const redmi = doc!.accounts.find((a) => a.name.endsWith('~redmi'))!
    expect(redmi.roles).toEqual(['member', 'admin'])
    const derived = pbkdf2Sync('long-random-device-password-1', redmi.salt, redmi.iterations, 32, 'sha256').toString('hex')
    expect(derived).toBe(redmi.derived_key)
  })

  it('a band member (even an admin) cannot write the accounts - only the Stage-Server', async () => {
    const auth = 'Basic ' + Buffer.from(`${deviceUsername(band, 'p-admin', 'redmi')}:long-random-device-password-1`).toString('base64')
    const current = await getDoc<HostAccountsDoc>(config, db, HOST_ACCOUNTS_DOC_ID)
    const res = await fetch(`${config.url}/${db}/${HOST_ACCOUNTS_DOC_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ ...current, accounts: [] }),
    })
    expect(res.status).toBe(403)
    expect(await accountsOf()).toHaveLength(2)
  })

  it('a newly paired device appears on its own', async () => {
    const watcher = watchHostAccounts(config, { info: () => undefined, error: () => undefined }, { pollMs: 500, retryMs: 100 })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await createUser(config, deviceUsername(band, 'p-drums', 'phone'), 'long-random-device-password-4', ['member'])
      await expect.poll(accountsOf, { timeout: 5000, interval: 100 }).toContain(deviceUsername(band, 'p-drums', 'phone'))
    } finally {
      watcher.stop()
    }
  })
})

describe('hostAccountsOf / bandsOfUserIds', () => {
  it('skips users without a key, sorts by name', () => {
    const b = 'stageboard-x'
    const out = hostAccountsOf(b, [
      { _id: 'u2', name: `${b}-p~z`, salt: 's', derived_key: 'k', iterations: 10 },
      { _id: 'u1', name: `${b}-p~a`, salt: 's', derived_key: 'k' },
      { _id: 'u3', name: `${b}-p~nokey` },
      { _id: 'u4', name: `${b}-p`, salt: 's', derived_key: 'k' },
    ])
    expect(out.map((a) => a.name)).toEqual([`${b}-p~a`, `${b}-p~z`])
  })

  it('maps changed account ids to their band', () => {
    expect(bandsOfUserIds(['stageboard-a', 'stageboard-b'], ['org.couchdb.user:stageboard-b-p~d', '_design/_auth'])).toEqual(['stageboard-b'])
  })
})
