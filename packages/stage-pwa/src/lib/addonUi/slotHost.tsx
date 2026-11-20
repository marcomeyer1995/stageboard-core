import { useEffect, useRef, useState } from 'react'
import { ADDON_API_VERSION, ADDON_CONTRACT_VERSION, ADDON_PROTOCOL_VERSION, EnvelopeSchema, UI_LIMITS, validateUiTree, type AddonError, type SlotId, type UiNode } from 'shared-types'
import { browserWorker } from '../addonSandbox/sandboxHost'
import type { BindSources } from './bind'
import { UiTree } from './render'

/** A view script's Worker, or a stand-in in tests. Messages are contract envelopes (docs/36 §4). */
export interface ViewWorkerLike {
  postMessage: (message: unknown) => void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate: () => void
}
export type ViewWorkerFactory = (code: string, name: string) => ViewWorkerLike

export type SlotHealth = { status: 'error'; code: string; message: string }
export type RequestHandler = (method: string, body: unknown) => Promise<{ ok: true; body: unknown } | { ok: false; error: AddonError }>

export interface AddonSlotProps {
  slot: SlotId
  /** The add-on that fills the slot: its view script and the origins its images may come from (its `http:` permissions). */
  addon: { id: string; code: string; settings?: Record<string, unknown>; permissions?: string[]; imageOrigins?: string[] }
  /** What the slot hands in (docs/36 §6 slot table). */
  context: Record<string, unknown>
  language: string
  /** Jobs and device state a `{bind}` can read - the app keeps them live. */
  sources: BindSources
  /** Methods the view script calls (answered by the work script on some capable device). Absent: every request is refused. */
  onRequest?: RequestHandler
  onHealth?: (health: SlotHealth) => void
  createWorker?: ViewWorkerFactory
  now?: () => number
}

/**
 * One slot filled by an add-on's view script (docs/36 §2, §6, #964). The script runs in a Worker of its own - it sees neither the page nor the band's
 * data - and answers with UI descriptions. Every description is validated; a bad one is refused with its code and the previous tree stays. The person's
 * taps leave as `ui-action`; values that follow a job or a device are `{bind}`s the app resolves itself, so a progress bar never asks the add-on.
 */
export function AddonSlot({ slot, addon, context, language, sources, onRequest, onHealth, createWorker = browserWorker as unknown as ViewWorkerFactory, now = Date.now }: AddonSlotProps) {
  const [tree, setTree] = useState<UiNode | null>(null)
  const worker = useRef<ViewWorkerLike | null>(null)
  const latest = useRef({ onRequest, onHealth, now, imageOrigins: addon.imageOrigins ?? [], context })
  latest.current = { onRequest, onHealth, now, imageOrigins: addon.imageOrigins ?? [], context }

  useEffect(() => {
    const w = createWorker(addon.code, `addon-view:${addon.id}`)
    worker.current = w
    const sets: number[] = []
    const health = (code: string, message: string) => latest.current.onHealth?.({ status: 'error', code, message })

    w.onmessage = (event) => {
      const parsed = EnvelopeSchema.safeParse(event.data)
      if (!parsed.success) return
      const envelope = parsed.data
      if (envelope.kind === 'ui-set') {
        if (envelope.slot !== slot) return
        const at = latest.current.now()
        while (sets.length > 0 && at - sets[0]! >= 1000) sets.shift()
        if (sets.length >= UI_LIMITS.maxSetsPerSecond) return health('ui.rate', `More than ${UI_LIMITS.maxSetsPerSecond} ui-set per second for ${slot}`)
        sets.push(at)
        const result = validateUiTree(envelope.tree, { imageOrigins: latest.current.imageOrigins })
        if (!result.ok) return health(result.code, `${result.code} at ${result.path || 'the root'}`)
        setTree(result.tree)
      } else if (envelope.kind === 'request') {
        const handler = latest.current.onRequest
        const id = envelope.id
        const answer = handler ? handler(envelope.method, envelope.body) : Promise.resolve({ ok: false as const, error: { code: 'permission.denied', message: 'No requests from this slot' } })
        void answer
          .catch((err: unknown) => ({ ok: false as const, error: { code: 'request.failed', message: err instanceof Error ? err.message : String(err) } }))
          .then((r) => w.postMessage(r.ok ? { kind: 'response', id, ok: true, body: r.body } : { kind: 'response', id, ok: false, error: r.error }))
      }
    }
    w.onerror = (event) => health('addon.crashed', `The add-on's view script failed: ${String((event as { message?: string })?.message ?? event)}`)
    w.postMessage({ type: 'init', apiVersion: ADDON_API_VERSION, protocol: ADDON_PROTOCOL_VERSION, contractVersion: ADDON_CONTRACT_VERSION, settings: addon.settings ?? {}, permissions: addon.permissions ?? [], language })
    w.postMessage({ kind: 'ui-action', slot, action: 'open', value: latest.current.context })
    return () => {
      w.terminate()
      worker.current = null
    }
  }, [addon.id, addon.code, slot]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tree) return null
  return <UiTree tree={tree} sources={sources} onAction={(action, value) => worker.current?.postMessage({ kind: 'ui-action', slot, action, ...(value !== undefined ? { value } : {}) })} />
}
