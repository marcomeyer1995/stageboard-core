import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { oggOpusInfo, type AudioImportJob } from 'shared-types'
import type { DatabaseDoc } from './database.js'

// The real watcher, the real add-on in its sandbox and the real recipe; only the database and the audio store on disk are stand-ins, and yt-dlp is
// a small script that speaks its progress protocol and leaves a real WebM/Opus file.
const store = new Map<string, Record<string, unknown>>()
vi.mock('./database.js', () => ({
  allDocs: vi.fn(async (_c: unknown, _db: string, { startkey }: { startkey: string }) => [...store.entries()].filter(([id]) => id.startsWith(startkey)).map(([, doc]) => structuredClone(doc))),
  getDoc: vi.fn(async (_c: unknown, _db: string, id: string) => (store.has(id) ? structuredClone(store.get(id)) : null)),
  putDocWithRetry: vi.fn(async (_c: unknown, _db: string, id: string, build: (existing: DatabaseDoc | null) => DatabaseDoc) => {
    const existing = store.has(id) ? (structuredClone(store.get(id)) as DatabaseDoc) : null
    store.set(id, build(existing) as Record<string, unknown>)
  }),
  waitForChange: vi.fn(() => new Promise(() => {})),
}))
vi.mock('./audioStore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audioStore.js')>()),
  writeAudioFile: vi.fn(async () => {}),
  deleteAudioFile: vi.fn(async () => {}),
}))

import { writeAudioFile } from './audioStore.js'
import { createAddonMethods } from './addons/addonMethods.js'
import { createAsyncJobWatcher } from './asyncJobWatcher.js'

vi.setConfig({ testTimeout: 30_000 })

const FIXTURE = new URL('../../shared-types/src/__fixtures__/stereo.webm', import.meta.url).pathname
let dir: string
let previous: string | undefined
const log = { info: vi.fn(), error: vi.fn() }
const database = { url: 'http://database', user: 'u', password: 'p' }
const addonMethods = createAddonMethods()

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-audio-import-'))
  const fake = join(dir, 'fake-yt-dlp.sh')
  writeFileSync(fake, `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -o) OUT="$2"; shift 2;; *) shift;; esac; done
DEST="\${OUT/\\%(ext)s/webm}"
echo "[download] Destination: $DEST"
echo "[download]  40.0% of 1MiB at 1MiB/s ETA 00:01"; sleep 0.2
cp "${FIXTURE}" "$DEST"
`)
  chmodSync(fake, 0o755)
  previous = process.env.YT_DLP_PATH
  process.env.YT_DLP_PATH = fake
})
afterAll(() => {
  if (previous === undefined) delete process.env.YT_DLP_PATH
  else process.env.YT_DLP_PATH = previous
  rmSync(dir, { recursive: true, force: true })
})

const job = (over: Partial<AudioImportJob> = {}): AudioImportJob => ({
  id: 'job-1', type: 'audio-import', status: 'queued', progress: 0, createdAt: 1000, updatedAt: 1000, variantId: 'variant-1',
  addonId: 'youtube-download', method: 'fetchAudio', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, label: 'Via add-on', ...over,
})
const putJob = (over: Partial<AudioImportJob> = {}) => store.set(`async-jobs:${job(over).id}`, { ...job(over), _id: `async-jobs:${job(over).id}` })
const stored = (id: string) => store.get(`async-jobs:${id}`) as (AudioImportJob & { runner?: string; errorCode?: string; errorParams?: unknown }) | undefined
const installAddon = () => store.set('plugins:youtube-download', { _id: 'plugins:youtube-download', id: 'youtube-download', name: 'YouTube', version: '1.0.0', enabled: true, runtime: 'server', capabilities: [], installedAt: 1, source: 'builtin' })

beforeEach(() => {
  store.clear()
  vi.mocked(writeAudioFile).mockClear()
  store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', tracks: [{ id: 'keep-me', kind: 'band-mix', label: 'Existing' }] })
})

describe('an audio-import job through the real add-on (#964, docs/36 §7)', () => {
  it('fetches through the add-on\'s sandbox: the job ends done, the track is attached as Ogg Opus, the existing tracks stay', async () => {
    installAddon()
    putJob()
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, hostId: 'laptop', addonMethods })
    await vi.waitFor(() => expect(stored('job-1')?.status, JSON.stringify(stored('job-1'))).toBe('done'), { timeout: 15_000 })
    watcher.stop()
    expect(stored('job-1')).toMatchObject({ progress: 1, runner: 'host:laptop' })
    const tracks = (store.get('song-variants:variant-1') as { tracks: { id: string; source?: string; mimeType?: string; label?: string }[] }).tracks
    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toEqual({ id: 'keep-me', kind: 'band-mix', label: 'Existing' })
    expect(tracks[1]).toMatchObject({ id: stored('job-1')?.trackId, kind: 'reference', label: 'Via add-on', source: 'add-on', mimeType: 'audio/ogg' })
    const written = vi.mocked(writeAudioFile).mock.calls[0]![2] as Buffer
    expect(oggOpusInfo(new Uint8Array(written))).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
    expect(readFileSync(FIXTURE).length).toBeGreaterThan(0)
  })

  it('the add-on\'s own words end the job when it refuses the link - and nothing is attached', async () => {
    installAddon()
    putJob({ args: { url: 'https://evil.example/--exec=rm' } })
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, hostId: 'laptop', addonMethods })
    await vi.waitFor(() => expect(stored('job-1')?.status).toBe('error'), { timeout: 15_000 })
    watcher.stop()
    expect(stored('job-1')).toMatchObject({ error: 'Nur youtube.com/youtu.be-Links werden unterstützt.' })
    expect(stored('job-1')?.errorCode).toBeUndefined()
    expect(writeAudioFile).not.toHaveBeenCalled()
    expect((store.get('song-variants:variant-1') as { tracks: unknown[] }).tracks).toHaveLength(1)
  })

  it('a band without the add-on gets the generic "not installed" with the add-on named - the add-on is never started', async () => {
    putJob()
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, hostId: 'laptop', addonMethods })
    await vi.waitFor(() => expect(stored('job-1')?.status).toBe('error'), { timeout: 15_000 })
    watcher.stop()
    expect(stored('job-1')).toMatchObject({ errorCode: 'addon.notInstalled', errorParams: { addon: 'youtube-download' } })
  })

  it('a device without add-ons says so instead of hanging', async () => {
    installAddon()
    putJob()
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, hostId: 'laptop' })
    await vi.waitFor(() => expect(stored('job-1')?.status).toBe('error'), { timeout: 15_000 })
    watcher.stop()
    expect(stored('job-1')?.error).toBe('This device runs no add-ons')
  })

  it('a job whose add-on this host does not have is left queued for a host that does (needs plugin:<id>)', async () => {
    installAddon()
    putJob({ addonId: 'some-other-addon' })
    const watcher = createAsyncJobWatcher({ database, workspaceId: 'ws', log, hostId: 'tablet', canDo: (needs) => needs !== 'plugin:some-other-addon', needsOf: (j) => (j.addonId ? `plugin:${j.addonId}` : null), hasPeers: () => true, addonMethods })
    await new Promise((r) => setTimeout(r, 300))
    watcher.stop()
    expect(stored('job-1')).toMatchObject({ status: 'queued' })
    expect(stored('job-1')?.runner).toBeUndefined()
  })
})
