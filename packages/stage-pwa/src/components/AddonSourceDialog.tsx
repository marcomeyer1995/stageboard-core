import { useMemo } from 'react'
import type { AsyncJob } from 'shared-types'
import { callAddonMethod } from '../lib/addonMethodClient'
import { localAddonMethods } from '../lib/addonWork'
import type { BuiltinAddon } from '../lib/addonUi/builtinAddons'
import { AddonSlot, type RequestHandler, type ViewWorkerFactory } from '../lib/addonUi/slotHost'
import { putAsyncJob } from '../lib/asyncJobsDb'
import { randomId } from '../lib/id'
import { newDeviceAudioImportJob, runAudioImportOnDevice } from '../lib/addonWork/audioImportDevice'
import { getDeviceId } from '../lib/deviceId'
import { NO_HOST_MESSAGE } from '../lib/hostUrl'
import { resolveHostFor } from '../lib/jobHost'
import i18n from '../i18n'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'
import { putTrack } from '../lib/songVariantsDb'

/** How large the arguments of an audio-import job may be (a link, an id - never data). */
export const MAX_JOB_ARGS_CHARS = 2_000
export const MAX_JOB_LABEL_CHARS = 300

/**
 * What is wrong with a view script's `core.queueAudioImport` request, or `null`. The job becomes a band document that replicates to every device, so what
 * a script may put in it is bounded and shaped here - not trusted because the script is ours today.
 */
export function queueRequestProblem(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'core.queueAudioImport needs {label, args}'
  const { label, args } = body as { label?: unknown; args?: unknown }
  if (typeof label !== 'string' || label.trim() === '') return 'core.queueAudioImport needs a label'
  if (label.length > MAX_JOB_LABEL_CHARS) return 'core.queueAudioImport: the label is too long'
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'core.queueAudioImport needs args as an object'
  if (JSON.stringify(args).length > MAX_JOB_ARGS_CHARS) return 'core.queueAudioImport: the args are too large'
  return null
}

/**
 * The add-on's own dialog for a song track source (docs/36 §6 slot `song-editor.track-source`, #964). It is shown INSTEAD of the "Track hinzufügen"
 * dialog, not on top of it; leaving it reopens that one. The editor knows nothing of the add-on's service: it draws its description and answers its
 * requests - only methods the add-on declared, plus `core.queueAudioImport`, and a host that can is tried before this device does it itself.
 */
export function AddonSourceDialog({ addon, variantId, query, onLeave, createWorker }: { addon: BuiltinAddon; variantId: string; query: string; onLeave: () => void; createWorker?: ViewWorkerFactory }) {
  const jobs = useAsyncJobsStore((s) => s.jobs)
  const sources = useMemo(() => ({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j as unknown as Record<string, unknown>])), state: {} }), [jobs])

  const handler: RequestHandler = async (method, body) => {
    if (method === 'core.closeSlot') return onLeave(), { ok: true, body: {} }
    if (method === 'core.queueAudioImport') {
      const { label, args } = body as { label: string; args: Record<string, unknown> } // shape checked by queueRequestProblem below
      const problem = queueRequestProblem(body)
      if (problem) return { ok: false, error: { code: 'request.invalid', message: problem } }
      const name = Object.prototype.hasOwnProperty.call(addon.contributes.methods, 'fetchAudio') ? 'fetchAudio' : null
      if (!name) return { ok: false, error: { code: 'request.invalid', message: 'This add-on fetches no audio' } }
      const input = { variantId, addonId: addon.id, method: name, args, label: label.trim() || addon.name }
      const host = await resolveHostFor('POST', `/addons/${encodeURIComponent(addon.id)}/methods/${name}`)
      if (host.base === null && (await localAddonMethods.canRun(addon.id))) {
        const job = newDeviceAudioImportJob(input, getDeviceId())
        void runAudioImportOnDevice(job, { call: (a, m, a2, onProgress) => localAddonMethods.call(a, m, a2, onProgress ? { onProgress } : {}), putJob: putAsyncJob, putTrack })
        return { ok: true, body: { jobId: job.id } }
      }
      if (host.base === null) return { ok: false, error: { code: 'host.none', message: host.message === 'no-host' ? NO_HOST_MESSAGE : host.message } }
      const now = Date.now()
      const job: AsyncJob = { id: randomId(), type: 'audio-import', status: 'queued', progress: 0, createdAt: now, updatedAt: now, ...input }
      await putAsyncJob(job)
      return { ok: true, body: { jobId: job.id } }
    }
    if (!Object.prototype.hasOwnProperty.call(addon.contributes.methods, method)) return { ok: false, error: { code: 'method.undeclared', message: `The add-on declared no method "${method}".` } }
    return callAddonMethod(addon.id, method, body)
  }

  return (
    <AddonSlot
      key={addon.id}
      slot="song-editor.track-source"
      addon={{ id: addon.id, code: addon.viewScript, permissions: addon.permissions, imageOrigins: addon.imageOrigins }}
      context={{ variantId, query }}
      language={i18n.language}
      sources={sources}
      onRequest={handler}
      onLeave={onLeave}
      {...(createWorker ? { createWorker } : {})}
    />
  )
}
