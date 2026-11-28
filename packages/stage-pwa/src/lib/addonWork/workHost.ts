import { ADDON_API_VERSION, ADDON_CONTRACT_VERSION, ADDON_PROTOCOL_VERSION, EnvelopeSchema, type Envelope } from 'shared-types'
import { browserWorker } from '../addonSandbox/sandboxHost'
import type { AppHelper } from './appHelpers'

/** A work script's Worker, or a stand-in in tests. Messages are contract envelopes (docs/36 §4). */
export interface WorkWorkerLike {
  postMessage: (message: unknown) => void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate: () => void
}
export type WorkWorkerFactory = (code: string, name: string) => WorkWorkerLike

export interface WorkHostOptions {
  /** The work script's source (docs/36 §2): a classic script, no imports. */
  code: string
  name: string
  /** What the band confirmed for this add-on (`helper:<id>`, `http:<origin>`, ...). */
  permissions: readonly string[]
  language: string
  /** The helpers this device has (appHelpers.ts), by the name the add-on asks for. */
  helpers: Readonly<Record<string, AppHelper>>
  createWorker?: WorkWorkerFactory
}

/**
 * The MIDI device one request is for (docs/36 §5, #964): StageBoard found its port, the add-on only sends bytes to it. The app's form of the grant a
 * Node host gives (`midi-out:<port>`): what the add-on may send to while it serves THAT request, and nothing else.
 */
export interface WorkMidi {
  send(bytes: number[]): void
  sendAndWait(bytes: number[], prefix: number[], timeoutMs: number): Promise<Uint8Array | null>
}

export interface WorkHost {
  /** One contract `request`; resolves with the response envelope - the add-on's, or a failed one (`timeout`, `addon.crashed`) the caller reads like any other. */
  request(method: string, body: unknown, options?: { timeoutMs?: number; onProgress?: (fraction: number) => void; midi?: WorkMidi }): Promise<Envelope>
  stop(): void
}

type Pending = { finish: (e: Envelope) => void; onProgress?: (fraction: number) => void; midi?: WorkMidi }

const isMidiBytes = (value: unknown, min: number, max: number): value is number[] =>
  Array.isArray(value) && value.length >= min && value.length <= max && value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)

/**
 * Runs an add-on's work script in a Worker of this device (docs/36 §2, #964): the same script, the same messages as on a laptop, with the device's
 * own helpers behind `capability.helper`. The script holds no network, no file and no program - it asks, and this checks the permission and answers.
 * `helper` and `midi-out` are mediated (`midi-out` only to the device of the request the add-on serves); `http` and `udp` are answered
 * `capability.unavailable` (the page could perform them, the checks are not built).
 * The Worker is started when first asked and again after it was stopped for not answering.
 */
