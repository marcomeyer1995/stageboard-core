import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { androidHelperCerts, oggOpusInfo, webmOpusToOgg, type AsyncJob, type HostCapabilities, type TrackMeta } from 'shared-types'
import { catalogEntry } from './pluginCatalog'
import type { HelperInfo } from './nativeHelper'

// The helper itself is an Android app: here its answer - the real WebM/Opus file of shared-types'
// remux test (ffmpeg's libopus + WebM muxer, 72000 frames).
const webm = readFileSync(join(__dirname, '../../../shared-types/src/__fixtures__/stereo.webm'))
const runHelper = vi.fn()
vi.mock('./nativeHelper', async (importOriginal) => ({ ...(await importOriginal<typeof import('./nativeHelper')>()), runHelper: (...args: unknown[]) => runHelper(...args) }))

const { activeDeviceJobs, leftoverDeviceJobs, newDeviceJob, runOnDevice, searchOnDevice, youtubeRoute } = await import('./youtubeDevice')
const { HelperError } = await import('./nativeHelper')

// The trust list comes from the installed manifest (#756) - here the one the catalog carries.
const CERTS = androidHelperCerts(catalogEntry('youtube-download')!)
const trusted: HelperInfo = { package: 'de.stageboard.helper.youtube', certSha256: CERTS[0]!, apiVersion: 1 }
const stranger: HelperInfo = { ...trusted, certSha256: 'ab'.repeat(32) }
const host = (available: boolean): HostCapabilities => ({ kind: 'stage-server', platform: 'linux', arch: 'x64', database: 'couchdb', plugins: [{ id: 'youtube-download', available, needs: available ? null : 'yt-dlp' }] })

describe('youtubeRoute', () => {
  it('the host when it can, else a trusted helper on this device, else nowhere', () => {
    expect(youtubeRoute(host(true), trusted, CERTS)).toBe('server')
    expect(youtubeRoute(host(false), trusted, CERTS)).toBe('device')
    expect(youtubeRoute(null, trusted, CERTS)).toBe('device') // no host at all (Solo)
    expect(youtubeRoute(host(false), stranger, CERTS)).toBe('none') // signed by someone else: never used
    expect(youtubeRoute(host(false), null, CERTS)).toBe('none')
    expect(youtubeRoute(host(false), trusted, [])).toBe('none') // the add-on names no helper certificate
    // A host that doesn't say what it can: asked as before (it answers what is missing).
    expect(youtubeRoute(null, null, CERTS)).toBe('server')
  })
})

