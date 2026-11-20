import { useMemo, useState } from 'react'
import type { AsyncJob, SlotId } from 'shared-types'
import { callAddonMethod } from '../lib/addonMethodClient'
import { addonsForSlot, type BuiltinAddon } from '../lib/addonUi/builtinAddons'
import { AddonSlot, type RequestHandler, type ViewWorkerFactory } from '../lib/addonUi/slotHost'
import { putAsyncJob } from '../lib/asyncJobsDb'
import { randomId } from '../lib/id'
import i18n from '../i18n'
import { useAsyncJobsStore } from '../store/useAsyncJobsStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { Button } from './ui'

const SLOT: SlotId = 'song-editor.track-source'

/**
 * The places the song editor offers to get a track from an add-on (docs/36 §6 slot `song-editor.track-source`, #964). Each installed add-on that
 * declared the slot gets one entry; opening it shows the add-on's own dialog, drawn from its description. The editor knows nothing of what the
 * add-on does: it answers the add-on's requests (a method goes to a host that can run it; `core.queueAudioImport` queues the generic job that turns
 * the audio it fetches into a track of this song) and draws the job's progress from the job document.
 */
export function TrackSourceSlots({ variantId, query, createWorker }: { variantId: string; query: string; createWorker?: ViewWorkerFactory }) {
  const installed = usePluginsStore((s) => s.installed)
  const entries = useMemo(() => addonsForSlot(SLOT, installed.filter((p) => p.enabled).map((p) => p.id)), [installed])
  const [open, setOpen] = useState<{ addon: BuiltinAddon } | null>(null)
  const jobs = useAsyncJobsStore((s) => s.jobs)
  const sources = useMemo(() => ({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j as unknown as Record<string, unknown>])), state: {} }), [jobs])
  if (entries.length === 0) return null

  /** What the add-on's view script may ask of the app: its own methods, and the two things only the app can do. */
  const handler = (addon: BuiltinAddon): RequestHandler => async (method, body) => {
    if (method === 'core.closeSlot') return setOpen(null), { ok: true, body: {} }
    if (method === 'core.queueAudioImport') {
      const { label, args } = body as { label?: string; args?: Record<string, unknown> }
      const method = Object.keys(addon.contributes.methods).includes('fetchAudio') ? 'fetchAudio' : null
      if (!method || typeof label !== 'string' || typeof args !== 'object' || args === null) return { ok: false, error: { code: 'request.invalid', message: 'core.queueAudioImport needs {label, args}' } }
      const now = Date.now()
      const jobId = randomId()
      const job: AsyncJob = { id: jobId, type: 'audio-import', status: 'queued', progress: 0, createdAt: now, updatedAt: now, variantId, addonId: addon.id, method, args, label: label.trim() || addon.name }
      await putAsyncJob(job)
      return { ok: true, body: { jobId } }
    }
    // Only methods the add-on declared leave the app; the host checks the same list again.
    if (!Object.prototype.hasOwnProperty.call(addon.contributes.methods, method)) return { ok: false, error: { code: 'method.undeclared', message: `The add-on declared no method "${method}".` } }
    return callAddonMethod(addon.id, method, body)
  }

  return (
    <>
      {entries.map(({ addon, entry }) => (
        <Button key={`${addon.id}:${entry.id}`} variant="secondary" onClick={() => setOpen({ addon })}>
          {entry.title}
        </Button>
      ))}
      {open && (
        <AddonSlot
          key={open.addon.id}
          slot={SLOT}
          addon={{ id: open.addon.id, code: open.addon.viewScript, permissions: open.addon.permissions, imageOrigins: open.addon.imageOrigins }}
          context={{ variantId, query }}
          language={i18n.language}
          sources={sources}
          onRequest={handler(open.addon)}
          {...(createWorker ? { createWorker } : {})}
        />
      )}
    </>
  )
}
