import type { AsyncJob } from 'shared-types'
import { stemRequestOf } from '../lib/addonUi/stemRequest'
import { callAddonMethod } from '../lib/addonMethodClient'
import type { BuiltinAddon } from '../lib/addonUi/builtinAddons'
import { AddonSlot, type RequestHandler, type ViewWorkerFactory } from '../lib/addonUi/slotHost'
import { putAsyncJob } from '../lib/asyncJobsDb'
import { randomId } from '../lib/id'
import i18n from '../i18n'

/**
 * An add-on's dialog for one track of a song (docs/36 §6 slot `song-editor.track-action`, #964). The editor knows nothing of what the add-on does with the
 * track: it draws the add-on's description and answers its requests - the methods the add-on declared, and `core.queueStemSeparation`, which writes the job
 * the host (or a device that can) takes. The add-on's texts are its own.
 */
export function AddonTrackActionDialog({
  addon,
  variantId,
  track,
  onClose,
  createWorker,
}: {
  addon: BuiltinAddon
  variantId: string
  track: { id: string; label: string; hasStems: boolean }
  onClose: () => void
  createWorker?: ViewWorkerFactory
}) {
  const handler: RequestHandler = async (method, body) => {
    if (method === 'core.closeSlot') return onClose(), { ok: true, body: {} }
    if (method === 'core.queueStemSeparation') {
      const asked = stemRequestOf(body)
      if (!asked.ok) return { ok: false, error: { code: 'request.invalid', message: asked.problem } }
      const now = Date.now()
      const job: AsyncJob = { id: randomId(), type: 'stem-separation', status: 'queued', progress: 0, createdAt: now, updatedAt: now, variantId, sourceTrackId: track.id, model: asked.model, splitGuitar: asked.splitGuitar }
      await putAsyncJob(job)
      return { ok: true, body: { jobId: job.id } }
    }
    if (!Object.prototype.hasOwnProperty.call(addon.contributes.methods, method)) return { ok: false, error: { code: 'method.undeclared', message: `The add-on declared no method "${method}"` } }
    return callAddonMethod(addon.id, method, body)
  }
  return (
    <AddonSlot
      key={addon.id}
      slot="song-editor.track-action"
      addon={{ id: addon.id, code: addon.viewScript, permissions: addon.permissions, imageOrigins: addon.imageOrigins }}
      context={{ variantId, trackId: track.id, trackLabel: track.label, hasStems: track.hasStems }}
      language={i18n.language}
      sources={{ jobs: {}, state: {} }}
      onRequest={handler}
      onLeave={onClose}
      {...(createWorker ? { createWorker } : {})}
    />
  )
}
