import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CouchConfig } from './couch.js'
import {
  deprovisionMember,
  deprovisionWorkspace,
  generateMemberPassword,
  memberUsername,
  provisionMember,
  provisionWorkspace,
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

describe('workspaceDbName / memberUsername', () => {
  it('derive the same stageboard-<id> name stage-pwa\'s localDbName() uses', () => {
    expect(workspaceDbName('band-a')).toBe('stageboard-band-a')
    expect(memberUsername('band-a', 'p1')).toBe('stageboard-band-a-p1')
  })
})

describe('provisionWorkspace', () => {
  it('creates the founder\'s account (member+admin roles), the database, a role-based security doc, and a static roster validator', async () => {
    const fetchMock = stubFetch([
      { ok: false, status: 404 }, // userExists
      { ok: true, status: 201 }, // createUser (founder)
      { ok: true, status: 201 }, // ensureDb
      { ok: true, status: 200 }, // putSecurity
      { ok: true, status: 201 }, // putDoc (_design/roster)
    ])

    const result = await provisionWorkspace(config, 'band-c', 'p1')

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
  })

  it('throws WorkspaceAlreadyProvisionedError without touching the db or security doc', async () => {
    const fetchMock = stubFetch([{ ok: true, status: 200, json: async () => ({ name: 'stageboard-band-a-p1' }) }])

    await expect(provisionWorkspace(config, 'band-a', 'p1')).rejects.toThrow(WorkspaceAlreadyProvisionedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('setMemberAdmin fetches the user doc then PUTs it back with updated roles, preserving everything else', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:x', _rev: '1-abc', name: 'x', type: 'user', roles: ['member'] }) },
      { ok: true, status: 200 },
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
  })

  it('deprovisionMember deletes just that member\'s user doc', async () => {
    const fetchMock = stubFetch([
      { ok: true, status: 200, json: async () => ({ _rev: '1-p2' }) }, // GET
      { ok: true, status: 200 }, // DELETE
    ])

    await deprovisionMember(config, 'band-c', 'p2')

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2')
  })
})

describe('deprovisionWorkspace', () => {
  it('reads the roster first, deletes the database, then every member\'s account', async () => {
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
      { ok: true, status: 200, json: async () => ({ _rev: '1-p1' }) }, // deleteUser(p1) GET
      { ok: true, status: 200 }, // deleteUser(p1) DELETE
      { ok: true, status: 200, json: async () => ({ _rev: '1-p2' }) }, // deleteUser(p2) GET
      { ok: true, status: 200 }, // deleteUser(p2) DELETE
    ])

    await deprovisionWorkspace(config, 'band-c')

    expect(fetchMock.mock.calls[0][0]).toContain('/stageboard-band-c/_all_docs')
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:5984/stageboard-band-c')
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(fetchMock.mock.calls[2][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p1')
    expect(fetchMock.mock.calls[4][0]).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-c-p2')
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
