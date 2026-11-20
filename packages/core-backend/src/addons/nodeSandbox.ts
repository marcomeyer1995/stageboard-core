import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ADDON_API_VERSION, ADDON_CONTRACT_VERSION, ADDON_PROTOCOL_VERSION, EnvelopeSchema, type Envelope } from 'shared-types'
import type { Capabilities } from './capabilities.js'

/**
 * One add-on's work script in a sandbox of its own on a Node device (docs/36 §2, #964) - the counterpart of the app's Worker host, speaking the same
 * messages (the contract's envelope, `shared-types/addonContract.ts`). **There is no server**: this is simply how a device that has Node runs an
 * add-on's methods.
 *
 * The script is a classic script, started in a child process with Node's permission model: it can read only its own file and the runner, write
 * nothing, start no program and no worker, and gets no environment. It is handed no `fetch` either: everything it wants from the world it **asks**
 * (`capability.*` requests, answered by `capabilities.ts` against the permissions the band confirmed). Node 24's permission model cannot cut the
 * network, so a hostile script that escapes the `vm` context could still open a socket - until Node has `--allow-net` (docs/36 §5).
 */

const RUNNER = fileURLToPath(new URL('../../scripts/addon_runner.mjs', import.meta.url))

export interface NodeSandboxOptions {
  /** Absolute path of the add-on's work script (a classic script, no imports). */
  addonFile: string
  name?: string
  settings?: Record<string, unknown>
  permissions?: readonly string[]
  language?: string
  /** What the script may ask the world for through `capability.*` requests (capabilities.ts); absent: every capability request is refused. */
  capabilities?: Capabilities
  log?: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
}

export interface NodeSandbox {
  /**
   * Sends one contract `request` and resolves with the add-on's response envelope (docs/36 §4). An add-on that does not answer within `timeoutMs`
   * is stopped - it cannot be trusted further - and the answer is a response with `{code: 'timeout'}`. `onProgress` gets what a helper reports for
   * the request.
   */
  request(method: string, body: unknown, options?: { timeoutMs?: number; onProgress?: (fraction: number) => void }): Promise<Envelope>
  /** Whether the add-on's process is still alive. */
  alive(): boolean
  /** The add-on's last health message. */
  health(): { status: 'online' | 'offline' | 'error'; message?: string }
  stop(): void
}

type Health = { status: 'online' | 'offline' | 'error'; message?: string }

