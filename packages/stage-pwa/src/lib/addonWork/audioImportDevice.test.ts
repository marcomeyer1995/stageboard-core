import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { oggOpusInfo, type AsyncJob, type AudioImportJob, type TrackMeta } from 'shared-types'
import { newDeviceAudioImportJob, runAudioImportOnDevice, type DeviceAudioImportDeps } from './audioImportDevice'

const webm = new Uint8Array(readFileSync(join(process.cwd(), '../shared-types/src/__fixtures__/stereo.webm')))

function memory(over: Partial<DeviceAudioImportDeps> = {}) {
  const jobs: AsyncJob[] = []
  const tracks: { meta: TrackMeta; file: Blob }[] = []
  let clock = 1_000
  const deps: DeviceAudioImportDeps = {
    call: async (_a, _m, _args, onProgress) => (onProgress?.(0.5), { ok: true, body: { audio: webm, ext: 'webm' } }),
    putJob: async (job) => void jobs.push(job),
    putTrack: async (_v, meta, file) => void tracks.push({ meta, file }),
    now: () => (clock += 2_000),
    ...over,
  }
  return { deps, jobs, tracks }
}
const last = <T,>(items: T[]): T | undefined => items[items.length - 1]
const job = (): AudioImportJob => newDeviceAudioImportJob({ variantId: 'v1', addonId: 'youtube-download', method: 'fetchAudio', args: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, label: 'Intro' }, 'tablet-1', 1000)

describe('an audio-import job run by this device itself (docs/36 §7, #964)', () => {
  it('is created running with this device as its runner - no host takes it', () => {
    expect(job()).toMatchObject({ type: 'audio-import', status: 'running', runner: 'device:tablet-1', addonId: 'youtube-download', method: 'fetchAudio' })
  })

  it('asks the add-on, re-wraps Opus as Ogg, stores the track, and ends the job done - the way a host does', async () => {
    const m = memory()
    const asked: unknown[] = []
    await runAudioImportOnDevice(job(), { ...m.deps, call: async (a, method, args, onProgress) => (asked.push([a, method, args]), m.deps.call(a, method, args, onProgress)) })
    expect(asked).toEqual([['youtube-download', 'fetchAudio', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]])
    expect(m.tracks).toHaveLength(1)
    expect(m.tracks[0]!.meta).toMatchObject({ kind: 'reference', label: 'Intro', source: 'add-on', mimeType: 'audio/ogg', parentTrackId: null })
    expect(oggOpusInfo(new Uint8Array(await m.tracks[0]!.file.arrayBuffer()))).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
    expect(last(m.jobs)).toMatchObject({ status: 'done', progress: 1, trackId: m.tracks[0]!.meta.id })
  })

  it('audio the device cannot re-wrap is encoded here, as before (#730) - and an encoder failure is the job\'s error', async () => {
    const encode = vi.fn(async () => new Blob([new Uint8Array([5, 5, 5])]))
    const m = memory({ call: async () => ({ ok: true, body: { audio: new Uint8Array([1, 2, 3]), ext: 'm4a' } }), encode })
    await runAudioImportOnDevice(job(), m.deps)
    expect(encode).toHaveBeenCalled()
    expect(m.tracks[0]!.meta.mimeType).toBe('audio/ogg')
    const broken = memory({ call: async () => ({ ok: true, body: { audio: new Uint8Array([1]), ext: 'm4a' } }), encode: async () => { throw new Error('no decoder') } })
    await runAudioImportOnDevice(job(), broken.deps)
    expect(last(broken.jobs)).toMatchObject({ status: 'error' })
    expect(broken.tracks).toEqual([])
  })

  it('the add-on\'s own words are the job\'s error; nothing is stored', async () => {
    const m = memory({ call: async () => ({ ok: false, error: { code: 'youtube.urlOnly', message: 'Nur youtube.com/youtu.be-Links werden unterstützt.' } }) })
    await runAudioImportOnDevice(job(), m.deps)
    expect(last(m.jobs)).toMatchObject({ status: 'error', error: 'Nur youtube.com/youtu.be-Links werden unterstützt.' })
    expect(m.tracks).toEqual([])
  })

  it('progress is written at most once a second and never after the end', async () => {
    const m = memory({ call: async (_a, _m, _args, onProgress) => { for (const f of [0.1, 0.2, 0.3, 0.4]) onProgress?.(f); return { ok: true, body: { audio: webm, ext: 'webm' } } }, now: (() => { let n = 0; return () => (n += 200) })() })
    await runAudioImportOnDevice(job(), m.deps)
    expect(m.jobs.slice(m.jobs.findIndex((j) => j.status === 'done') + 1)).toEqual([])
    expect(m.jobs.filter((j) => j.status === 'running').length).toBeLessThan(6)
  })
})
