import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CouchConfig } from './couch.js'
import {
  deprovisionMember,
  deprovisionWorkspace,
  deviceUsername,
  generateMemberPassword,
  getAccessCode,
  getOrCreateAccessCode,
  listWorkspaces,
  memberUsername,
  provisionDevice,
  provisionMember,
  provisionWorkspace,
  renameWorkspace,
  rotateAccessCode,
  setMemberAdmin,
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
  it('creates the founder\'s account (member+admin roles), the database, a role-based security doc, a static roster validator, and the standing access-code doc', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // userExists
      { ok: true, status: 201 }, // createUser (founder)
      { ok: true, status: 201 }, // ensureDb
      { ok: true, status: 200 }, // putSecurity
      { ok: true, status: 201 }, // putDoc (_design/roster)
      { ok: false, status: 404 }, // getDoc (workspace:access) - doesn't exist yet
      { ok: true, status: 201 }, // putDoc (workspace:access)
    ])

    const result = await provisionWorkspace(config, 'band-c', 'p1', 'Band C')

    expect(result.username).toBe('stageboard-band-c-p1')
    expect(result.password.length).toBeGreaterThan(10)

    const createUserCall = fetchMock.mock.calls[1]
    expect(JSON.parse(createUserCall[1].body)).toMatchObject({ roles: ['member', 'admin'] })

    const securityCall = fetchMock.mock.calls[3]
    expect(securityCall[0]).toBe('http://localhost:5984/stageboard-band-c/_security')
    expect(JSON.parse(securityCall[1].body)).toEqual({
      admins: { names: [], roles: ['admin'] },
      members: { names: [], roles: ['member', 'admin'] },
    })

    const designDocCall = fetchMock.mock.calls[4]
    expect(designDocCall[0]).toBe('http://localhost:5984/stageboard-band-c/_design%2Froster')
    const designDocBody = JSON.parse(designDocCall[1].body)
    expect(designDocBody._id).toBe('_design/roster')
    expect(designDocBody.validate_doc_update).toContain('profiles:')
    // Role-based now, not one hardcoded username - never needs to change as members are
    // added/removed/promoted.
    expect(designDocBody.validate_doc_update).toContain('userCtx.roles')
    expect(designDocBody.validate_doc_update).toContain("indexOf('admin')")

    const accessCodeCall = fetchMock.mock.calls[6]
    expect(accessCodeCall[0]).toBe('http://localhost:5984/stageboard-band-c/workspace%3Aaccess')
    const accessCodeBody = JSON.parse(accessCodeCall[1].body)
    expect(accessCodeBody).toEqual({ _id: 'workspace:access', code: expect.stringMatching(/^\d{8}$/), name: 'Band C' })
  })

  it('throws WorkspaceAlreadyProvisionedError without touching the db, security doc, or access code', async () => {
    const fetchMock = stubFetch([{ ok: true, status: 200, json: async () => ({ name: 'stageboard-band-a-p1' }) }])

    await expect(provisionWorkspace(config, 'band-a', 'p1', 'Band A')).rejects.toThrow(WorkspaceAlreadyProvisionedError)
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

describe('provisionMember / setMemberAdmin / deprovisionMember', () => {
  it('provisionMember creates a user with just the member role by default', async () => {
    const fetchMock = stubFetch([{ ok: true, status: 201 }])

    const result = await provisionMember(config, 'band-c', 'p2', 'a-password', false)

    expect(result).toEqual({ username: 'stageboard-band-c-p2', password: 'a-password' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ roles: ['member'] })
  })

  it('provisionMember creates a user with member+admin roles when isAdmin is true', async () => {
    const fetchMock = stubFetch([{ ok: true, status: 201 }])

    await provisionMember(config, 'band-c', 'p2', 'a-password', true)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ roles: ['member', 'admin'] })
  })

  it('generateMemberPassword returns a long random string', () => {
    expect(generateMemberPassword().length).toBeGreaterThan(10)
    expect(generateMemberPassword()).not.toBe(generateMemberPassword())
  })

  it('setMemberAdmin fetches the anchor doc then PUTs it back with updated roles, preserving everything else, when the profile has no device accounts yet', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:x', _rev: '1-abc', name: 'x', type: 'user', roles: ['member'] }) },
      { ok: true, status: 200 },
      { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames -> none
    ])

    await setMemberAdmin(config, 'band-c', 'p2', true)

    const putCall = fetchMock.mock.calls[1]
    expect(JSON.parse(putCall[1].body)).toEqual({
      _id: 'org.couchdb.user:x',
      _rev: '1-abc',
      name: 'x',
      type: 'user',
      roles: ['member', 'admin'],
    })
    expect(fetchMock.mock.calls[2][0]).toContain('/_users/_all_docs')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('setMemberAdmin also updates every device account already minted for that profile - a promotion/demotion must take effect on every already-logged-in tablet', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:stageboard-band-c-p2', _rev: '1-abc', name: 'stageboard-band-c-p2', type: 'user', roles: ['member', 'admin'] }) }, // anchor GET
      { ok: true, status: 200 }, // anchor PUT
      {
        ok: true,
        status: 200,
        json: async () => ({ rows: [{ doc: { _id: 'org.couchdb.user:stageboard-band-c-p2~device-1', name: 'stageboard-band-c-p2~device-1' } }] }),
      }, // listDeviceUsernames
      {
        ok: true,
        status: 200,
        json: async () => ({ _id: 'org.couchdb.user:stageboard-band-c-p2~device-1', _rev: '1-dev', name: 'stageboard-band-c-p2~device-1', type: 'user', roles: ['member', 'admin'] }),
      }, // device GET
      { ok: true, status: 200 }, // device PUT
    ])

    await setMemberAdmin(config, 'band-c', 'p2', false)

    const devicePut = fetchMock.mock.calls[4]
    expect(devicePut[0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2~device-1')
    expect(JSON.parse(devicePut[1].body)).toMatchObject({ roles: ['member'] })
  })

  it('deprovisionMember deletes the anchor and every device account it ever minted', async () => {
    const fetchMock = stubFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({ rows: [{ doc: { _id: 'org.couchdb.user:stageboard-band-c-p2~device-1', name: 'stageboard-band-c-p2~device-1' } }] }),
      }, // listDeviceUsernames
      { ok: true, status: 200, json: async () => ({ _rev: '1-p2' }) }, // anchor GET
      { ok: true, status: 200 }, // anchor DELETE
      { ok: true, status: 200, json: async () => ({ _rev: '1-dev' }) }, // device GET
      { ok: true, status: 200 }, // device DELETE
    ])

    await deprovisionMember(config, 'band-c', 'p2')

    expect(fetchMock.mock.calls[0][0]).toContain('/_users/_all_docs')
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2')
    expect(fetchMock.mock.calls[3][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2~device-1')
  })

  it('deprovisionMember tolerates a profile with no device accounts at all', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames -> none
      { ok: true, status: 200, json: async () => ({ _rev: '1-p2' }) }, // anchor GET
      { ok: true, status: 200 }, // anchor DELETE
    ])

    await deprovisionMember(config, 'band-c', 'p2')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('provisionDevice', () => {
  it('creates a fresh device account (member role) when this device has none yet', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // userExists -> no
      { ok: true, status: 201 }, // createUser
    ])

    const result = await provisionDevice(config, 'band-c', 'p2', 'device-1', false)

    expect(result.username).toBe('stageboard-band-c-p2~device-1')
    expect(result.password.length).toBeGreaterThan(10)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ roles: ['member'] })
  })

  it('creates an admin-rostered device account with member+admin roles', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // userExists -> no
      { ok: true, status: 201 }, // createUser
    ])

    await provisionDevice(config, 'band-c', 'p2', 'device-1', true)

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ roles: ['member', 'admin'] })
  })

  it('reissues just this device\'s own account when it already exists, never creating a duplicate', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200 }, // userExists -> yes
      {
        ok: true,
        status: 200,
        json: async () => ({ _id: 'org.couchdb.user:stageboard-band-c-p2~device-1', _rev: '1-abc', name: 'stageboard-band-c-p2~device-1', type: 'user', roles: ['member'] }),
      }, // resetUserPassword's GET
      { ok: true, status: 200 }, // resetUserPassword's PUT
    ])

    const result = await provisionDevice(config, 'band-c', 'p2', 'device-1', false)

    expect(result.username).toBe('stageboard-band-c-p2~device-1')
    expect(fetchMock.mock.calls[2][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2~device-1')
  })
})

