import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { oggOpusInfo, type TrackMeta, type YoutubeExtractJob } from 'shared-types'
import { runYoutubeExtract, type YoutubeJobContext } from './youtubeExtract.js'
import { errorPatch, mimeTypeForExt, toTrackFormat, type JobPatch } from './trackFormat.js'

const webm = new Uint8Array(readFileSync(new URL('../../../../shared-types/src/__fixtures__/stereo.webm', import.meta.url)))

const job = (over: Partial<YoutubeExtractJob> = {}): YoutubeExtractJob => ({
  id: 'job-1', type: 'youtube-extract', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'variant-1', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', label: 'Intro', ...over,
})

/** A context made of memory: what happened, in order, is what the test reads. */
function memoryContext(over: Partial<YoutubeJobContext> = {}) {
  const events: string[] = []
  const patches: JobPatch[] = []
  const audio = new Map<string, Uint8Array>()
  const tracks: TrackMeta[] = []
  const converts: string[] = []
  let clock = 1_000
  const ctx: YoutubeJobContext = {
    log: { info: vi.fn(), error: vi.fn() },
    patchJob: async (patch) => void patches.push(patch),
    bandHasAddon: async () => true,
    isSafeVariantId: (id) => /^[a-zA-Z0-9-]+$/.test(id),
    variantExists: async () => true,
    download: async (_url, onProgress) => {
      events.push('download')
      onProgress(0.5)
      return { data: webm, ext: 'webm', dispose: async () => void events.push('dispose') }
    },
    writeAudio: async (variantId, trackId, data) => void (events.push('write'), audio.set(`${variantId}/${trackId}`, data)),
    deleteAudio: async (variantId, trackId) => void (events.push('delete'), audio.delete(`${variantId}/${trackId}`)),
    appendTrack: async (_variantId, meta) => void (events.push('append'), tracks.push(meta)),
    queueOpusConvert: async (_v, trackId) => void converts.push(trackId),
    newId: () => 'track-1',
    now: () => (clock += 2_000),
    ...over,
  }
  return { ctx, events, patches, audio, tracks, converts }
}

