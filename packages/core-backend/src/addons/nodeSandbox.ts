import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ADDON_API_VERSION,
  ADDON_CONTRACT_VERSION,
  ADDON_PROTOCOL_VERSION,
  EnvelopeSchema,
  fromEnvelope,
  type AddonJob,
  type Envelope,
  type FromAddon,
  type ToAddon,
} from 'shared-types'

/**
 * One add-on in a sandbox of its own on a Node device (#964, docs/32 §6) - the counterpart of the app's Worker sandbox, speaking the same
 * messages (`shared-types/addonProtocol.ts`). **There is no server**: this is simply how a device that has Node runs an add-on's jobs.
 *
 * The add-on is a classic Worker script, started in a child process with Node's permission model: it can read only its own file and the
 * runner, write nothing, start no program and no worker, and gets no environment. It **cannot** be kept off the network - Node 24's
 * permission model has no network switch - so the manifest's `http` permission is a promise the add-on makes, not one this sandbox enforces
 * (docs/32 §7). Programs run only through StageBoard: the add-on asks with `helper-run`, StageBoard checks the name against what the manifest
 * declared and starts it.
 */

const RUNNER = fileURLToPath(new URL('../../scripts/addon_runner.mjs', import.meta.url))

export interface NodeSandboxOptions {
  /** Absolute path of the add-on's JavaScript file (a classic Worker script, no imports). */
  addonFile: string
  name?: string
  settings?: Record<string, unknown>
  permissions?: string[]
  language?: string
  /** Helper programs the manifest declared; a `helper-run` for any other name is refused. */
  helpers?: readonly string[]
  /** Runs a declared helper (the line protocol, docs/32 §8); the platform's own part. `onProgress` gets 0-1. */
  runHelper?: (helper: string, args: string[], onProgress: (fraction: number) => void, files: { name: string; bytes: Uint8Array }[]) => Promise<{ result: unknown; files: { name: string; bytes: Uint8Array }[] }>
  log?: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
}

export type JobOutcome =
  | { ok: true; files: { key: string; bytes: Uint8Array }[]; data?: Record<string, unknown> }
  | { ok: false; message: string; messageCode?: string }

export type CallOutcome = { ok: true; data?: unknown; files: { key: string; bytes: Uint8Array }[] } | { ok: false; message: string; messageCode?: string }

export interface NodeSandbox {
  /** Asks the add-on something that wants an answer now (a clip to speak, a song to look up). */
  call(method: string, args: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<CallOutcome>
  /**
   * Sends one contract `request` and resolves with the add-on's response envelope (docs/36 §4) - what a protocol 3 script speaks directly. An add-on
   * that does not answer within `timeoutMs` is stopped, like a `call`, and the answer is a response with `{code: 'timeout'}`.
   */
  request(method: string, body: unknown, options?: { timeoutMs?: number }): Promise<Envelope>
  /** Runs a job; the add-on reports progress and ends with `job-result`. A job without an end by `timeoutMs` kills the add-on. */
  runJob(job: AddonJob, options?: { onProgress?: (fraction: number) => void; timeoutMs?: number }): Promise<JobOutcome>
  /** Whether the add-on's process is still alive. */
  alive(): boolean
  /** The add-on's last health message. */
  health(): { status: 'online' | 'offline' | 'error'; message?: string }
  stop(): void
}

/** Starts the add-on and waits until it says it is online (or failed to start). */
export async function startNodeSandbox(options: NodeSandboxOptions): Promise<NodeSandbox> {
  const log = options.log
  const child: ChildProcess = fork(RUNNER, [options.addonFile, ...((options.permissions ?? []).some((p) => p === 'http' || p.startsWith('http:')) ? ['--http'] : [])], {
    // The permission model: only these two files readable; nothing else, nothing writable, no child process, no worker.
    execArgv: ['--permission', `--allow-fs-read=${RUNNER}`, `--allow-fs-read=${options.addonFile}`],
    // `fetch` is handed to the add-on only if it declared the `http` permission (docs/32 §7). Node's permission model cannot cut the network, so this
    // is the only place the add-on's reach is limited: a hostile add-on that escapes the vm context can still open a connection.
    // Not StageBoard's environment: no database login, no keys, no paths.
    env: {},
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-1500)
  })
  let health: { status: 'online' | 'offline' | 'error'; message?: string } = { status: 'offline' }
  let exited = false
  const jobs = new Map<number, { onProgress?: (f: number) => void; finish: (o: JobOutcome) => void }>()
  const calls = new Map<number, (o: CallOutcome) => void>()
  /** Contract `request`s waiting for their `response` (docs/36 §4). A response is answered exactly once, by id. */
  const requests = new Map<number, (envelope: Envelope) => void>()
  let nextId = 1
  let nextRequest = 1
  const send = (message: ToAddon | Envelope) => {
    if (!exited && child.connected) child.send(message)
  }

