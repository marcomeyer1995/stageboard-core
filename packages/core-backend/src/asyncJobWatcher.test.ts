import { writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsyncJob } from 'shared-types'
import type { CouchDoc } from './couch.js'

// In-memory stand-in for the one workspace db the watcher touches - enough of couch.ts's
// surface to run the real processJob/queue logic end to end without a CouchDB.
const store = new Map<string, Record<string, unknown>>()
vi.mock('./couch.js', () => ({
  allDocs: vi.fn(async (_config: unknown, _db: string, { startkey }: { startkey: string }) =>
    [...store.entries()].filter(([id]) => id.startsWith(startkey)).map(([, doc]) => structuredClone(doc)),
  ),
  getDoc: vi.fn(async (_config: unknown, _db: string, id: string) => (store.has(id) ? structuredClone(store.get(id)) : null)),
  putDocWithRetry: vi.fn(async (_config: unknown, _db: string, id: string, build: (existing: CouchDoc | null) => CouchDoc) => {
    const existing = store.has(id) ? (structuredClone(store.get(id)) as CouchDoc) : null
    store.set(id, build(existing) as Record<string, unknown>)
  }),
  // Never fires - the tests drive the watcher through its startup pass and its own
  // pick-up-next-after-a-job path, not the changes feed.
  waitForChange: vi.fn(() => new Promise(() => {})),
}))

vi.mock('./ytDlp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ytDlp.js')>()),
  runYtDlpExtract: vi.fn(),
}))

vi.mock('./audioStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audioStore.js')>()),
  writeAudioFile: vi.fn(async () => {}),
  deleteAudioFile: vi.fn(async () => {}),
}))

import { runYtDlpExtract } from './ytDlp.js'
import { deleteAudioFile, writeAudioFile } from './audioStore.js'
import { createAsyncJobWatcher, pickNextQueuedJob, readAsyncJobs, stuckRunningJobs } from './asyncJobWatcher.js'

function job(overrides: Partial<AsyncJob> = {}): AsyncJob {
  return {
    id: 'job-1',
    type: 'youtube-extract',
    status: 'queued',
    progress: 0,
    createdAt: 1000,
    updatedAt: 1000,
    variantId: 'variant-1',
    url: 'https://youtu.be/dQw4w9WgXcQ',
    label: 'YouTube Referenz',
    ...overrides,
  }
}

describe('readAsyncJobs', () => {
  it('keeps only documents that parse as an AsyncJob', () => {
    expect(readAsyncJobs([job(), { garbage: true }, null, job({ id: 'job-2' })])).toHaveLength(2)
  })
})

describe('pickNextQueuedJob', () => {
  it('picks the oldest queued job', () => {
    const older = job({ id: 'older', createdAt: 100 })
    const newer = job({ id: 'newer', createdAt: 200 })
    expect(pickNextQueuedJob([newer, older])?.id).toBe('older')
  })

  it('ignores jobs that are not queued', () => {
    expect(pickNextQueuedJob([job({ status: 'running' }), job({ status: 'done' }), job({ status: 'error' })])).toBeUndefined()
  })

  it('returns undefined for an empty list', () => {
    expect(pickNextQueuedJob([])).toBeUndefined()
  })
})

describe('stuckRunningJobs', () => {
  it('reports a running job that does not belong to this watcher instance', () => {
    const stuck = job({ id: 'stuck', status: 'running' })
    expect(stuckRunningJobs([stuck], null)).toEqual([stuck])
    expect(stuckRunningJobs([stuck], 'some-other-job')).toEqual([stuck])
  })

  it('never reports the job this watcher instance is itself currently running', () => {
    const current = job({ id: 'current', status: 'running' })
    expect(stuckRunningJobs([current], 'current')).toEqual([])
  })

  it('ignores queued/done/error jobs entirely', () => {
    expect(stuckRunningJobs([job({ status: 'queued' }), job({ status: 'done' }), job({ status: 'error' })], null)).toEqual([])
  })
})