/** Starts the add-on and waits until it says it is online (or failed to start). */
export async function startNodeSandbox(options: NodeSandboxOptions): Promise<NodeSandbox> {
  const log = options.log
  const child: ChildProcess = fork(RUNNER, [options.addonFile], {
    // The permission model: only these two files readable; nothing else, nothing writable, no child process, no worker.
    execArgv: ['--permission', `--allow-fs-read=${RUNNER}`, `--allow-fs-read=${options.addonFile}`],
    // Not StageBoard's environment: no database login, no keys, no paths.
    env: {},
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1500)
  })
  let health: Health = { status: 'offline' }
  let exited = false
  /** Requests waiting for their `response`; each is answered exactly once, by id. */
  const requests = new Map<number, (envelope: Envelope) => void>()
  /** Progress callbacks of the requests we sent: a helper's progress reaches the request the add-on says it serves (`forRequest`). */
  const requestProgress = new Map<number, (fraction: number) => void>()
  let nextId = 1
  const send = (message: unknown) => {
    if (!exited && child.connected) child.send(message as never)
  }

  const failAll = (message: string, code = 'addon.stopped') => {
    // A request that will not be answered still has a shape: a failed response, so the caller reads it like any other error.
    for (const [id, finish] of requests) finish({ kind: 'response', id, ok: false, error: { code, message } })
    requests.clear()
  }
  child.on('exit', (code, signal) => {
    exited = true
    health = { status: health.status === 'error' ? 'error' : 'offline', ...(health.message ? { message: health.message } : {}) }
    failAll(`The add-on stopped${signal ? ` (${signal})` : code ? ` (code ${code})` : ''}${stderrTail ? `: ${stderrTail.trim().split('\n').slice(-2).join(' ')}` : ''}`)
  })

  const ready = new Promise<void>((resolve) => {
    child.on('message', (raw) => {
      // Everything crossing the boundary is an envelope, validated here; a message that claims to be one and is not is dropped, never guessed at.
      const parsed = EnvelopeSchema.safeParse(raw)
      if (!parsed.success) {
        log?.error(`add-on ${options.name ?? ''}: a message does not match the contract`, { issues: parsed.error.issues })
        return
      }
      const envelope = parsed.data as Envelope
      switch (envelope.kind) {
        case 'notify': {
          const body = (envelope.body ?? {}) as { status?: Health['status']; message?: string; line?: string }
          if (envelope.topic === 'log') log?.info(`add-on ${options.name ?? ''}: ${String(body.line ?? '')}`)
          if (envelope.topic === 'health' && body.status) {
            health = { status: body.status, ...(body.message ? { message: body.message } : {}) }
            // Online is ready. An error at start is followed by the process ending - ready then waits for that (below), so `alive()` is true only
            // for an add-on that really runs. An error while handling a request (the add-on threw) fails what waits for an answer at once.
            if (body.status === 'online') resolve()
            if (body.status === 'error') failAll(body.message ?? 'The add-on failed')
          }
          break
        }
        case 'response': {
          const finish = requests.get(envelope.id)
          if (!finish) break
          requests.delete(envelope.id)
          finish(envelope)
          break
        }
        case 'request': {
          if (!envelope.method.startsWith('capability.')) break // an add-on asks the world only through capabilities
          const id = envelope.id
          const hooks = { onProgress: (request: number, fraction: number) => requestProgress.get(request)?.(Math.min(1, Math.max(0, fraction))) }
          const answer = options.capabilities ? options.capabilities(envelope.method, envelope.body, hooks) : Promise.resolve({ ok: false as const, error: { code: 'permission.denied', message: 'This device gives no capabilities to add-ons' } })
          void answer.then((result) => send(result.ok ? { kind: 'response', id, ok: true, body: result.body } : { kind: 'response', id, ok: false, error: result.error }))
          break
        }
        default:
          break
      }
    })
    child.on('exit', () => resolve())
  })

  // `protocol` stays the version of the add-on API; `contractVersion` is how a script knows it speaks the envelope (docs/36 §9).
  send({ type: 'init', apiVersion: ADDON_API_VERSION, protocol: ADDON_PROTOCOL_VERSION, contractVersion: ADDON_CONTRACT_VERSION, settings: options.settings ?? {}, permissions: [...(options.permissions ?? [])], language: options.language ?? 'en' })
  await ready

  return {
    alive: () => !exited,
    health: () => health,
    stop() {
      send({ type: 'shutdown' })
      setTimeout(() => child.kill('SIGKILL'), 500).unref()
    },
    request(method, body, requestOptions = {}) {
      const id = nextId++
      if (exited) return Promise.resolve({ kind: 'response', id, ok: false, error: { code: 'addon.stopped', message: 'The add-on is not running' } })
      return new Promise<Envelope>((resolve) => {
        const timeoutMs = requestOptions.timeoutMs ?? 30_000
        const timer = setTimeout(() => {
          // An add-on that does not answer cannot be trusted further (docs/36, Review Focus).
          requests.delete(id)
          requestProgress.delete(id)
          child.kill('SIGKILL')
          resolve({ kind: 'response', id, ok: false, error: { code: 'timeout', message: `The add-on did not answer within ${Math.round(timeoutMs / 1000)} s and was stopped`, params: { method, timeoutMs } } })
        }, timeoutMs)
        if (requestOptions.onProgress) requestProgress.set(id, requestOptions.onProgress)
        requests.set(id, (envelope) => (clearTimeout(timer), requestProgress.delete(id), resolve(envelope)))
        send({ kind: 'request', id, method, body })
      })
    },
  }
}
