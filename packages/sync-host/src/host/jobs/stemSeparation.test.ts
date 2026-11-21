import { describe, expect, it, vi } from 'vitest'
import type { StemSeparationJob, TrackMeta } from 'shared-types'
import { runStemSeparation, STEM_LABELS, STEM_ROLES, type StemJobContext } from './stemSeparation.js'

type Patch = Parameters<StemJobContext['patchJob']>[0]

const job = (over: Partial<StemSeparationJob> = {}): StemSeparationJob => ({
  id: 'job-1', type: 'stem-separation', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'variant-1', sourceTrackId: 'src-1', model: 'standard', splitGuitar: false, ...over,
})

function memoryContext(over: Partial<StemJobContext> = {}) {
  const events: string[] = []
  const patches: Patch[] = []
  const audio = new Map<string, Uint8Array>([['variant-1/src-1', new Uint8Array([9, 9, 9])]])
  let attached: TrackMeta[] = []
  let ids = 0
  let clock = 0
  const ctx: StemJobContext = {
    log: { info: vi.fn(), error: vi.fn() },
    patchJob: async (p) => void patches.push(p),
    isSafeId: (id) => /^[a-zA-Z0-9-]+$/.test(id),
    bandHasStemPlugin: async () => true,
    readVariant: async () => ({ tracks: [{ id: 'src-1', kind: 'band-mix', durationMs: 123_000 }, { id: 'old-stem', kind: 'stem', parentTrackId: 'src-1' }] }),
    readAudio: async (v, t) => audio.get(`${v}/${t}`) ?? null,
    separate: async (_audio, _options, onProgress) => {
      events.push('separate')
      onProgress(0.5)
      return {
        stems: [
          { key: 'drums', data: new Uint8Array([1, 1]), opus: true },
          { key: 'vocals', data: new Uint8Array([2, 2, 2]), opus: true },
          { key: 'mystery', data: new Uint8Array([3]), opus: false },
        ],
        dispose: async () => void events.push('dispose'),
      }
    },
    writeAudio: async (v, t, d) => void (events.push('write'), audio.set(`${v}/${t}`, d)),
    deleteAudio: async (v, t) => void (events.push(`delete ${t}`), audio.delete(`${v}/${t}`)),
    replaceStems: async (_v, _src, stems) => {
      events.push('replace')
      attached = stems
      return ['old-stem']
    },
    newId: () => `stem-${++ids}`,
    now: () => (clock += 2_000),
    ...over,
  }
  return { ctx, events, patches, audio, attached: () => attached }
}

describe('the stem-separation recipe, with no tool and no database (#964)', () => {
  it('separates, stores every stem, attaches them in place of the earlier ones, deletes the replaced files, and says done with the stem ids', async () => {
    const t = memoryContext()
    await runStemSeparation(job(), t.ctx)
    expect(t.events).toEqual(['separate', 'write', 'write', 'write', 'replace', 'delete old-stem', 'dispose'])
    expect(t.attached().map((s) => s.id)).toEqual(['stem-1', 'stem-2', 'stem-3'])
    expect(t.patches[0]).toEqual({ status: 'running', progress: 0 })
    expect(t.patches.at(-1)).toEqual({ status: 'done', progress: 1, stemTrackIds: ['stem-1', 'stem-2', 'stem-3'] })
  })

  it('names and roles each stem, points it at the source, carries the source\'s duration, and types Ogg Opus or WebM', async () => {
    const t = memoryContext()
    await runStemSeparation(job(), t.ctx)
    expect(t.attached()[0]).toMatchObject({ kind: 'stem', label: STEM_LABELS.drums, role: STEM_ROLES.drums, parentTrackId: 'src-1', source: 'stem-separation', mimeType: 'audio/ogg', sizeBytes: 2, durationMs: 123_000 })
    expect(t.attached()[1]).toMatchObject({ label: 'Gesang', role: 'vocals', sizeBytes: 3 })
    // A stem the table does not know keeps its key as its label, has no role, and the older WebM type when the tool says so.
    expect(t.attached()[2]).toMatchObject({ label: 'mystery', mimeType: 'audio/webm' })
    expect(t.attached()[2]).not.toHaveProperty('role')
  })

  it('refuses unsafe ids, a band without the plugin, a missing variant, track and audio - each with its own code, before any separation', async () => {
    for (const [name, ctxOver, jobOver, code] of [
      ['unsafe id', {}, { sourceTrackId: '../x' }, 'job.invalidIds'],
      ['no plugin', { bandHasStemPlugin: async () => false }, {}, 'job.stemPluginMissing'],
      ['no variant', { readVariant: async () => null }, {}, 'job.variantGone'],
      ['no track', { readVariant: async () => ({ tracks: [] }) }, {}, 'job.trackGone'],
      ['no audio', { readAudio: async () => null }, {}, 'job.audioMissing'],
    ] as const) {
      const t = memoryContext(ctxOver)
      await runStemSeparation(job(jobOver), t.ctx)
      expect(t.events, name).toEqual([])
      expect(t.patches.at(-1), name).toMatchObject({ status: 'error', errorCode: code })
    }
  })

  it('removes the stems it stored when attaching them fails, still cleans up, and writes the error', async () => {
    const t = memoryContext({ replaceStems: async () => { throw new Error('variant locked') } })
    await runStemSeparation(job(), t.ctx)
    expect(t.events).toEqual(['separate', 'write', 'write', 'write', 'delete stem-1', 'delete stem-2', 'delete stem-3', 'dispose'])
    expect([...t.audio.keys()]).toEqual(['variant-1/src-1'])
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', error: 'variant locked' })
  })

  it('a failed separation is an error on the job with the tool\'s message, and does not throw', async () => {
    const t = memoryContext({ separate: async () => { throw new Error('demucs not found') } })
    await expect(runStemSeparation(job(), t.ctx)).resolves.toBeUndefined()
    expect(t.patches.at(-1)).toMatchObject({ status: 'error', error: 'demucs not found' })
  })

  it('hands the tool the audio and the options, and a failure to delete a replaced file does not fail the job', async () => {
    const separate = vi.fn(async () => ({ stems: [{ key: 'drums', data: new Uint8Array([1]), opus: true }] }))
    const t = memoryContext({ separate, deleteAudio: async () => { throw new Error('gone already') } })
    await runStemSeparation(job({ model: 'extended', splitGuitar: true }), t.ctx)
    expect(separate).toHaveBeenCalledWith(new Uint8Array([9, 9, 9]), { model: 'extended', splitGuitar: true }, expect.any(Function))
    expect(t.patches.at(-1)).toMatchObject({ status: 'done' })
  })

  it('writes progress throttled, never after the final write', async () => {
    const t = memoryContext({
      progressIntervalMs: 1_500,
      separate: async (_a, _o, onProgress) => {
        for (const p of [0.1, 0.2, 0.3, 0.4, 0.5]) onProgress(p)
        return { stems: [{ key: 'drums', data: new Uint8Array([1]), opus: true }] }
      },
      now: (() => {
        let n = 0
        return () => (n += 500)
      })(),
    })
    await runStemSeparation(job(), t.ctx)
    const doneAt = t.patches.findIndex((p) => p.status === 'done')
    expect(doneAt).toBe(t.patches.length - 1)
    expect(t.patches.filter((p) => p.status === 'running' && (p.progress ?? 0) > 0).length).toBeLessThan(5)
  })
})