describe('deprovisionWorkspace', () => {
  it('reads the roster first, deletes the database, then every member\'s account (anchor + any device accounts)', async () => {
    const fetchMock = stubFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({
          rows: [
            { doc: { _id: 'profiles:p1', id: 'p1' } },
            { doc: { _id: 'profiles:p2', id: 'p2' } },
          ],
        }),
      }, // allDocs (roster)
      { ok: true, status: 200 }, // deleteDb
      { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames(p1) -> none
      { ok: true, status: 200, json: async () => ({ _rev: '1-p1' }) }, // deleteUser(p1) GET
      { ok: true, status: 200 }, // deleteUser(p1) DELETE
      { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames(p2) -> none
      { ok: true, status: 200, json: async () => ({ _rev: '1-p2' }) }, // deleteUser(p2) GET
      { ok: true, status: 200 }, // deleteUser(p2) DELETE
    ])

    await deprovisionWorkspace(config, 'band-c')

    expect(fetchMock.mock.calls[0][0]).toContain('/stageboard-band-c/_all_docs')
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:5984/stageboard-band-c')
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(fetchMock.mock.calls[3][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p1')
    expect(fetchMock.mock.calls[6][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2')
  })

  it('tolerates an already-gone database/roster and no members left to delete', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // allDocs fails - caught, treated as empty roster
      { ok: false, status: 404 }, // deleteDb
    ])

    await expect(deprovisionWorkspace(config, 'band-c')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
