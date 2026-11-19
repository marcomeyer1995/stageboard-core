import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBandAccountsFor } from './bandAccounts.js'
import type { CouchConfig } from './couch.js'
import {
  deprovisionWorkspace,
  deviceUsername,
  getAccessCode,
  getOrCreateAccessCode,
  listWorkspaces,
  memberUsername,
  provisionWorkspace,
  renameWorkspace,
  setMasterMode,
  rotateAccessCode,
  WorkspaceAlreadyProvisionedError,
  workspaceDbName,
} from './workspaceProvisioning.js'

const config: CouchConfig = { url: 'http://localhost:5984', user: 'admin', password: 'admin' }

function stubFetch(responses: Array<Partial<Response>>) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workspaceDbName / memberUsername / deviceUsername', () => {
  it('derive the same stageboard-<id> name stage-pwa\'s localDbName() uses', () => {
    expect(workspaceDbName('band-a')).toBe('stageboard-band-a')
    expect(memberUsername('band-a', 'p1')).toBe('stageboard-band-a-p1')
  })

  it('deviceUsername appends the device id onto the profile\'s own anchor username', () => {
    expect(deviceUsername('band-a', 'p1', 'device-1')).toBe('stageboard-band-a-p1~device-1')
  })
})

describe('provisionWorkspace', () => {
  const founder = (workspaceId: string) => ({ accounts: createBandAccountsFor(config, { iterations: 1000 })(workspaceId), deviceId: 'dev-1' })

  it('creates the database, a role-based security doc, a static roster validator, the standing access-code doc, and the founder\'s own admin login as a document of the band', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ['stageboard-band-a'] }, // _all_dbs: the id is free
      { ok: true, status: 201 }, // ensureDb
      { ok: true, status: 200 }, // putSecurity
      { ok: true, status: 201 }, // putDoc (_design/roster)
      { ok: false, status: 404 }, // getDoc (workspace:access) - doesn't exist yet
      { ok: true, status: 201 }, // putDoc (workspace:access)
      { ok: false, status: 404 }, // getDoc (the founder's login) - doesn't exist yet
      { ok: true, status: 201 }, // putDoc (the founder's login)
    ])

    const result = await provisionWorkspace(config, 'band-c', 'p1', 'Band C', founder('band-c'))

    expect(result.username).toBe('stageboard-band-c-p1~dev-1')
    expect(result.password.length).toBeGreaterThan(10)

    const securityCall = fetchMock.mock.calls[2]
    expect(securityCall[0]).toBe('http://localhost:5984/stageboard-band-c/_security')
    expect(JSON.parse(securityCall[1].body)).toEqual({
      admins: { names: [], roles: ['admin'] },
      members: { names: [], roles: ['member', 'admin'] },
    })

    const designDocCall = fetchMock.mock.calls[3]
    expect(designDocCall[0]).toBe('http://localhost:5984/stageboard-band-c/_design%2Froster')
    const designDocBody = JSON.parse(designDocCall[1].body)
    expect(designDocBody._id).toBe('_design/roster')
    expect(designDocBody.validate_doc_update).toContain('profiles:')
    // Role-based, not one hardcoded username - never needs to change as members are added/removed/promoted.
    expect(designDocBody.validate_doc_update).toContain('userCtx.roles')
    expect(designDocBody.validate_doc_update).toContain("indexOf('admin')")

    const accessCodeCall = fetchMock.mock.calls[5]
    expect(accessCodeCall[0]).toBe('http://localhost:5984/stageboard-band-c/workspace%3Aaccess')
    expect(JSON.parse(accessCodeCall[1].body)).toEqual({ _id: 'workspace:access', code: expect.stringMatching(/^\d{8}$/), name: 'Band C' })

    // The founder's login is a document of the band: a verifier and the admin role, never the password.
    const loginCall = fetchMock.mock.calls[7]
    expect(loginCall[0]).toBe('http://localhost:5984/stageboard-band-c/account%3Astageboard-band-c-p1~dev-1')
    const login = JSON.parse(loginCall[1].body)
    expect(login).toMatchObject({ roles: ['member', 'admin'], pbkdf2_prf: 'sha256' })
    expect(JSON.stringify(login)).not.toContain(result.password)
  })

  it('throws WorkspaceAlreadyProvisionedError for a band that already has its database - without touching anything', async () => {
    const fetchMock = stubFetch([{ ok: true, status: 200, json: async () => ['stageboard-band-a'] }])

    await expect(provisionWorkspace(config, 'band-a', 'p1', 'Band A', founder('band-a'))).rejects.toThrow(WorkspaceAlreadyProvisionedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('access code (2026-09-01 WiFi-style redesign)', () => {
  it('getAccessCode returns null for a workspace with no access-code doc yet', async () => {
    stubFetch([{ ok: false, status: 404 }])
    expect(await getAccessCode(config, 'band-c')).toBeNull()
  })

  it('getAccessCode reads the existing code and name', async () => {
    stubFetch([{ ok: true, status: 200, json: async () => ({ _id: 'workspace:access', code: '12345678', name: 'Band C' }) }])
    expect(await getAccessCode(config, 'band-c')).toEqual({ code: '12345678', name: 'Band C' })
  })

  it('getOrCreateAccessCode returns the existing doc untouched when one already exists', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', code: '12345678', name: 'Band C' }) },
    ])

    const result = await getOrCreateAccessCode(config, 'band-c', 'fallback-name')

    expect(result).toEqual({ code: '12345678', name: 'Band C' })
    expect(fetchMock).toHaveBeenCalledTimes(1) // just the read - no write
  })

  it('getOrCreateAccessCode lazily creates one with the fallback name when none exists yet - the pre-existing-workspace backfill path', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // getAccessCode -> missing
      { ok: false, status: 404 }, // writeAccessCodeDoc's own getDoc (for _rev) -> still missing
      { ok: true, status: 201 }, // putDoc (workspace:access)
    ])

    const result = await getOrCreateAccessCode(config, 'band-c', 'band-c')

    expect(result.name).toBe('band-c')
    expect(result.code).toMatch(/^\d{8}$/)
    const putCall = fetchMock.mock.calls[2]
    expect(JSON.parse(putCall[1].body)).toEqual({ _id: 'workspace:access', code: result.code, name: 'band-c' })
  })

  it('rotateAccessCode keeps the existing name but generates a fresh code, in one fetch-then-put round trip', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', _rev: '1-abc', code: '11111111', name: 'Band C' }) }, // putDocWithRetry's getDoc
      { ok: true, status: 201 }, // putDoc with new code
    ])

    const newCode = await rotateAccessCode(config, 'band-c')

    expect(newCode).toMatch(/^\d{8}$/)
    expect(newCode).not.toBe('11111111')
    expect(fetchMock.mock.calls.length).toBe(2)
    const putCall = fetchMock.mock.calls[1]
    expect(JSON.parse(putCall[1].body)).toEqual({ _id: 'workspace:access', _rev: '1-abc', code: newCode, name: 'Band C' })
  })

  it('renameWorkspace keeps the existing code but changes the name (#58), in one fetch-then-put round trip', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', _rev: '1-abc', code: '11111111', name: 'Band C' }) }, // putDocWithRetry's getDoc
      { ok: true, status: 201 }, // putDoc with new name
    ])

    await renameWorkspace(config, 'band-c', 'The Renamed Band')

    expect(fetchMock.mock.calls.length).toBe(2)
    const putCall = fetchMock.mock.calls[1]
    expect(JSON.parse(putCall[1].body)).toEqual({ _id: 'workspace:access', _rev: '1-abc', code: '11111111', name: 'The Renamed Band' })
  })

  it('renameWorkspace keeps the master mode (#85) - it lives on the same doc', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', _rev: '1-abc', code: '11111111', name: 'Band C', masterMode: 'account' }) },
      { ok: true, status: 201 },
    ])
    await renameWorkspace(config, 'band-c', 'Neu')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ name: 'Neu', masterMode: 'account' })
  })

  it('setMasterMode writes the mode and keeps code and name (#85)', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', _rev: '2-x', code: '22222222', name: 'Band C' }) },
      { ok: true, status: 201 },
    ])
    await setMasterMode(config, 'band-c', 'account')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ _id: 'workspace:access', _rev: '2-x', code: '22222222', name: 'Band C', masterMode: 'account' })
  })

  it('renameWorkspace backfills a fresh access-code doc for a workspace that never had one', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // putDocWithRetry's getDoc -> missing
      { ok: true, status: 201 }, // putDoc (workspace:access)
    ])

    await renameWorkspace(config, 'band-c', 'Fresh Name')

    expect(fetchMock.mock.calls.length).toBe(2)
    const putCall = fetchMock.mock.calls[1]
    const body = JSON.parse(putCall[1].body)
    expect(body).toMatchObject({ _id: 'workspace:access', name: 'Fresh Name' })
    expect(body.code).toMatch(/^\d{8}$/)
  })

  it('renameWorkspace retries once on a write conflict, re-reading a fresh _rev', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', _rev: '1-abc', code: '11111111', name: 'Band C' }) }, // 1st getDoc
      { ok: false, status: 409 }, // 1st put -> conflict (another writer won the race)
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', _rev: '2-def', code: '11111111', name: 'Band C' }) }, // 2nd getDoc, fresh _rev
      { ok: true, status: 201 }, // 2nd put succeeds
    ])

    await renameWorkspace(config, 'band-c', 'The Renamed Band')

    expect(fetchMock.mock.calls.length).toBe(4)
    const putCall = fetchMock.mock.calls[3]
    expect(JSON.parse(putCall[1].body)).toEqual({ _id: 'workspace:access', _rev: '2-def', code: '11111111', name: 'The Renamed Band' })
  })

  it('listWorkspaces filters _all_dbs to stageboard-* databases and resolves each one\'s display name', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ['_users', '_replicator', 'stageboard-band-a', 'stageboard-band-c'] }, // _all_dbs
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', code: '11111111', name: 'Band A' }) }, // band-a access code
      { ok: true, status: 200, json: async () => ({ _id: 'workspace:access', code: '22222222', name: 'Band C' }) }, // band-c access code
    ])

    const workspaces = await listWorkspaces(config)

    expect(workspaces).toEqual([
      { workspaceId: 'band-a', workspaceName: 'Band A' },
      { workspaceId: 'band-c', workspaceName: 'Band C' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('deprovisionWorkspace', () => {
  const withStateDir = async (run: (dir: string) => Promise<void>) => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'deprovision-'))
    const before = process.env.STAGEBOARD_STATE_DIR
    process.env.STAGEBOARD_STATE_DIR = dir
    try {
      await run(dir)
    } finally {
      if (before === undefined) delete process.env.STAGEBOARD_STATE_DIR
      else process.env.STAGEBOARD_STATE_DIR = before
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('keeps a copy, then deletes the database - the logins and PIN verifiers are documents of it, so they go with it', async () => {
    await withStateDir(async (dir) => {
      const fetchMock = stubFetch([
        { ok: true, status: 200, json: async () => ({ rows: [{ doc: { _id: 'profiles:p1', _rev: '1-a' } }] }) }, // _all_docs (the copy)
        { ok: true, status: 200, json: async () => ({ members: {} }) }, // _security (the copy)
        { ok: true, status: 200 }, // deleteDb
      ])

      await deprovisionWorkspace(config, 'band-c')

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[2][0]).toBe('http://localhost:5984/stageboard-band-c')
      expect(fetchMock.mock.calls[2][1].method).toBe('DELETE')
      const { readdirSync } = await import('node:fs')
      expect(readdirSync(`${dir}/deleted-bands`)).toHaveLength(1)
    })
  })

  it('does not delete a band whose copy could not be made', async () => {
    await withStateDir(async () => {
      const fetchMock = stubFetch([{ ok: false, status: 500 }])
      await expect(deprovisionWorkspace(config, 'band-c')).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('tolerates an already-gone database', async () => {
    await withStateDir(async () => {
      stubFetch([{ ok: false, status: 404 }, { ok: false, status: 404 }]) // no copy to make; deleteDb
      await expect(deprovisionWorkspace(config, 'band-c')).resolves.toBeUndefined()
    })
  })
})
