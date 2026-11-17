import { ADDON_API_VERSION, type PluginInstallation, type ShowControlResult } from 'shared-types'
import { ADDON_PROTOCOL_VERSION, type AddonEventContext, type AddonWorkerLike, type FromAddon } from './protocol'

/** What an event may do on this device - the port is chosen by StageBoard, never by the add-on. */
export interface SandboxIO {
  context: AddonEventContext
  send: (bytes: number[]) => void
  sendAndWait: (bytes: number[], prefix: number[], timeoutMs: number) => Promise<Uint8Array | null>
}

/** An event without an answer after this long fails - an add-on stuck in a loop can't hold a cue. */
export const ADDON_EVENT_TIMEOUT_MS = 5_000

/** Whether the installation may send MIDI at all (docs/32 §7: `midi-out:<port>`). */
export function mayMidiOut(installation: Pick<PluginInstallation, 'permissions'>): boolean {
  return (installation.permissions ?? []).some((p) => p.startsWith('midi-out:'))
}

export type WorkerFactory = (code: string, name: string) => AddonWorkerLike

/** A real Worker from the add-on's code - a classic worker script, no imports. */
export const browserWorker: WorkerFactory = (code, name) => {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const worker = new Worker(url, { name })
  URL.revokeObjectURL(url)
  return worker as unknown as AddonWorkerLike
}

/**
 * One add-on in its own Worker (docs/32 §4, #757). Events go in as messages, MIDI comes out as
 * messages; StageBoard sends it to the port it chose for the event, and only with the permission.
 */
export class AddonSandbox {
  private readonly worker: AddonWorkerLike
  private nextId = 1
  private readonly pending = new Map<number, { io: SandboxIO; resolve: (result: ShowControlResult) => void; timer: ReturnType<typeof setTimeout> }>()
  readonly log: string[] = []

  constructor(
    private readonly installation: Pick<PluginInstallation, 'id' | 'permissions' | 'settings'>,
    code: string,
    language: string,
    factory: WorkerFactory = browserWorker,
  ) {
    this.worker = factory(code, `addon:${installation.id}`)
    this.worker.onmessage = (event) => void this.receive(event.data)
    this.worker.onerror = (event) => this.failAll(`Add-on ${installation.id}: ${String((event as { message?: string })?.message ?? event)}`)
    this.worker.postMessage({
      type: 'init',
      apiVersion: ADDON_API_VERSION,
      protocol: ADDON_PROTOCOL_VERSION,
      settings: installation.settings ?? {},
      permissions: installation.permissions ?? [],
      language,
    })
  }

  run(event: { type: string; payload?: Record<string, unknown> }, io: SandboxIO): Promise<ShowControlResult> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ status: 'error', message: `Add-on ${this.installation.id}: keine Antwort` })
      }, ADDON_EVENT_TIMEOUT_MS)
      this.pending.set(id, { io, resolve, timer })
      this.worker.postMessage({ type: 'event', id, event: { type: event.type, ...(event.payload ? { payload: event.payload } : {}) }, context: io.context })
    })
  }

  private async receive(message: FromAddon): Promise<void> {
    switch (message.type) {
      case 'result': {
        const entry = this.pending.get(message.id)
        if (!entry) return
        clearTimeout(entry.timer)
        this.pending.delete(message.id)
        entry.resolve(message.result)
        return
      }
      case 'midi-out': {
        const entry = this.pending.get(message.id)
        if (!entry) return
        if (!mayMidiOut(this.installation) || !Array.isArray(message.bytes) || message.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
          this.log.push(`refused midi-out from ${this.installation.id}`)
          return
        }
        if (message.expectReply && message.request !== undefined) {
          const reply = await entry.io.sendAndWait(message.bytes, message.expectReply.prefix, Math.min(message.expectReply.timeoutMs, ADDON_EVENT_TIMEOUT_MS))
          this.worker.postMessage({ type: 'midi-reply', id: message.id, request: message.request, data: reply ? Array.from(reply) : null })
        } else {
          entry.io.send(message.bytes)
        }
        return
      }
      case 'log':
        this.log.push(String(message.line).slice(0, 500))
        if (this.log.length > 200) this.log.shift()
        return
      case 'health':
        return
    }
  }

  private failAll(message: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve({ status: 'error', message })
      this.pending.delete(id)
    }
  }

  stop(): void {
    this.worker.postMessage({ type: 'shutdown' })
    this.worker.terminate()
    this.failAll(`Add-on ${this.installation.id} beendet`)
  }
}
