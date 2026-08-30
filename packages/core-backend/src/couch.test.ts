import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allDocs,
  createUser,
  deleteDb,
  deleteUser,
  ensureDb,
  getAttachment,
  getDoc,
  putAttachment,
  putDoc,
  putSecurity,
  setUserRoles,
  userExists,
  verifyUser,
  waitForChange,
  type CouchConfig,
} from './couch.js'

const config: CouchConfig = { url: 'http://localhost:5984', user: 'admin', password: 'admin' }

function stubFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** For calls that make more than one fetch (e.g. deleteUser's get-then-delete) - each entry
 * is the response to that call in order. */
function stubFetchSequence(responses: Array<Partial<Response>>) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getDoc / putDoc (existing JSON behavior)', () => {
  it('getDoc returns the parsed document', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ _id: 'song-1', title: 'Wonderwall' }) })
    const doc = await getDoc(config, 'songs', 'song-1')
    expect(doc).toEqual({ _id: 'song-1', title: 'Wonderwall' })
  })

  it('getDoc returns null on 404', async () => {
    stubFetch({ ok: false, status: 404 })
    expect(await getDoc(config, 'songs', 'missing')).toBeNull()
  })

  it('putDoc sends a JSON body', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201 })
    await putDoc(config, 'songs', { _id: 'song-1', title: 'Wonderwall' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe(JSON.stringify({ _id: 'song-1', title: 'Wonderwall' }))
    expect(init.headers['Content-Type']).toBe('application/json')
  })
})

describe('getAttachment', () => {
  it('downloads and returns the attachment as a Buffer', async () => {
    const bytes = new TextEncoder().encode('fake-mp3-bytes')
    const fetchMock = stubFetch({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer })

    const result = await getAttachment(config, 'songs', 'variant-1', 'backing-track.mp3')

    expect(result).toEqual(Buffer.from(bytes))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/songs/variant-1/backing-track.mp3')
    expect(init.headers.Authorization).toMatch(/^Basic /)
  })

  it('returns null when the attachment does not exist (404), without touching the body', async () => {
    const arrayBuffer = vi.fn()
    stubFetch({ ok: false, status: 404, arrayBuffer })

    const result = await getAttachment(config, 'songs', 'variant-1', 'missing.mp3')

    expect(result).toBeNull()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('throws with the HTTP status on other failures', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(getAttachment(config, 'songs', 'variant-1', 'backing-track.mp3')).rejects.toThrow('500')
  })
})

describe('putAttachment', () => {
  it('uploads binary data with the given content type and rev, returning the new rev', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, id: 'variant-1', rev: '2-abc' }),
    })
    const data = Buffer.from('fake-mp3-bytes')

    const result = await putAttachment(config, 'songs', 'variant-1', 'backing-track.mp3', '1-xyz', 'audio/mpeg', data)

    expect(result).toEqual({ rev: '2-abc' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/songs/variant-1/backing-track.mp3?rev=1-xyz')
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('audio/mpeg')
    expect(init.body).toBe(data)
  })

  it('omits the rev query param when creating a brand-new document', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201, json: async () => ({ ok: true, id: 'v2', rev: '1-a' }) })

    await putAttachment(config, 'songs', 'v2', 'stem-drums.mp3', undefined, 'audio/mpeg', Buffer.from('x'))

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/songs/v2/stem-drums.mp3')
  })

  it('throws with the HTTP status on failure (e.g. rev conflict)', async () => {
    stubFetch({ ok: false, status: 409 })
    await expect(
      putAttachment(config, 'songs', 'variant-1', 'backing-track.mp3', 'stale-rev', 'audio/mpeg', Buffer.from('x')),
    ).rejects.toThrow('409')
  })
})

describe('ensureDb', () => {
  it('creates the database', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201 })
    await ensureDb(config, 'songs')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/songs')
    expect(init.method).toBe('PUT')
  })

  it('treats an already-existing database (412) as success', async () => {
    stubFetch({ ok: false, status: 412 })
    await expect(ensureDb(config, 'songs')).resolves.toBeUndefined()
  })

  it('throws on any other failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(ensureDb(config, 'songs')).rejects.toThrow('500')
  })
})

