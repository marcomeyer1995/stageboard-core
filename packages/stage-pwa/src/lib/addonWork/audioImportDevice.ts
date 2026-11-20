import { toTrackFormat } from 'sync-host'
import type { AsyncJob, AudioImportJob, TrackMeta } from 'shared-types'
import { randomId } from '../id'
import { activeDeviceJobs, deviceRunner } from '../youtubeDevice'
import type { AddonMethodResult } from '../addonMethodClient'

/**
 * "An add-on fetches audio", run by this device itself (docs/36 §7, #964) - for a tablet with no host that can: the same job as on a host, the same
 * order of steps, the add-on's method answered here (localMethods.ts). The job is a band document the whole band sees run; it is created running with
 * this device as its runner, so no host takes it too.
 */
export interface DeviceAudioImportDeps {
  /** The add-on's method (a local call): `onProgress` gets 0-1. */
  call(addonId: string, method: string, args: Record<string, unknown>, onProgress?: (fraction: number) => void): Promise<AddonMethodResult>
  putJob(job: AsyncJob): Promise<void>
  putTrack(variantId: string, meta: TrackMeta, file: Blob): Promise<void>
  /** Not too often - every write replicates to the band. */
  now?: () => number
  /** Any audio -> Ogg Opus for what cannot be re-wrapped (default: the WASM encoder, #730). */
  encode?: (file: Blob, onProgress: (done: number) => void) => Promise<Blob>
}

// Loaded only when the audio is not Opus - the encoder's WASM stays out of the app's start.
const encodeWithWasm = async (file: Blob, onProgress: (done: number) => void): Promise<Blob> => (await import('../engine/encodeForUpload')).encodeForUpload(file, onProgress)

const PROGRESS_WRITE_MS = 1000
/** Job progress when the add-on is through, and when an encode (if needed) is. */
const FETCHED_AT = 0.8
const ENCODED_AT = 0.95

export function newDeviceAudioImportJob(input: { variantId: string; addonId: string; method: string; args: Record<string, unknown>; label: string }, deviceId: string, now: number = Date.now()): AudioImportJob {
  return { id: randomId(), type: 'audio-import', status: 'running', progress: 0, createdAt: now, updatedAt: now, ...input, runner: deviceRunner(deviceId) }
}

/** Runs the job; never throws - every outcome is written into the job's document. */
export async function runAudioImportOnDevice(job: AudioImportJob, deps: DeviceAudioImportDeps): Promise<void> {
  const now = deps.now ?? Date.now
  activeDeviceJobs.add(job.id)
  let current: AudioImportJob = { ...job, status: 'running', updatedAt: now() }
  // Writes in order, so a late progress write never lands after the result.
  let writes = deps.putJob(current)
  const write = (patch: Partial<AudioImportJob>) => {
    current = { ...current, ...patch, updatedAt: now() }
    const snapshot = current
    writes = writes.then(() => deps.putJob(snapshot)).catch(() => {})
    return writes
  }
  try {
    let lastWrite = 0
    const answer = await deps.call(job.addonId, job.method, job.args, (fraction) => {
      if (now() - lastWrite < PROGRESS_WRITE_MS) return
      lastWrite = now()
      void write({ progress: Math.min(FETCHED_AT, fraction * FETCHED_AT) })
    })
    // The add-on's own words, as they are: this device adds nothing of its own to them.
    if (!answer.ok) throw new Error(answer.error.message)
    const { audio, ext } = answer.body as { audio: Uint8Array; ext: string }
    const format = toTrackFormat(audio, ext)
    const file = format.remuxed
      ? new Blob([format.data as BlobPart], { type: format.mimeType })
      : new Blob([await (deps.encode ?? encodeWithWasm)(new Blob([audio as BlobPart]), (done) => {
          if (now() - lastWrite < PROGRESS_WRITE_MS) return
          lastWrite = now()
          void write({ progress: FETCHED_AT + (ENCODED_AT - FETCHED_AT) * done })
        })], { type: 'audio/ogg' })
    const meta: TrackMeta = { id: randomId(), kind: 'reference', label: job.label, source: 'add-on', parentTrackId: null, mimeType: 'audio/ogg', addedAt: now(), sizeBytes: file.size }
    await deps.putTrack(job.variantId, meta, file)
    await write({ status: 'done', progress: 1, trackId: meta.id })
  } catch (err) {
    await write({ status: 'error', error: (err instanceof Error ? err.message : String(err)) || 'failed' })
  } finally {
    activeDeviceJobs.delete(job.id)
  }
}
