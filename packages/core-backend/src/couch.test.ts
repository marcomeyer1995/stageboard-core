import { afterEach, describe, expect, it, vi } from 'vitest'
import { allDocs, ensureDb, getAttachment, getDoc, putAttachment, putDoc, waitForChange, type CouchConfig } from './couch.js'

const config: CouchConfig = { url: 'http://localhost:5984', user: 'admin', password: 'admin' }

function stubFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response)
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
