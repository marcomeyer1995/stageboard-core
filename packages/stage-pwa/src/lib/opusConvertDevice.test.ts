import { describe, expect, it, vi } from 'vitest'
import type { AsyncJob, OpusConvertJob, TrackMeta } from 'shared-types'
import { nextOpusConvertJob, runOpusConvert, type OpusConvertDeps } from './opusConvertDevice'

const job = (patch: Partial<OpusConvertJob> = {}): OpusConvertJob => ({ id: 'c1', type: 'opus-convert', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', trackId: 't', label: 'YouTube', ...patch })
const meta: TrackMeta = { id: 't', kind: 'reference', label: 'YouTube', source: 'youtube-extract', parentTrackId: null, mimeType: 'audio/mp4', addedAt: 1, sizeBytes: 10 }

function deps(over: Partial<OpusConvertDeps> = {}) {
  const jobs = new Map<string, AsyncJob>()
  const d: OpusConvertDeps & { jobs: Map<string, AsyncJob> } = {
    jobs,
    putJob: vi.fn(async (j: AsyncJob) => void jobs.set(j.id, j)),
    readJob: vi.fn(async (id: string) => jobs.get(id) ?? null),
    readTrack: vi.fn(async () => ({ meta, file: new Blob(['aac']) })),
    putTrack: vi.fn(async () => {}),
    encode: vi.fn(async (_f: Blob, onProgress: (d: number) => void) => {
      onProgress(0.5)
      return new Blob(['OggS-encoded'])
    }),
    sleep: vi.fn(async () => {}),
    ...over,
  }
  return d
}

describe('opus-convert on a device (#822)', () => {
  it('takes the oldest conversion nobody has, never another job type', () => {
    const yt = { id: 'y', type: 'audio-import' as const, status: 'queued' as const, progress: 0, createdAt: 0, updatedAt: 0, variantId: 'v', addonId: 'a', method: 'm', args: {}, label: 'x' }
    expect(nextOpusConvertJob([job({ id: 'newer', createdAt: 5 }), job({ id: 'older', createdAt: 2 }), yt])?.id).toBe('older')
    expect(nextOpusConvertJob([job({ runner: 'device:other' }), job({ id: 'r', status: 'running' })])).toBeUndefined()
  })

  it('converts the track and replaces its file: Ogg Opus, next file revision, job done', async () => {
    const d = deps()
    expect(await runOpusConvert(job(), 'me', d)).toBe('done')
    expect(d.encode).toHaveBeenCalled()
    expect(d.putTrack).toHaveBeenCalledWith('v', expect.objectContaining({ id: 't', mimeType: 'audio/ogg', fileRev: 1, sizeBytes: 12 }), expect.any(Blob))
    expect(d.jobs.get('c1')).toMatchObject({ status: 'done', progress: 1, runner: 'device:me' })
  })

  it('steps aside when replication kept another device as the one doing it', async () => {
    const d = deps()
    d.readJob = vi.fn(async () => job({ status: 'running', runner: 'device:other' }))
    expect(await runOpusConvert(job(), 'me', d)).toBe('skipped')
    expect(d.encode).not.toHaveBeenCalled()
    expect(d.putTrack).not.toHaveBeenCalled()
  })

  it('a track that is Opus by now is not converted again', async () => {
    const d = deps({ readTrack: vi.fn(async () => ({ meta: { ...meta, mimeType: 'audio/ogg', fileRev: 2 }, file: new Blob(['OggS']) })) })
    expect(await runOpusConvert(job(), 'me', d)).toBe('done')
    expect(d.encode).not.toHaveBeenCalled()
  })

  it('a failed conversion is an error on the job, the track stays as it was', async () => {
    const d = deps({ encode: vi.fn(async () => Promise.reject(new Error('decode failed'))) })
    expect(await runOpusConvert(job(), 'me', d)).toBe('error')
    expect(d.putTrack).not.toHaveBeenCalled()
    expect(d.jobs.get('c1')).toMatchObject({ status: 'error', error: 'decode failed', errorCode: 'audio.convertFailed' })
  })
})
