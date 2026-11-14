import { useEffect } from 'react'
import type { AsyncJob } from 'shared-types'
import { getAllAsyncJobs, putAsyncJob } from './asyncJobsDb'
import { getDeviceId } from './deviceId'
import { nextOpusConvertJob, runOpusConvert } from './opusConvertDevice'
import { activeDeviceJobs, leftoverDeviceJobs } from './youtubeDevice'
import { getTrack, getTrackMeta, putTrack } from './songVariantsDb'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'

// The encoder's WASM is loaded only when a conversion runs - not at the app's start.
const encodeWithWasm = async (file: Blob, onProgress: (done: number) => void): Promise<Blob> => (await import('./engine/encodeForUpload')).encodeForUpload(file, onProgress)

let running = false
let requeued = false

/**
 * Mounted once in the app: takes the band's `opus-convert` jobs (#822) - a track the host could
 * not convert to Ogg Opus - one at a time, whenever one is waiting (opusConvertDevice.ts).
 */
export function useOpusConvertJobs(): void {
  const next = useAsyncJobsStore((state) => nextOpusConvertJob(state.jobs))
  const nextId = next?.id ?? null
  const jobCount = useAsyncJobsStore((state) => state.jobs.length)
  // Once per app session: a conversion this device had taken when it last stopped goes back to
  // the queue - another device (or this one) takes it again.
  useEffect(() => {
    if (requeued || jobCount === 0) return
    requeued = true
    for (const job of leftoverDeviceJobs(useAsyncJobsStore.getState().jobs, getDeviceId(), activeDeviceJobs)) {
      if (job.type !== 'opus-convert') continue
      const queued: AsyncJob = { ...job, status: 'queued', progress: 0, updatedAt: Date.now() }
      delete queued.runner
      void putAsyncJob(queued).catch(() => {})
    }
  }, [jobCount])
  useEffect(() => {
    if (!next || running) return
    running = true
    void runOpusConvert(next, getDeviceId(), {
      putJob: putAsyncJob,
      readJob: async (id): Promise<AsyncJob | null> => (await getAllAsyncJobs()).find((job) => job.id === id) ?? null,
      readTrack: async (variantId, trackId) => {
        const [meta, file] = await Promise.all([getTrackMeta(variantId, trackId), getTrack(variantId, trackId)])
        return meta && file ? { meta, file } : null
      },
      putTrack,
      encode: encodeWithWasm,
    }).finally(() => {
      running = false
    })
    // Keyed by the job: a new one waiting starts the next run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId])
}
