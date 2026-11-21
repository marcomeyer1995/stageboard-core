import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AudioImportJob, TrackMeta } from 'shared-types'
import { runAudioImport, type AudioImportContext } from './audioImport.js'
import type { JobPatch } from './trackFormat.js'

const webm = new Uint8Array(readFileSync(new URL('../../../../shared-types/src/__fixtures__/stereo.webm', import.meta.url)))

const job = (over: Partial<AudioImportJob> = {}): AudioImportJob => ({
  id: 'job-1', type: 'audio-import', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'variant-1',
  addonId: 'some-addon', method: 'fetchAudio', args: { url: 'whatever the add-on understands' }, label: 'Intro', ...over,
})

/** A context made of memory: what happened, in order, is what the test reads. */
function memoryContext(over: Partial<AudioImportContext> = {}) {
  const events: string[] = []
  const patches: JobPatch[] = []
  const asked: unknown[] = []
  const audio = new Map<string, Uint8Array>()
  const tracks: TrackMeta[] = []
  const converts: string[] = []
  let clock = 1_000
  const ctx: AudioImportContext = {
    log: { info: vi.fn(), error: vi.fn() },
    patchJob: async (patch) => void patches.push(patch),
    bandHasAddon: async () => true,
    isSafeVariantId: (id) => /^[a-zA-Z0-9-]+$/.test(id),
    variantExists: async () => true,
    fetchAudio: async (addonId, method, args, onProgress) => {
      events.push('fetch')
      asked.push({ addonId, method, args })
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
  return { ctx, events, patches, asked, audio, tracks, converts }
}

describe('the "an add-on fetches audio" recipe - no service, no tool, no database (#964)', () => {
  it('asks the named add-on its method with the job\'s args, re-wraps Opus to Ogg, stores, attaches, says done - in that order', async () => {
    const t = memoryContext()
    await runAudioImport(job(), t.ctx)
    expect(t.asked).toEqual([{ addonId: 'some-addon', method: 'fetchAudio', args: { url: 'whatever the add-on understands' } }])
    expect(t.events).toEqual(['fetch', 'write', 'append', 'dispose'])
    expect(t.tracks[0]).toMatchObject({ id: 'track-1', kind: 'reference', label: 'Intro', source: 'add-on', mimeType: 'audio/ogg', parentTrackId: null })
    expect(t.audio.get('variant-1/track-1')?.length).toBe(t.tracks[0]!.sizeBytes)
    expect(t.patches[0]).toEqual({ status: 'running', progress: 0 })
    expect(t.patches.at(-1)).toEqual({ status: 'done', progress: 1, trackId: 'track-1' })
    expect(t.converts).toEqual([])
  })

  it('keeps audio that is not Opus as it is and queues a conversion for a device (#822)', async () => {
    const t = memoryContext({ fetchAudio: async () => ({ data: new Uint8Array([1, 2, 3]), ext: 'm4a' }) })
    await runAudioImport(job(), t.ctx)
    expect(t.tracks[0]).toMatchObject({ mimeType: 'audio/mp4' })
    expect(t.converts).toEqual(['track-1'])
  })

  it('writes progress at most every interval, and never after the final write', async () => {
    const t = memoryContext({
      progressIntervalMs: 1_500,
      fetchAudio: async (_a, _m, _args, onProgress) => {
        for (const p of [0.1, 0.2, 0.3, 0.4]) onProgress(p)
        return { data: webm, ext: 'webm' }
      },
      now: (() => { let n = 0; return () => (n += 400) })(),
    })
    await runAudioImport(job(), t.ctx)
    expect(t.patches.slice(t.patches.findIndex((p) => p.status === 'done') + 1)).toEqual([])
    expect(t.patches.filter((p) => p.status === 'running').length).toBeLessThan(5)
  })

  it('refuses a band without the add-on (naming it) and an unsafe variant id - before asking the add-on anything', async () => {
    const noAddon = memoryContext({ bandHasAddon: async () => false })
    await runAudioImport(job(), noAddon.ctx)
    expect(noAddon.events).toEqual([])
    expect(noAddon.patches.at(-1)).toMatchObject({ status: 'error', errorCode: 'addon.notInstalled', errorParams: { addon: 'some-addon' } })
    const unsafe = memoryContext()
    await runAudioImport(job({ variantId: '../x' }), unsafe.ctx)
    expect(unsafe.events).toEqual([])
    expect(unsafe.patches.at(-1)).toMatchObject({ status: 'error', errorCode: 'job.invalidVariantId' })
  })

  it('a variant deleted in the meantime ends the job with its message and asks the add-on nothing', async () => {
    const t = memoryContext({ variantExists: async () => false })
    await runAudioImport(job(), t.ctx)
    expect(t.events).toEqual([])
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', errorCode: 'job.variantGone' })
  })

  it('removes the audio it stored when attaching the track fails - no orphan - and still cleans up', async () => {
    const t = memoryContext({ appendTrack: async () => { throw new Error('database gone') } })
    await runAudioImport(job(), t.ctx)
    expect(t.events).toEqual(['fetch', 'write', 'delete', 'dispose'])
    expect(t.audio.size).toBe(0)
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', error: 'database gone' })
  })

  it('the add-on\'s own words become the job\'s error as they are - the core adds nothing of its own to them', async () => {
    const t = memoryContext({ fetchAudio: async () => { throw new Error('Nur youtube.com/youtu.be-Links werden unterstützt.') } })
    await expect(runAudioImport(job(), t.ctx)).resolves.toBeUndefined()
    expect(t.patches.at(-1)).toEqual({ status: 'error', error: 'Nur youtube.com/youtu.be-Links werden unterstützt.' })
  })

  it('does not throw when even the error cannot be written', async () => {
    const t = memoryContext({ fetchAudio: async () => { throw new Error('x') }, patchJob: async (p) => { if (p.status === 'error') throw new Error('offline') } })
    await expect(runAudioImport(job(), t.ctx)).resolves.toBeUndefined()
    expect(t.ctx.log.error).toHaveBeenCalledWith('Failed to mark async job as failed', expect.anything())
  })
})