describe('userExists', () => {
  it('returns true when the user document is found', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, json: async () => ({ name: 'stageboard-band-a' }) })
    expect(await userExists(config, 'stageboard-band-a')).toBe(true)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-a')
  })

  it('returns false on 404', async () => {
    stubFetch({ ok: false, status: 404 })
    expect(await userExists(config, 'stageboard-band-a')).toBe(false)
  })

  it('throws on any other failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(userExists(config, 'stageboard-band-a')).rejects.toThrow('500')
  })
})

describe('verifyUser', () => {
  it('returns the name and roles when userCtx.name matches the given username', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
    })
    expect(await verifyUser(config, 'stageboard-band-a-p1', 'correct-pw')).toEqual({
      name: 'stageboard-band-a-p1',
      roles: ['member', 'admin'],
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/_session')
    expect(init.headers.Authorization).toMatch(/^Basic /)
  })

  it('returns null on 401 (wrong password or unknown user)', async () => {
    stubFetch({ ok: false, status: 401 })
    expect(await verifyUser(config, 'stageboard-band-a-p1', 'wrong-pw')).toBeNull()
  })

  it('returns null when CouchDB falls back to anonymous (userCtx.name: null)', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ ok: true, userCtx: { name: null, roles: [] } }) })
    expect(await verifyUser(config, 'stageboard-band-a-p1', '')).toBeNull()
  })
})

describe('deleteDb', () => {
  it('DELETEs the database', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 })
    await deleteDb(config, 'stageboard-band-a')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/stageboard-band-a')
    expect(init.method).toBe('DELETE')
  })

  it('treats an already-gone database (404) as success', async () => {
    stubFetch({ ok: false, status: 404 })
    await expect(deleteDb(config, 'stageboard-band-a')).resolves.toBeUndefined()
  })

  it('throws on any other failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(deleteDb(config, 'stageboard-band-a')).rejects.toThrow('500')
  })
})

describe('deleteUser', () => {
  it('looks up the current _rev, then DELETEs with it', async () => {
    const fetchMock = stubFetchSequence([
      { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:stageboard-band-a', _rev: '1-abc' }) },
      { ok: true, status: 200 },
    ])

    await deleteUser(config, 'stageboard-band-a')

    const [getUrl] = fetchMock.mock.calls[0]
    expect(getUrl).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-a')
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1]
    expect(deleteUrl).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-a?rev=1-abc')
    expect(deleteInit.method).toBe('DELETE')
  })

  it('is a no-op when the user does not exist (404 on lookup)', async () => {
    const fetchMock = stubFetch({ ok: false, status: 404 })
    await expect(deleteUser(config, 'stageboard-band-a')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws if the lookup fails for another reason', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(deleteUser(config, 'stageboard-band-a')).rejects.toThrow('500')
  })

  it('throws if the delete itself fails (and is not a 404)', async () => {
    stubFetchSequence([
      { ok: true, status: 200, json: async () => ({ _rev: '1-abc' }) },
      { ok: false, status: 409 },
    ])
    await expect(deleteUser(config, 'stageboard-band-a')).rejects.toThrow('409')
  })
})

describe('createUser', () => {
  it('PUTs a CouchDB user document with the given password', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201 })
    await createUser(config, 'stageboard-band-a', 'secret-pw')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-a')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      _id: 'org.couchdb.user:stageboard-band-a',
      name: 'stageboard-band-a',
      password: 'secret-pw',
      roles: [],
      type: 'user',
    })
  })

  it('treats an already-existing user (409) as success, never rotating the password', async () => {
    stubFetch({ ok: false, status: 409 })
    await expect(createUser(config, 'stageboard-band-a', 'secret-pw')).resolves.toBeUndefined()
  })

  it('throws on any other failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(createUser(config, 'stageboard-band-a', 'secret-pw')).rejects.toThrow('500')
  })

  it('accepts an explicit roles list', async () => {
    const fetchMock = stubFetch({ ok: true, status: 201 })
    await createUser(config, 'stageboard-band-a-p1', 'secret-pw', ['member', 'admin'])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ roles: ['member', 'admin'] })
  })
})

