import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsyncJob, AudioImportJob } from 'shared-types'
import type { AddonMethods } from './addons/addonMethods.js'
import type { DatabaseDoc } from './database.js'

// In-memory stand-in for the one workspace db the watcher touches - enough of database.ts's
// surface to run the real processJob/queue logic end to end without a database.
const store = new Map<string, Record<string, unknown>>()
vi.mock('./database.js', () => ({
  allDocs: vi.fn(async (_config: unknown, _db: string, { startkey }: { startkey: string }) =>
    [...store.entries()].filter(([id]) => id.startsWith(startkey)).map(([, doc]) => structuredClone(doc)),
  ),
  getDoc: vi.fn(async (_config: unknown, _db: string, id: string) => (store.has(id) ? structuredClone(store.get(id)) : null)),
  putDocWithRetry: vi.fn(async (_config: unknown, _db: string, id: string, build: (existing: DatabaseDoc | null) => DatabaseDoc) => {
    const existing = store.has(id) ? (structuredClone(store.get(id)) as DatabaseDoc) : null
    store.set(id, build(existing) as Record<string, unknown>)
  }),
  // Never fires - the tests drive the watcher through its startup pass and its own
  // pick-up-next-after-a-job path, not the changes feed.
  waitForChange: vi.fn(() => new Promise(() => {})),
}))

vi.mock('./audioStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audioStore.js')>()),
  writeAudioFile: vi.fn(async () => {}),
  deleteAudioFile: vi.fn(async () => {}),
  readAudioFile: vi.fn(async () => Buffer.from('source-audio')),
}))

import { deleteAudioFile, writeAudioFile } from './audioStore.js'
import { createAsyncJobWatcher, pickNextQueuedJob, readAsyncJobs, stuckRunningJobs } from './asyncJobWatcher.js'