describe('runOnDevice', () => {
  const deps = () => {
    const jobs: AsyncJob[] = []
    const tracks: { variantId: string; meta: TrackMeta; file: Blob }[] = []
    return { jobs, tracks, putJob: async (j: AsyncJob) => void jobs.push(j), putTrack: async (variantId: string, meta: TrackMeta, file: Blob) => void tracks.push({ variantId, meta, file }) }
  }

  it('downloads, re-wraps the Opus as Ogg and adds it as the job\'s track - the band sees it run', async () => {
    runHelper.mockImplementation(async (_addon, _helper, op, _args, options: { onProgress?: (v: number) => void }) => {
      expect(op).toBe('download')
      options.onProgress?.(0.5)
      return { result: { itag: 251, codec: 'opus', container: 'webm', kbps: 160, bytes: webm.length, title: 'T', durationSec: 2 }, file: new Blob([webm]) }
    })
    const d = deps()
    const job = newDeviceJob('variant-1', 'https://youtu.be/abcdefghijk', 'Referenz', 'redmi')
    await runOnDevice(job, 'redmi', trusted, CERTS, d)
    expect(d.jobs[0]).toMatchObject({ status: 'running', runner: 'device:redmi' })
    const last = d.jobs[d.jobs.length - 1]!
    expect(last).toMatchObject({ status: 'done', progress: 1, trackId: d.tracks[0]!.meta.id })
    expect(d.tracks[0]!.meta).toMatchObject({ kind: 'reference', source: 'youtube-extract', mimeType: 'audio/ogg', label: 'Referenz', durationMs: 2000 })
    const ogg = new Uint8Array(await d.tracks[0]!.file.arrayBuffer())
    expect(oggOpusInfo(ogg)).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
    expect(activeDeviceJobs.has(job.id)).toBe(false)
  })

  it("reports the helper's own error code on the job", async () => {
    runHelper.mockRejectedValue(new HelperError('youtube.tooLarge', '300000000 bytes'))
    const d = deps()
    await runOnDevice(newDeviceJob('v', 'https://youtu.be/abcdefghijk', 'R', 'redmi'), 'redmi', trusted, CERTS, d)
    expect(d.jobs[d.jobs.length - 1]).toMatchObject({ status: 'error', errorCode: 'youtube.tooLarge', errorParams: { mb: 200 } })
    expect(d.tracks).toHaveLength(0)
  })

  it('never runs an untrusted helper', async () => {
    runHelper.mockClear()
    const d = deps()
    await runOnDevice(newDeviceJob('v', 'https://youtu.be/abcdefghijk', 'R', 'redmi'), 'redmi', stranger, CERTS, d)
    expect(runHelper).not.toHaveBeenCalled()
    expect(d.jobs[d.jobs.length - 1]).toMatchObject({ status: 'error', errorCode: 'helper.untrusted' })
  })

  const aac = { result: { itag: 140, codec: 'mp4a.40.2', container: 'm4a', kbps: 128, bytes: 4, title: 'T', durationSec: 1 }, file: new Blob(['m4a?']) }

  it('without Opus it encodes on the device - still Ogg Opus, never another format', async () => {
    runHelper.mockResolvedValue(aac)
    const encoded = webmOpusToOgg(new Uint8Array(webm))!
    const encode = vi.fn(async (file: Blob, onProgress: (done: number) => void) => {
      expect(await file.text()).toBe('m4a?')
      onProgress(1)
      return new Blob([encoded])
    })
    const d = deps()
    await runOnDevice(newDeviceJob('v', 'https://youtu.be/abcdefghijk', 'R', 'redmi'), 'redmi', trusted, CERTS, { ...d, encode })
    expect(encode).toHaveBeenCalledOnce()
    expect(d.jobs[d.jobs.length - 1]).toMatchObject({ status: 'done', progress: 1 })
    expect(d.tracks[0]!.meta.mimeType).toBe('audio/ogg')
    expect(d.tracks[0]!.file.type).toBe('audio/ogg')
    expect(oggOpusInfo(new Uint8Array(await d.tracks[0]!.file.arrayBuffer()))).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
  })

  it("Opus the remux can't take is encoded too", async () => {
    runHelper.mockResolvedValue({ result: { ...aac.result, itag: 251, codec: 'opus', container: 'webm' }, file: new Blob(['not webm']) })
    const encode = vi.fn(async () => new Blob([webmOpusToOgg(new Uint8Array(webm))!]))
    const d = deps()
    await runOnDevice(newDeviceJob('v', 'https://youtu.be/abcdefghijk', 'R', 'redmi'), 'redmi', trusted, CERTS, { ...d, encode })
    expect(encode).toHaveBeenCalledOnce()
    expect(d.jobs[d.jobs.length - 1]).toMatchObject({ status: 'done' })
  })

  it('a failed encode is reported, nothing stored', async () => {
    runHelper.mockResolvedValue(aac)
    const d = deps()
    await runOnDevice(newDeviceJob('v', 'https://youtu.be/abcdefghijk', 'R', 'redmi'), 'redmi', trusted, CERTS, { ...d, encode: async () => Promise.reject(new Error('EncodingError: unable to decode')) })
    expect(d.jobs[d.jobs.length - 1]).toMatchObject({ status: 'error', errorCode: 'youtube.convertFailed' })
    expect(d.jobs[d.jobs.length - 1]!.error).toContain('mp4a.40.2 (itag 140): EncodingError')
    expect(d.tracks).toHaveLength(0)
  })
})

describe('searchOnDevice', () => {
  it('keeps the well-formed hits', async () => {
    runHelper.mockResolvedValue({ result: { results: [{ id: 'eRsGyueVLvQ', title: 'Sintel', channel: 'Blender', durationSec: 888, url: 'https://www.youtube.com/watch?v=eRsGyueVLvQ' }, { id: 'broken' }] }, file: null })
    expect(await searchOnDevice(trusted, 'sintel', CERTS)).toEqual([{ id: 'eRsGyueVLvQ', title: 'Sintel', channel: 'Blender', durationSec: 888, url: 'https://www.youtube.com/watch?v=eRsGyueVLvQ' }])
  })
})

describe('leftoverDeviceJobs', () => {
  it("only this device's running jobs that aren't running now", () => {
    const mine = newDeviceJob('v', 'u', 'l', 'redmi')
    const other = newDeviceJob('v', 'u', 'l', 'fire')
    const server: AsyncJob = { ...mine, id: 'server-job', runner: undefined }
    expect(leftoverDeviceJobs([mine, other, server], 'redmi', new Set()).map((j) => j.id)).toEqual([mine.id])
    expect(leftoverDeviceJobs([mine], 'redmi', new Set([mine.id]))).toEqual([])
  })
})
