import { isSafeAudioId, type AudioImportContext } from 'sync-host'
import type { AsyncJob, AudioImportJob, OpusConvertJob, TrackMeta } from 'shared-types'
import type { AddonMethodResult } from '../lib/addonMethodClient'

/**
 * The tablet host's side of "an add-on fetches audio" (#964): when it has claimed a job as a host, it runs the **host's** recipe
 * (sync-host's `runAudioImport`) - the same checks and steps as the laptop (the band has the add-on, a safe variant id, the variant
 * still exists, a file never left behind without its track). It used to run the device's own recipe, which skips those checks: they
 * are for a job this device made itself, not for one any device of the band queued.
 *
 * These are the tablet's ports for it: the band's documents in the app's PouchDB, the add-on's method answered here, the track the way
 * the app stores one (upload to the host's audio store, local cache, the variant's track list). A track that is not Opus is queued for
 * a device to convert (#822) - this tablet's own converter takes it like any device's.
 */
export interface TabletAudioImportPorts {
  readJob(id: string): Promise<AsyncJob | undefined>
  putJob(job: AsyncJob): Promise<void>
  /** The band's `plugins:` documents. */
  pluginDocs(): Promise<unknown[]>
  bandHasAddon: (docs: readonly unknown[], addonId: string) => boolean
  variantExists(variantId: string): Promise<boolean>
  /** The add-on's method, answered on this device. */
  call(addonId: string, method: string, args: Record<string, unknown>, onProgress: (fraction: number) => void): Promise<AddonMethodResult>
  /** Stores the track's file and appends its metadata to the variant. */
  putTrack(variantId: string, meta: TrackMeta, file: Blob): Promise<void>
  newId(): string
  now(): number
  log: AudioImportContext['log']
}

export function tabletAudioImportContext(job: AudioImportJob, ports: TabletAudioImportPorts): AudioImportContext {
  // The recipe writes the file, then the track: the app stores both in one step, so the file waits here for its track.
  const files = new Map<string, Uint8Array>()
  const key = (variantId: string, trackId: string) => `${variantId}/${trackId}`
  // Job writes in order: a late progress write never lands after the result.
  let writes: Promise<void> = Promise.resolve()

  return {
    log: ports.log,
    patchJob(patch) {
      writes = writes.then(async () => {
        const current = (await ports.readJob(job.id)) ?? job
        await ports.putJob({ ...current, ...patch, updatedAt: ports.now() } as AsyncJob)
      })
      return writes
    },
    bandHasAddon: async (addonId) => ports.bandHasAddon(await ports.pluginDocs(), addonId),
    isSafeVariantId: isSafeAudioId,
    variantExists: (variantId) => ports.variantExists(variantId),
    async fetchAudio(addonId, method, args, onProgress) {
      const answer = await ports.call(addonId, method, args, onProgress)
      // The add-on's own words, as they are.
      if (!answer.ok) throw new Error(answer.error.message)
      const body = answer.body as { audio: Uint8Array; ext: string }
      return { data: body.audio, ext: body.ext }
    },
    writeAudio: async (variantId, trackId, data) => void files.set(key(variantId, trackId), data),
    deleteAudio: async (variantId, trackId) => void files.delete(key(variantId, trackId)),
    async appendTrack(variantId, meta) {
      const data = files.get(key(variantId, meta.id))
      if (!data) throw new Error('The track file is missing')
      await ports.putTrack(variantId, meta, new Blob([data as BlobPart], { type: meta.mimeType }))
      files.delete(key(variantId, meta.id))
    },
    async queueOpusConvert(variantId, trackId, label) {
      const now = ports.now()
      const convert: OpusConvertJob = { id: ports.newId(), type: 'opus-convert', status: 'queued', progress: 0, createdAt: now, updatedAt: now, variantId, trackId, label }
      await ports.putJob(convert)
    },
    newId: ports.newId,
    now: ports.now,
    progressIntervalMs: 1_000,
  }
}