  const failAll = (message: string, code = 'addon.stopped') => {
    for (const job of jobs.values()) job.finish({ ok: false, message })
    jobs.clear()
    for (const finish of calls.values()) finish({ ok: false, message })
    calls.clear()
    // A request that will not be answered still has a shape: a failed response, so the caller reads it like any other error.
    for (const [id, finish] of requests) finish({ kind: 'response', id, ok: false, error: { code, message } })
    requests.clear()
  }
  child.on('exit', (code, signal) => {
    exited = true
    health = { status: health.status === 'error' ? 'error' : 'offline', ...(health.message ? { message: health.message } : {}) }
    failAll(`The add-on stopped${signal ? ` (${signal})` : code ? ` (code ${code})` : ''}${stderrTail ? `: ${stderrTail.trim().split('\n').slice(-2).join(' ')}` : ''}`)
  })

  /**
   * An incoming envelope, validated at the boundary (docs/36 §4). `null` means "not an envelope" (a protocol 2 message); `'invalid'` means it claims to
   * be one and is not - it is dropped, never guessed at. Messages without a `kind` stay protocol 2 and are unchanged.
   */
  const readEnvelope = (raw: unknown): Envelope | 'invalid' | null => {
    if (typeof raw !== 'object' || raw === null || !('kind' in raw)) return null
    const parsed = EnvelopeSchema.safeParse(raw)
    if (parsed.success) return parsed.data as Envelope
    log?.error(`add-on ${options.name ?? ''}: a message does not match the contract`, { issues: parsed.error.issues })
    return 'invalid'
  }

  const ready = new Promise<void>((resolve) => {
    child.on('message', (raw) => {
      // The runner carries both protocols untouched (scripts/addon_runner.mjs): a message with a `kind` is an envelope, anything else is protocol 2.
      const envelope = readEnvelope(raw)
      if (envelope === 'invalid') return
      if (envelope && envelope.kind === 'response') {
        const finish = requests.get(envelope.id)
        if (!finish) return
        requests.delete(envelope.id)
        finish(envelope)
        return
      }
      const asV2 = envelope ? fromEnvelope(envelope) : (raw as FromAddon)
      if (!asV2) return
      const message = asV2
      switch (message.type) {
        case 'health':
          health = { status: message.status, ...(message.message ? { message: message.message } : {}) }
          // Online is ready. An error at start is followed by the process ending - ready then waits for that (below), so `alive()` is true only
          // for an add-on that really runs. An error while handling a job (the add-on threw) fails the jobs waiting for an answer at once.
          if (message.status === 'online') resolve()
          if (message.status === 'error') failAll(message.message ?? 'The add-on failed')
          break
        case 'log':
          log?.info(`add-on ${options.name ?? ''}: ${message.line}`)
          break
        case 'job-progress':
          jobs.get(message.id)?.onProgress?.(Math.min(1, Math.max(0, message.fraction)))
          break
        case 'job-result': {
          const job = jobs.get(message.id)
          if (!job) break
          jobs.delete(message.id)
          job.finish(message.ok ? { ok: true, files: message.files, ...(message.data ? { data: message.data } : {}) } : { ok: false, message: message.message, ...(message.messageCode ? { messageCode: message.messageCode } : {}) })
          break
        }
        case 'call-result': {
          const finish = calls.get(message.id)
          if (!finish) break
          calls.delete(message.id)
          finish(message.ok ? { ok: true, ...(message.data !== undefined ? { data: message.data } : {}), files: message.files ?? [] } : { ok: false, message: message.message, ...(message.messageCode ? { messageCode: message.messageCode } : {}) })
          break
        }
        case 'helper-run': {
          // A protocol 3 script asked in an envelope, so it is answered in one; a protocol 2 script gets the message it knows.
          const reply = (result: unknown, files: { name: string; bytes: Uint8Array }[], error?: string) =>
            envelope
              ? send(
                  error !== undefined
                    ? { kind: 'response', id: message.id, ok: false, error: { code: 'helper.error', message: error, params: { request: message.request } } }
                    : { kind: 'response', id: message.id, ok: true, body: { request: message.request, result, files } },
                )
              : send({ type: 'helper-result', id: message.id, request: message.request, result, files, ...(error ? { error } : {}) })
          if (!(options.helpers ?? []).includes(message.helper)) return reply(null, [], `The add-on did not declare the helper "${message.helper}"`)
          if (!options.runHelper) return reply(null, [], `This device has no helper "${message.helper}"`)
          options.runHelper(message.helper, message.args, (fraction) => jobs.get(message.id)?.onProgress?.(fraction), message.files ?? []).then(
            (done) => reply(done.result, done.files),
            (err) => reply(null, [], err instanceof Error ? err.message : String(err)),
          )
          break
        }
        default:
          break // `result`/`midi-out` belong to a device add-on's events, not to jobs
      }
    })
    child.on('exit', () => resolve())
  })

