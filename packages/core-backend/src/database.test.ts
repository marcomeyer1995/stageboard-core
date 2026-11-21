import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allDocs,
  deleteDb,
  ensureDb,
  getDoc,
  putDoc,
  putSecurity,
  waitForChange,
  type DatabaseConfig,
} from './database.js'

const config: DatabaseConfig = { url: 'http://localhost:5984', user: 'admin', password: 'admin' }

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
      json: async () => ({ last_seq: '5-abc', results: [{ seq: '5-abc', id: 'songs:1' }] }),
    })

    const result = await waitForChange(config, 'songs', '4-xyz', 30000)

    expect(result).toEqual({ lastSeq: '5-abc', changed: true, ids: ['songs:1'] })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/songs/_changes?feed=longpoll&since=4-xyz&timeout=30000')
  })

  it('reports no change on an empty results array (long-poll timeout)', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ last_seq: '4-xyz', results: [] }) })
    const result = await waitForChange(config, 'songs', '4-xyz', 30000)
    expect(result).toEqual({ lastSeq: '4-xyz', changed: false, ids: [] })
  })

  it('throws with the HTTP status on failure', async () => {
    stubFetch({ ok: false, status: 500 })
    await expect(waitForChange(config, 'songs', '4-xyz', 30000)).rejects.toThrow('500')
  })
})
