import { describe, expect, it, vi } from 'vitest'
import { bandHasAddonIn, runAudioImport } from 'sync-host'
import type { AsyncJob, AudioImportJob, TrackMeta } from 'shared-types'
import { tabletAudioImportContext, type TabletAudioImportPorts } from './tabletAudioImport'

const job: AudioImportJob = {
  id: 'j1',
  type: 'audio-import',
  status: 'running',
  progress: 0,
  createdAt: 1,
  updatedAt: 1,
  variantId: 'v1',
  addonId: 'youtube-download',
  method: 'fetchAudio',
  args: { url: 'u' },
  label: 'Song',
  runner: 'host:tab',
} as AudioImportJob

const installed = { _id: 'plugins:youtube-download', id: 'youtube-download', name: 'YouTube', version: '0.0.2', runtime: 'device', capabilities: [], transports: [], hardwareIds: [], enabled: true, installedAt: 1 }

function setUp(over: Partial<TabletAudioImportPorts> = {}) {
  const jobs = new Map<string, AsyncJob>([[job.id, job]])
  const tracks: { variantId: string; meta: TrackMeta; file: Blob }[] = []
  let n = 0
  const ports: TabletAudioImportPorts = {
    readJob: async (id) => jobs.get(id),
    putJob: async (j) => void jobs.set(j.id, j),
    pluginDocs: async () => [installed],
    bandHasAddon: bandHasAddonIn,
    variantExists: async (id) => id === 'v1',
    call: vi.fn(async () => ({ ok: true as const, body: { audio: new Uint8Array([1, 2, 3, 4]), ext: 'mp3' } })),
    putTrack: async (variantId, meta, file) => void tracks.push({ variantId, meta, file }),
    newId: () => `id-${++n}`,
    now: () => 50,
    log: { info: () => {}, error: () => {} },
    ...over,
  }
  const run = () => runAudioImport(job, tabletAudioImportContext(job, ports))
  return { ports, jobs, tracks, run }
}

describe('a tablet host runs the host recipe for a job it claimed (#964)', () => {
  it('attaches the track and ends the job done; a track that is not Opus is queued for a device to convert', async () => {
    const { jobs, tracks, run } = setUp()
    await run()
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ variantId: 'v1', meta: { kind: 'reference', label: 'Song', source: 'add-on', mimeType: 'audio/mpeg' } })
    expect(tracks[0]!.file.size).toBe(4)
    expect(jobs.get('j1')).toMatchObject({ status: 'done', progress: 1, trackId: tracks[0]!.meta.id, runner: 'host:tab' })
    const convert = [...jobs.values()].find((j) => j.type === 'opus-convert')
    expect(convert).toMatchObject({ status: 'queued', variantId: 'v1', trackId: tracks[0]!.meta.id })
  })

  it('refuses a job for an add-on the band has not installed - the add-on is never asked (the device recipe skipped this)', async () => {
    const { ports, jobs, tracks, run } = setUp({ pluginDocs: async () => [] })
    await run()
    expect(ports.call).not.toHaveBeenCalled()
    expect(tracks).toEqual([])
    expect(jobs.get('j1')).toMatchObject({ status: 'error', errorCode: 'addon.notInstalled' })
  })

  it('refuses an unsafe variant id and a variant that is gone', async () => {
    const unsafe = setUp()
    await runAudioImport({ ...job, variantId: '../x' }, tabletAudioImportContext({ ...job, variantId: '../x' }, unsafe.ports))
    expect(unsafe.jobs.get('j1')).toMatchObject({ status: 'error', errorCode: 'job.invalidVariantId' })
    const gone = setUp({ variantExists: async () => false })
    await gone.run()
    expect(gone.ports.call).not.toHaveBeenCalled()
    expect(gone.jobs.get('j1')).toMatchObject({ status: 'error', errorCode: 'job.variantGone' })
  })

  it("the add-on's own words go into the job; a track that cannot be stored leaves no job claiming success", async () => {
    const said = setUp({ call: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'Video nicht verfügbar' } })) as TabletAudioImportPorts['call'] })
    await said.run()
    expect(said.jobs.get('j1')).toMatchObject({ status: 'error', error: 'Video nicht verfügbar' })
    const storeFails = setUp({ putTrack: async () => Promise.reject(new Error('upload failed')) })
    await storeFails.run()
    expect(storeFails.jobs.get('j1')).toMatchObject({ status: 'error' })
  })
})