describe('the YouTube job recipe, with no tool and no database (#964)', () => {
  it('downloads, re-wraps Opus to Ogg, stores the file, attaches the track, and says done with the track id - in that order', async () => {
    const t = memoryContext()
    await runYoutubeExtract(job(), t.ctx)
    expect(t.events).toEqual(['download', 'write', 'append', 'dispose'])
    expect(t.tracks[0]).toMatchObject({ id: 'track-1', kind: 'reference', label: 'Intro', source: 'youtube-extract', mimeType: 'audio/ogg', parentTrackId: null })
    expect(t.audio.get('variant-1/track-1')?.length).toBe(t.tracks[0]!.sizeBytes)
    expect(t.patches[0]).toEqual({ status: 'running', progress: 0 })
    expect(t.patches.at(-1)).toEqual({ status: 'done', progress: 1, trackId: 'track-1' })
    expect(t.converts).toEqual([])
  })

  it('keeps a download that is not Opus as it is and queues a conversion for a device (#822)', async () => {
    const t = memoryContext({ download: async () => ({ data: new Uint8Array([1, 2, 3]), ext: 'm4a' }) })
    await runYoutubeExtract(job(), t.ctx)
    expect(t.tracks[0]).toMatchObject({ mimeType: 'audio/mp4' })
    expect(t.converts).toEqual(['track-1'])
    expect(t.patches.at(-1)).toMatchObject({ status: 'done' })
  })

  it('writes progress at most every interval, and never after the final write', async () => {
    const t = memoryContext({
      progressIntervalMs: 1_500,
      download: async (_url, onProgress) => {
        for (const p of [0.1, 0.2, 0.3, 0.4]) onProgress(p)
        return { data: webm, ext: 'webm' }
      },
      now: (() => {
        let n = 0
        return () => (n += 400)
      })(),
    })
    await runYoutubeExtract(job(), t.ctx)
    const last = t.patches.at(-1)
    expect(last).toMatchObject({ status: 'done' })
    const afterDone = t.patches.slice(t.patches.findIndex((p) => p.status === 'done') + 1)
    expect(afterDone).toEqual([])
    expect(t.patches.filter((p) => p.status === 'running').length).toBeLessThan(5)
  })

  it('refuses a band without the add-on, a URL that is no YouTube link, and an unsafe variant id - before downloading anything', async () => {
    for (const [name, ctxOver, jobOver, code] of [
      ['no add-on', { bandHasAddon: async () => false }, {}, 'youtube.addonMissing'],
      ['not YouTube', {}, { url: 'https://evil.example/x' }, 'youtube.urlOnly'],
      ['unsafe variant', {}, { variantId: '../x' }, 'job.invalidVariantId'],
    ] as const) {
      const t = memoryContext(ctxOver)
      await runYoutubeExtract(job(jobOver), t.ctx)
      expect(t.events, name).toEqual([])
      expect(t.patches.at(-1), name).toMatchObject({ status: 'error', errorCode: code })
    }
  })

  it('a variant deleted in the meantime ends the job with its message and downloads nothing', async () => {
    const t = memoryContext({ variantExists: async () => false })
    await runYoutubeExtract(job(), t.ctx)
    expect(t.events).toEqual([])
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', errorCode: 'job.variantGone' })
  })

  it('removes the audio it stored when attaching the track fails - no orphan no screen can reach - and still cleans up', async () => {
    const t = memoryContext({ appendTrack: async () => { throw new Error('database gone') } })
    await runYoutubeExtract(job(), t.ctx)
    expect(t.events).toEqual(['download', 'write', 'delete', 'dispose'])
    expect(t.audio.size).toBe(0)
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', error: 'database gone' })
  })

  it('a failed download is an error on the job with the tool\'s own message, and does not throw', async () => {
    const t = memoryContext({ download: async () => { throw new Error('No yt-dlp executable found') } })
    await expect(runYoutubeExtract(job(), t.ctx)).resolves.toBeUndefined()
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', error: 'No yt-dlp executable found' })
  })

  it('does not throw when even the error cannot be written', async () => {
    const t = memoryContext({ download: async () => { throw new Error('x') }, patchJob: async (p) => { if (p.status === 'error') throw new Error('offline') } })
    await expect(runYoutubeExtract(job(), t.ctx)).resolves.toBeUndefined()
    expect(t.ctx.log.error).toHaveBeenCalledWith('Failed to mark async job as failed', expect.anything())
  })
})

describe('the track format and the error patch (#964)', () => {
  it('re-wraps WebM with Opus as Ogg Opus - the same audio, exact length (shared-types\' remux test file: ffmpeg libopus, 72000 frames)', () => {
    const track = toTrackFormat(webm, 'webm')
    expect(track.remuxed).toBe(true)
    expect(track.mimeType).toBe('audio/ogg')
    expect(new TextDecoder().decode(track.data.subarray(0, 4))).toBe('OggS')
    expect(oggOpusInfo(track.data)).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
  })

  it('keeps anything else as downloaded - a host has no decoder to encode it anew; WebM without Opus (or damaged) stays WebM', () => {
    const m4a = new Uint8Array([110, 111, 116, 32, 119, 101, 98, 109])
    expect(toTrackFormat(m4a, 'm4a')).toEqual({ data: m4a, mimeType: 'audio/mp4', remuxed: false })
    expect(toTrackFormat(m4a, 'webm')).toEqual({ data: m4a, mimeType: 'audio/webm', remuxed: false })
  })

  it('guesses a playable type for an unlisted extension, case-insensitively', () => {
    expect(mimeTypeForExt('XYZ')).toBe('application/octet-stream')
    expect(mimeTypeForExt('MP3')).toBe('audio/mpeg')
  })

  it('turns an error into the message, with its code when it has one', () => {
    expect(errorPatch(new Error('boom'))).toEqual({ status: 'error', error: 'boom' })
  })
})
