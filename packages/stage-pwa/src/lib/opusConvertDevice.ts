import type { AsyncJob, OpusConvertJob, TrackMeta } from 'shared-types'
import { activeDeviceJobs, deviceRunner } from './youtubeDevice'

/**
 * A track to Ogg Opus on this device (#822; Marco, 2026-11-14: "Gerät wandelt um"): the host
 * downloaded a video without Opus and has no decoder; any device with the app takes the
 * `opus-convert` job, decodes the file in its browser engine, encodes it with the WASM encoder it
 * uses for uploads - one converter on every host - and replaces the track's file (`fileRev` + 1;
 * the other devices fetch the new file, audioCache.ts).
 *
 * Two devices may take the same job at once (each writes its claim to its own copy): after
 * CLAIM_SETTLE_MS the claim is read back, and the one replication didn't keep steps aside.
 */

/** Time for the claims of two devices to meet in replication. */
export const CLAIM_SETTLE_MS = 3000
const PROGRESS_WRITE_MS = 1000
const ENCODED_AT = 0.95
const OPUS_MIME = 'audio/ogg'

/** The oldest conversion nobody has taken. */
export function nextOpusConvertJob(jobs: readonly AsyncJob[]): OpusConvertJob | undefined {
  return jobs
    .filter((job): job is OpusConvertJob => job.type === 'opus-convert' && job.status === 'queued' && !job.runner)
    .sort((a, b) => a.createdAt - b.createdAt)[0]
}

export interface OpusConvertDeps {
  putJob: (job: AsyncJob) => Promise<void>
  /** The job as replication left it. */
  readJob: (id: string) => Promise<AsyncJob | null>
  /** The track's current metadata, and its file. */
  readTrack: (variantId: string, trackId: string) => Promise<{ meta: TrackMeta; file: Blob } | null>
  putTrack: (variantId: string, meta: TrackMeta, file: Blob) => Promise<void>
  encode: (file: Blob, onProgress: (done: number) => void) => Promise<Blob>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Takes the job and runs it. 'skipped': another device has it; 'done' or 'error' otherwise. */
export async function runOpusConvert(job: OpusConvertJob, deviceId: string, deps: OpusConvertDeps): Promise<'done' | 'skipped' | 'error'> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const runner = deviceRunner(deviceId)
  activeDeviceJobs.add(job.id)
  let current: OpusConvertJob = { ...job, status: 'running', progress: 0, runner, updatedAt: now() }
  let writes = Promise.resolve()
  const write = (patch: Partial<OpusConvertJob>) => {
    current = { ...current, ...patch, updatedAt: now() }
    const snapshot = current
    writes = writes.then(() => deps.putJob(snapshot)).catch(() => {})
    return writes
  }
  try {
    await deps.putJob(current)
    await sleep(CLAIM_SETTLE_MS)
    const kept = await deps.readJob(job.id)
    if (!kept || kept.runner !== runner) return 'skipped'
    const track = await deps.readTrack(job.variantId, job.trackId)
    if (!track) throw new Error('track gone')
    // Converted meanwhile (by hand, the library conversion): nothing left to do.
    if (track.meta.mimeType.startsWith(OPUS_MIME)) {
      await write({ status: 'done', progress: 1 })
      return 'done'
    }
    let lastWrite = 0
    const opus = await deps.encode(track.file, (done) => {
      if (now() - lastWrite < PROGRESS_WRITE_MS) return
      lastWrite = now()
      void write({ progress: Math.min(ENCODED_AT, done * ENCODED_AT) })
    })
    const meta: TrackMeta = { ...track.meta, mimeType: OPUS_MIME, sizeBytes: opus.size, fileRev: (track.meta.fileRev ?? 0) + 1 }
    await deps.putTrack(job.variantId, meta, new Blob([opus], { type: OPUS_MIME }))
    await write({ status: 'done', progress: 1 })
    return 'done'
  } catch (err) {
    await write({ status: 'error', error: err instanceof Error ? err.message || 'failed' : String(err), errorCode: 'youtube.convertFailed' })
    return 'error'
  } finally {
    await writes
    activeDeviceJobs.delete(job.id)
  }
}