describe('createAsyncJobWatcher', () => {
  const log = { info: vi.fn(), error: vi.fn() }
  const couch = { url: 'http://couch', user: 'u', password: 'p' }

  /** Fakes a successful yt-dlp run: writes a real file where yt-dlp would, so the watcher's own
   * readFile/stat run for real. */
  function ytDlpSucceeds() {
    vi.mocked(runYtDlpExtract).mockImplementation(async (_url, template, onProgress) => {
      const filePath = template.replace('%(ext)s', 'm4a')
      await writeFile(filePath, Buffer.from('audio-bytes'))
      onProgress(0.5)
      return { filePath }
    })
  }

  function putJob(overrides: Partial<AsyncJob>) {
    const j = job(overrides)
    store.set(`async-jobs:${j.id}`, { ...j, _id: `async-jobs:${j.id}` })
  }

  function storedJob(id: string) {
    return store.get(`async-jobs:${id}`) as AsyncJob | undefined
  }

  beforeEach(() => {
    store.clear()
    vi.mocked(runYtDlpExtract).mockReset()
    vi.mocked(writeAudioFile).mockClear()
    vi.mocked(deleteAudioFile).mockClear()
  })

  it('appends the extracted track to the variant, keeping every existing track', async () => {
    ytDlpSucceeds()
    // Deliberately NOT a schema-valid SongVariant (no songId, name, ...): the existing tracks
    // must survive regardless.
    const existingTrack = { id: 'band-mix-1', kind: 'band-mix', label: 'Mix' }
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [existingTrack], somethingElse: 42 })
    putJob({})

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('done'))
    watcher.stop()

    const variant = store.get('song-variants:variant-1') as { tracks: Array<{ id: string; kind: string; source?: string }>; somethingElse: number }
    expect(variant.somethingElse).toBe(42)
    expect(variant.tracks).toHaveLength(2)
    expect(variant.tracks[0]).toEqual(existingTrack)
    expect(variant.tracks[1]).toMatchObject({ id: storedJob('job-1')?.trackId, kind: 'reference', source: 'youtube-extract', mimeType: 'audio/mp4' })
    expect(storedJob('job-1')?.progress).toBe(1)
    expect(writeAudioFile).toHaveBeenCalledWith('variant-1', storedJob('job-1')?.trackId, Buffer.from('audio-bytes'))
  })

  it('fails the job without downloading when the variant does not exist, and never creates a stub variant', async () => {
    ytDlpSucceeds()
    putJob({})

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/existiert nicht mehr/)
    expect(runYtDlpExtract).not.toHaveBeenCalled()
    expect(store.has('song-variants:variant-1')).toBe(false)
  })

  it('deletes the written audio again if the variant disappears mid-download', async () => {
    vi.mocked(runYtDlpExtract).mockImplementation(async (_url, template) => {
      const filePath = template.replace('%(ext)s', 'm4a')
      await writeFile(filePath, Buffer.from('audio-bytes'))
      store.delete('song-variants:variant-1') // deleted by a band member while yt-dlp ran
      return { filePath }
    })
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({})

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(deleteAudioFile).toHaveBeenCalledWith('variant-1', expect.any(String))
    expect(store.has('song-variants:variant-1')).toBe(false)
  })

  it('rejects a variant id that is not a safe path segment before any shell-out', async () => {
    ytDlpSucceeds()
    putJob({ variantId: '../../etc' })

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/Ungültige Song-Varianten-ID/)
    expect(runYtDlpExtract).not.toHaveBeenCalled()
  })

  it('reports a yt-dlp failure on the job', async () => {
    vi.mocked(runYtDlpExtract).mockRejectedValue(new Error('yt-dlp exited with code 1: ERROR: Video unavailable'))
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({})

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/Video unavailable/)
    expect((store.get('song-variants:variant-1') as { tracks: unknown[] }).tracks).toEqual([])
  })

  it('works through several queued jobs oldest first, without waiting for an unrelated change', async () => {
    ytDlpSucceeds()
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({ id: 'second', createdAt: 2000 })
    putJob({ id: 'first', createdAt: 1000 })

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('second')?.status).toBe('done'))
    watcher.stop()

    const tracks = (store.get('song-variants:variant-1') as { tracks: Array<{ id: string }> }).tracks
    expect(tracks.map((t) => t.id)).toEqual([storedJob('first')?.trackId, storedJob('second')?.trackId])
  })

  it('marks a job left running by a previous process as failed at startup', async () => {
    putJob({ status: 'running', progress: 0.4 })

    const watcher = createAsyncJobWatcher({ couch, workspaceId: 'ws', log })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/Neustart/)
    expect(runYtDlpExtract).not.toHaveBeenCalled()
  })
})