function job(overrides: Partial<AudioImportJob> = {}): AudioImportJob {
  return {
    id: 'job-1',
    type: 'audio-import',
    status: 'queued',
    progress: 0,
    createdAt: 1000,
    updatedAt: 1000,
    variantId: 'variant-1',
    addonId: 'youtube-download',
    method: 'fetchAudio',
    args: { url: 'https://youtu.be/dQw4w9WgXcQ' },
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

  it('leaves a conversion to Opus to the devices (#822)', () => {
    const convert = { id: 'c', type: 'opus-convert' as const, status: 'queued' as const, progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', trackId: 't', label: 'x' }
    expect(pickNextQueuedJob([convert, job({ id: 'yt', createdAt: 2 })])?.id).toBe('yt')
    expect(stuckRunningJobs([{ ...convert, status: 'running' }], null)).toEqual([])
  })

  it('returns undefined for an empty list', () => {
    expect(pickNextQueuedJob([])).toBeUndefined()
  })

  it("leaves a device's own job alone (docs/32 §8 helper) - queued or running, restart or not", () => {
    const onDevice = job({ id: 'on-device', status: 'queued', runner: 'device:redmi' })
    expect(pickNextQueuedJob([onDevice])).toBeUndefined()
    expect(stuckRunningJobs([{ ...onDevice, status: 'running' }, job({ id: 'ours', status: 'running' })], null).map((j) => j.id)).toEqual(['ours'])
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
  /** The add-on's method, answered by a stand-in: what the watcher knows of it is `call(addonId, method, args)` and the answer. */
  const fake = { has: () => true, contributes: () => null, call: vi.fn() } as unknown as AddonMethods & { call: ReturnType<typeof vi.fn> }
  const log = { info: vi.fn(), error: vi.fn() }
  const database = { url: 'http://database', user: 'u', password: 'p' }

  /** The add-on answers with audio (not Opus, so a device converts it later). */
  function ytDlpSucceeds() {
    fake.call.mockImplementation(async (_addon: string, _method: string, _args: unknown, options?: { onProgress?: (f: number) => void }) => {
      options?.onProgress?.(0.5)
      return { ok: true, body: { audio: new Uint8Array(Buffer.from('audio-bytes')), ext: 'm4a' } }
    })
  }

  function putJob(overrides: Partial<AudioImportJob>) {
    const j = job(overrides)
    store.set(`async-jobs:${j.id}`, { ...j, _id: `async-jobs:${j.id}` })
  }

  function storedJob(id: string) {
    return store.get(`async-jobs:${id}`) as (AudioImportJob & { stemTrackIds?: string[] }) | undefined
  }

  beforeEach(() => {
    store.clear()
    // The YouTube jobs below run for a band with the YouTube-Download add-on (#546).
    store.set('plugins:youtube-download', { _id: 'plugins:youtube-download', id: 'youtube-download', name: 'YouTube-Download', version: '0.0.1', enabled: true, runtime: 'server', installedAt: 1, capabilities: ['video-download'], transports: [], hardwareIds: [] })
    fake.call.mockReset()
    vi.mocked(writeAudioFile).mockClear()
    vi.mocked(deleteAudioFile).mockClear()
  })

  it('refuses an audio job when the band has not installed the add-on (#546) - the add-on is not asked', async () => {
    store.delete('plugins:youtube-download')
    putJob({})
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()
    expect(storedJob('job-1')?.error).toContain('youtube-download')
    expect(fake.call).not.toHaveBeenCalled()
  })

  it('appends the extracted track to the variant, keeping every existing track', async () => {
    ytDlpSucceeds()
    // Deliberately NOT a schema-valid SongVariant (no songId, name, ...): the existing tracks
    // must survive regardless.
    const existingTrack = { id: 'band-mix-1', kind: 'band-mix', label: 'Mix' }
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [existingTrack], somethingElse: 42 })
    putJob({})

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('done'))
    watcher.stop()

    const variant = store.get('song-variants:variant-1') as { tracks: Array<{ id: string; kind: string; source?: string }>; somethingElse: number }
    expect(variant.somethingElse).toBe(42)
    expect(variant.tracks).toHaveLength(2)
    expect(variant.tracks[0]).toEqual(existingTrack)
    expect(variant.tracks[1]).toMatchObject({ id: storedJob('job-1')?.trackId, kind: 'reference', source: 'add-on', mimeType: 'audio/mp4' })
    expect(storedJob('job-1')?.progress).toBe(1)
    expect(writeAudioFile).toHaveBeenCalledWith('variant-1', storedJob('job-1')?.trackId, Buffer.from('audio-bytes'))
  })

  describe('claiming a job with other hosts around (#964)', () => {
    it('writes itself as the runner of the job it takes, and keeps that runner to the end', async () => {
      ytDlpSucceeds()
      store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
      putJob({})
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake, hostId: 'laptop' })
      await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('done'))
      watcher.stop()
      expect(storedJob('job-1')?.runner).toBe('host:laptop')
    })

    it('leaves a job it cannot do queued - it neither takes it nor ends it with an error', async () => {
      putJob({})
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake, hostId: 'tablet', canDo: () => false, hasPeers: () => true })
      await new Promise((resolve) => setTimeout(resolve, 200))
      watcher.stop()
      expect(storedJob('job-1')).toMatchObject({ status: 'queued' })
      expect(storedJob('job-1')?.runner).toBeUndefined()
      expect(fake.call).not.toHaveBeenCalled()
    })

    it('the only host takes a job it cannot do and ends it with its own message - nobody should wait for nothing', async () => {
      store.delete('plugins:youtube-download')
      putJob({})
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake, hostId: 'laptop', canDo: () => false, hasPeers: () => false })
      await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
      watcher.stop()
      expect(storedJob('job-1')?.runner).toBe('host:laptop')
    })

    it('goes on after the claim settled when the job still names it', async () => {
      ytDlpSucceeds()
      store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
      putJob({})
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake, hostId: 'laptop', hasPeers: () => true, settleMs: 20 })
      await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('done'))
      watcher.stop()
      expect(fake.call).toHaveBeenCalledTimes(1)
    })

    it('stops when another host won the claim in replication - the add-on is never asked', async () => {
      putJob({})
      // The other host's claim arrives while this one waits for its own to settle: the job now names it.
      const watcher = createAsyncJobWatcher({
        database,
        workspaceId: 'ws',
        log,
        hostId: 'laptop',
        settleMs: 40,
        hasPeers: () => {
          setTimeout(() => store.set('async-jobs:job-1', { ...(store.get('async-jobs:job-1') as object), runner: 'host:tablet' }), 10)
          return true
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      watcher.stop()
      expect(fake.call).not.toHaveBeenCalled()
      expect(storedJob('job-1')?.runner).toBe('host:tablet')
    })

    it('does not fail a running job another host holds when it starts', async () => {
      putJob({ status: 'running', runner: 'host:tablet' } as never)
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake, hostId: 'laptop' })
      await new Promise((resolve) => setTimeout(resolve, 200))
      watcher.stop()
      expect(storedJob('job-1')).toMatchObject({ status: 'running', runner: 'host:tablet' })
    })
  })

  it('stores a WebM/Opus download as Ogg Opus - re-wrapped, nothing encoded again', async () => {
    const { readFileSync } = await import('node:fs')
    const webm = readFileSync(join(__dirname, '../../shared-types/src/__fixtures__/stereo.webm'))
    fake.call.mockResolvedValue({ ok: true, body: { audio: new Uint8Array(webm), ext: 'webm' } })
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({})
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('done'))
    watcher.stop()
    const variant = store.get('song-variants:variant-1') as { tracks: Array<{ mimeType?: string; sizeBytes?: number }> }
    const stored = vi.mocked(writeAudioFile).mock.calls[0]![2] as Buffer
    expect(stored.subarray(0, 4).toString()).toBe('OggS')
    expect(variant.tracks[0]).toMatchObject({ mimeType: 'audio/ogg', sizeBytes: stored.length })
  })

  it('keeps a download without Opus as it came and queues its conversion for a device (#822)', async () => {
    ytDlpSucceeds()
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({})
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('done'))
    watcher.stop()
    const trackId = storedJob('job-1')?.trackId
    expect((store.get('song-variants:variant-1') as { tracks: Array<{ mimeType?: string }> }).tracks[0]).toMatchObject({ mimeType: 'audio/mp4' })
    const convert = [...store.values()].find((doc) => (doc as { type?: string }).type === 'opus-convert') as Record<string, unknown> | undefined
    expect(convert).toMatchObject({ type: 'opus-convert', status: 'queued', variantId: 'variant-1', trackId, label: 'YouTube Referenz' })
    expect(convert?.runner).toBeUndefined()
  })

  it('fails the job without downloading when the variant does not exist, and never creates a stub variant', async () => {
    ytDlpSucceeds()
    putJob({})

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/existiert nicht mehr/)
    expect(fake.call).not.toHaveBeenCalled()
    expect(store.has('song-variants:variant-1')).toBe(false)
  })

  it('deletes the written audio again if the variant disappears mid-download', async () => {
    fake.call.mockImplementation(async () => {
      store.delete('song-variants:variant-1') // deleted by a band member while the add-on ran
      return { ok: true, body: { audio: new Uint8Array(Buffer.from('audio-bytes')), ext: 'm4a' } }
    })
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({})

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(deleteAudioFile).toHaveBeenCalledWith('variant-1', expect.any(String))
    expect(store.has('song-variants:variant-1')).toBe(false)
  })

  it('rejects a variant id that is not a safe path segment before any shell-out', async () => {
    ytDlpSucceeds()
    putJob({ variantId: '../../etc' })

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/Ungültige Song-Varianten-ID/)
    expect(fake.call).not.toHaveBeenCalled()
  })

  it('reports a yt-dlp failure on the job', async () => {
    fake.call.mockResolvedValue({ ok: false, error: { code: 'youtube.failed', message: 'yt-dlp exited with code 1: ERROR: Video unavailable' } })
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [] })
    putJob({})

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
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

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('second')?.status).toBe('done'))
    watcher.stop()

    const tracks = (store.get('song-variants:variant-1') as { tracks: Array<{ id: string }> }).tracks
    expect(tracks.map((t) => t.id)).toEqual([storedJob('first')?.trackId, storedJob('second')?.trackId])
  })

  it('marks a job left running by a previous process as failed at startup', async () => {
    putJob({ status: 'running', progress: 0.4 })

    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
    await vi.waitFor(() => expect(storedJob('job-1')?.status).toBe('error'))
    watcher.stop()

    expect(storedJob('job-1')?.error).toMatch(/Neustart/)
    expect(fake.call).not.toHaveBeenCalled()
  })

  describe('stem separation (#9)', () => {
    const stemJob = { id: 'stem-1', type: 'stem-separation', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'variant-1', sourceTrackId: 'mix-1', model: 'extended', splitGuitar: true }
    const installPlugin = () => store.set('plugins:stem-separation', { _id: 'plugins:stem-separation', id: 'stem-separation', name: 'Spuren trennen', version: '0.0.1', enabled: true, runtime: 'server', installedAt: 1, capabilities: ['stem-separation'], transports: [], hardwareIds: [] })

    beforeEach(() => {
      fake.call.mockReset()
    })

    it('refuses without the plugin installed - heavy, so only for bands that want it', async () => {
      store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [{ id: 'mix-1', kind: 'band-mix' }] })
      store.set('async-jobs:stem-1', { ...stemJob, _id: 'async-jobs:stem-1' })
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
      await vi.waitFor(() => expect(storedJob('stem-1')?.status).toBe('error'))
      watcher.stop()
      expect(storedJob('stem-1')?.error).toMatch(/nicht installiert/)
      expect(fake.call).not.toHaveBeenCalled()
    })

    it('attaches the stems to the track and replaces those of an earlier separation', async () => {
      installPlugin()
      const other = { id: 'other-stem', kind: 'stem', parentTrackId: 'another-track' }
      store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [{ id: 'mix-1', kind: 'band-mix', durationMs: 170000 }, { id: 'old-drums', kind: 'stem', parentTrackId: 'mix-1' }, other] })
      store.set('async-jobs:stem-1', { ...stemJob, _id: 'async-jobs:stem-1' })
      // The stem add-on answers its method `separate` with one entry per stem (the Demucs program is its helper, not the watcher's business).
      fake.call.mockImplementation(async (_addon: string, _method: string, _body: unknown, callOptions?: { onProgress?: (f: number) => void }) => {
        callOptions?.onProgress?.(0.5)
        return { ok: true, body: { stems: [{ key: 'drums', opus: true, data: new Uint8Array([100]) }, { key: 'guitar-left', opus: true, data: new Uint8Array([103]) }] } }
      })
      const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, addonMethods: fake })
      await vi.waitFor(() => expect(storedJob('stem-1')?.status).toBe('done'))
      watcher.stop()
      const tracks = (store.get('song-variants:variant-1') as { tracks: Array<Record<string, unknown>> }).tracks
      expect(tracks.map((t) => t.id)).not.toContain('old-drums')
      expect(tracks).toContainEqual(other)
      const stems = tracks.filter((t) => t.parentTrackId === 'mix-1')
      expect(stems.map((t) => t.label)).toEqual(['Schlagzeug', 'Gitarre links'])
      expect(stems.map((t) => t.role)).toEqual(['drums', 'guitar'])
      expect(stems[0]).toMatchObject({ kind: 'stem', source: 'stem-separation', mimeType: 'audio/ogg', durationMs: 170000, sizeBytes: 1 })
      expect(storedJob('stem-1')?.stemTrackIds).toEqual(stems.map((t) => t.id))
      expect(deleteAudioFile).toHaveBeenCalledWith('variant-1', 'old-drums')
      expect(fake.call).toHaveBeenCalledWith('stem-separation', 'separate', expect.objectContaining({ model: 'extended', splitGuitar: true, audio: expect.any(Uint8Array) }), expect.objectContaining({ onProgress: expect.any(Function) }))
    })
  })
})

describe('a host without add-ons (#964)', () => {
  it('ends a stem job with a message instead of hanging - the separation is the add-on\'s method and there is none to ask', async () => {
    store.clear()
    store.set('plugins:stem-separation', { _id: 'plugins:stem-separation', id: 'stem-separation', name: 'Spuren trennen', version: '0.0.1', enabled: true, runtime: 'server', capabilities: ['stem-separation'], installedAt: 1, source: 'builtin' })
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [{ id: 'mix-1', kind: 'band-mix' }] })
    store.set('async-jobs:stem-2', { id: 'stem-2', type: 'stem-separation', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'variant-1', sourceTrackId: 'mix-1', model: 'standard', splitGuitar: false, _id: 'async-jobs:stem-2' })
    const watcher = createAsyncJobWatcher({ database: { url: 'http://database', user: 'u', password: 'p' }, workspaceId: 'ws', log: { info: vi.fn(), error: vi.fn() } })
    await vi.waitFor(() => expect((store.get('async-jobs:stem-2') as { status?: string }).status).toBe('error'))
    watcher.stop()
    expect((store.get('async-jobs:stem-2') as { error?: string }).error).toBe('This device runs no add-ons')
  })
})