describe('setUserRoles', () => {
  it('fetches the current doc, then PUTs it back with only roles changed', async () => {
    const fetchMock = stubFetchSequence([
      {
        ok: true,
        status: 200,
        json: async () => ({
          _id: 'org.couchdb.user:stageboard-band-a-p1',
          _rev: '2-xyz',
          name: 'stageboard-band-a-p1',
          type: 'user',
          roles: ['member'],
          password_scheme: 'pbkdf2',
        }),
      },
      { ok: true, status: 200 },
    ])

    await setUserRoles(config, 'stageboard-band-a-p1', ['member', 'admin'])

    const [getUrl] = fetchMock.mock.calls[0]
    expect(getUrl).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-a-p1')
    const [putUrl, putInit] = fetchMock.mock.calls[1]
    expect(putUrl).toBe('http://localhost:5984/_users/org.couchdb.user:stageboard-band-a-p1')
    expect(JSON.parse(putInit.body)).toEqual({
      _id: 'org.couchdb.user:stageboard-band-a-p1',
      _rev: '2-xyz',
      name: 'stageboard-band-a-p1',
      type: 'user',
      roles: ['member', 'admin'],
      password_scheme: 'pbkdf2',
    })
  })

  it('throws if the user does not exist', async () => {
    stubFetch({ ok: false, status: 404 })
    await expect(setUserRoles(config, 'stageboard-band-a-p1', ['member'])).rejects.toThrow('404')
  })
})

describe('putSecurity', () => {
  it('PUTs the security doc to the database', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 })
    await putSecurity(config, 'stageboard-band-a', { members: { names: ['stageboard-band-a'], roles: [] } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:5984/stageboard-band-a/_security')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ members: { names: ['stageboard-band-a'], roles: [] } })
  })

  it('throws on failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(
      putSecurity(config, 'stageboard-band-a', { members: { names: [], roles: [] } }),
    ).rejects.toThrow('500')
  })

  it('includes both admins and members when given (see #56)', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 })
    await putSecurity(config, 'stageboard-band-a', {
      admins: { names: ['stageboard-band-a-admin'], roles: [] },
      members: { names: ['stageboard-band-a'], roles: [] },
    })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      admins: { names: ['stageboard-band-a-admin'], roles: [] },
      members: { names: ['stageboard-band-a'], roles: [] },
    })
  })
})

describe('allDocs', () => {
  it('returns the docs from included rows, dropping any without a doc', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({
        rows: [{ doc: { _id: 'song-1', title: 'Wonderwall' } }, { doc: undefined }],
      }),
    })

    const docs = await allDocs(config, 'songs')

    expect(docs).toEqual([{ _id: 'song-1', title: 'Wonderwall' }])
  })

  it('throws with the HTTP status on failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(allDocs(config, 'songs')).rejects.toThrow('500')
  })
})

describe('waitForChange', () => {
  it('reports a change when the changes feed returns results', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ last_seq: '5-abc', results: [{ seq: '5-abc' }] }),
    })

    const result = await waitForChange(config, 'songs', '4-xyz', 30000)

    expect(result).toEqual({ lastSeq: '5-abc', changed: true })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/songs/_changes?feed=longpoll&since=4-xyz&timeout=30000')
  })

  it('reports no change on an empty results array (long-poll timeout)', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ last_seq: '4-xyz', results: [] }) })
    const result = await waitForChange(config, 'songs', '4-xyz', 30000)
    expect(result).toEqual({ lastSeq: '4-xyz', changed: false })
  })

  it('throws with the HTTP status on failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(waitForChange(config, 'songs', '4-xyz', 30000)).rejects.toThrow('500')
  })
})