  // `protocol` stays 2 for every existing script; `contractVersion` is how a new script knows it may speak the envelope (docs/36 §9).
  send({ type: 'init', apiVersion: ADDON_API_VERSION, protocol: ADDON_PROTOCOL_VERSION, contractVersion: ADDON_CONTRACT_VERSION, settings: options.settings ?? {}, permissions: options.permissions ?? [], language: options.language ?? 'en' })
  await ready

  return {
    alive: () => !exited,
    health: () => health,
    stop() {
      send({ type: 'shutdown' })
      setTimeout(() => child.kill('SIGKILL'), 500).unref()
    },
    call(method, args, callOptions = {}) {
      if (exited) return Promise.resolve({ ok: false, message: 'The add-on is not running' })
      return new Promise<CallOutcome>((resolve) => {
        const id = nextId++
        const timer = setTimeout(() => {
          calls.delete(id)
          child.kill('SIGKILL')
          resolve({ ok: false, message: `The add-on did not answer within ${Math.round((callOptions.timeoutMs ?? 30_000) / 1000)} s and was stopped` })
        }, callOptions.timeoutMs ?? 30_000)
        calls.set(id, (outcome) => (clearTimeout(timer), resolve(outcome)))
        send({ type: 'call', id, method, args })
      })
    },
    request(method, body, requestOptions = {}) {
      const id = nextId++
      if (exited) return Promise.resolve({ kind: 'response', id, ok: false, error: { code: 'addon.stopped', message: 'The add-on is not running' } })
      return new Promise<Envelope>((resolve) => {
        const timeoutMs = requestOptions.timeoutMs ?? 30_000
        const timer = setTimeout(() => {
          // Same rule as a call: an add-on that does not answer cannot be trusted further (docs/36, Review Focus).
          requests.delete(id)
          child.kill('SIGKILL')
          resolve({
            kind: 'response',
            id,
            ok: false,
            error: { code: 'timeout', message: `The add-on did not answer within ${Math.round(timeoutMs / 1000)} s and was stopped`, params: { method, timeoutMs } },
          })
        }, timeoutMs)
        requests.set(id, (envelope) => (clearTimeout(timer), resolve(envelope)))
        send({ kind: 'request', id, method, body })
      })
    },
    runJob(job, jobOptions = {}) {
      if (exited) return Promise.resolve({ ok: false, message: 'The add-on is not running' })
      return new Promise<JobOutcome>((resolve) => {
        const id = nextId++
        void nextRequest
        const timer = setTimeout(() => {
          jobs.delete(id)
          child.kill('SIGKILL')
          resolve({ ok: false, message: `The add-on did not finish within ${Math.round((jobOptions.timeoutMs ?? 0) / 1000)} s and was stopped` })
        }, jobOptions.timeoutMs ?? 10 * 60_000)
        jobs.set(id, { ...(jobOptions.onProgress ? { onProgress: jobOptions.onProgress } : {}), finish: (outcome) => (clearTimeout(timer), resolve(outcome)) })
        send({ type: 'job', id, job })
      })
    },
  }
}