export function startWorkHost(options: WorkHostOptions): WorkHost {
  const factory = options.createWorker ?? (browserWorker as unknown as WorkWorkerFactory)
  let worker: WorkWorkerLike | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()
  const mayMidiOut = options.permissions.some((p) => p.startsWith('midi-out:'))
  const helperHelpers = new Set(options.permissions.filter((p) => p.startsWith('helper:')).map((p) => p.slice('helper:'.length)))

  const failAll = (code: string, message: string) => {
    for (const [id, p] of pending) p.finish({ kind: 'response', id, ok: false, error: { code, message } })
    pending.clear()
  }

  const answerCapability = async (w: WorkWorkerLike, id: number, method: string, body: unknown): Promise<void> => {
    const reply = (envelope: Envelope) => w.postMessage(envelope)
    const reply_ = (out: unknown) => reply({ kind: 'response', id, ok: true, body: out })
    const refuse = (code: string, message: string, params?: Record<string, string | number>) => reply({ kind: 'response', id, ok: false, error: { code, message, ...(params ? { params } : {}) } })
    if (method === 'capability.midi-out') {
      const asked = body as { bytes?: unknown; expectReply?: { prefix?: unknown; timeoutMs?: unknown }; forRequest?: unknown }
      const midi = typeof asked.forRequest === 'number' ? pending.get(asked.forRequest)?.midi : undefined
      if (!mayMidiOut || !midi) return refuse('permission.denied', 'The add-on has no permission for midi-out without a device', { capability: 'midi-out' })
      if (!isMidiBytes(asked.bytes, 1, 65536)) return refuse('capability.invalid', 'capability.midi-out needs {bytes (0-255)}')
      const reply = asked.expectReply
      if (!reply) {
        midi.send(asked.bytes)
        return reply_({ sent: true })
      }
      const timeoutMs = Number(reply.timeoutMs)
      if (!isMidiBytes(reply.prefix, 0, 16) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return refuse('capability.invalid', 'expectReply needs {prefix, timeoutMs <= 5000}')
      const answer = await midi.sendAndWait(asked.bytes, reply.prefix, timeoutMs)
      return reply_({ sent: true, reply: answer ? Array.from(answer) : null })
    }
    if (method !== 'capability.helper') return refuse('capability.unavailable', `${method} is not available in the app yet`)
    const asked = body as { helper?: unknown; args?: unknown; files?: unknown; forRequest?: unknown }
    const name = typeof asked.helper === 'string' ? asked.helper : ''
    if (!helperHelpers.has(name)) return refuse('permission.denied', `The add-on has no permission for helper ${name}`, { capability: 'helper', origin: name })
    const run = Object.prototype.hasOwnProperty.call(options.helpers, name) ? options.helpers[name] : undefined
    if (!run) return refuse('helper.missing', `This device has no helper "${name}"`, { helper: name })
    const forRequest = typeof asked.forRequest === 'number' ? asked.forRequest : undefined
    try {
      const out = await run(
        Array.isArray(asked.args) ? asked.args.map(String) : [],
        (fraction) => (forRequest !== undefined ? pending.get(forRequest)?.onProgress?.(Math.min(1, Math.max(0, fraction))) : undefined),
        Array.isArray(asked.files) ? (asked.files as { name: string; bytes: Uint8Array }[]) : [],
      )
      reply({ kind: 'response', id, ok: true, body: out })
    } catch (err) {
      refuse('helper.error', err instanceof Error ? err.message : String(err))
    }
  }

  const ensure = (): WorkWorkerLike => {
    if (worker) return worker
    const w = factory(options.code, `addon-work:${options.name}`)
    worker = w
    w.onmessage = (event) => {
      const parsed = EnvelopeSchema.safeParse(event.data)
      if (!parsed.success) return
      const envelope = parsed.data
      if (envelope.kind === 'response') {
        const p = pending.get(envelope.id)
        if (!p) return
        pending.delete(envelope.id)
        p.finish(envelope)
      } else if (envelope.kind === 'request' && envelope.method.startsWith('capability.')) {
        void answerCapability(w, envelope.id, envelope.method, envelope.body)
      }
    }
    w.onerror = (event) => {
      failAll('addon.crashed', `The add-on's work script failed: ${String((event as { message?: string })?.message ?? event)}`)
      w.terminate()
      if (worker === w) worker = null
    }
    w.postMessage({ type: 'init', apiVersion: ADDON_API_VERSION, protocol: ADDON_PROTOCOL_VERSION, contractVersion: ADDON_CONTRACT_VERSION, settings: {}, permissions: [...options.permissions], language: options.language })
    return w
  }

  return {
    request(method, body, requestOptions = {}) {
      const id = nextId++
      const w = ensure()
      return new Promise<Envelope>((resolve) => {
        const timeoutMs = requestOptions.timeoutMs ?? 30_000
        const timer = setTimeout(() => {
          // An add-on that does not answer cannot be trusted further: its Worker ends, the next request starts a fresh one.
          pending.delete(id)
          w.terminate()
          if (worker === w) worker = null
          resolve({ kind: 'response', id, ok: false, error: { code: 'timeout', message: `The add-on did not answer within ${Math.round(timeoutMs / 1000)} s and was stopped`, params: { method, timeoutMs } } })
        }, timeoutMs)
        pending.set(id, { finish: (e) => (clearTimeout(timer), resolve(e)), ...(requestOptions.onProgress ? { onProgress: requestOptions.onProgress } : {}), ...(requestOptions.midi ? { midi: requestOptions.midi } : {}) })
        w.postMessage({ kind: 'request', id, method, body })
      })
    },
    stop() {
      failAll('addon.stopped', 'The add-on was stopped')
      worker?.terminate()
      worker = null
    },
  }
}
