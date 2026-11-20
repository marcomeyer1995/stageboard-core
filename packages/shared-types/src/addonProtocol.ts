import type { Envelope } from './addonContract.js'
import type { ShowControlResult } from './plugin.js'

/**
 * The messages between StageBoard and a sandboxed JS add-on (docs/32 §4, #757; moved here and extended with jobs and helpers in #964). The add-on
 * runs in a sandbox of its own and sees neither the band's data nor its logins nor the page: only these messages. **There is no server** - the same
 * add-on, the same messages, whatever device runs it: in a Worker of the app on a tablet, in a Node process started with the permission model on a
 * laptop. StageBoard decides which device and port an event is for and does what the add-on asks for - only with the permission for it (docs/32 §7).
 */

export const ADDON_PROTOCOL_VERSION = 2

/** What an add-on gets with each event - this device's settings for the device it drives. */
export interface AddonEventContext {
  /** MIDI channel 1-16 set up for the device (DeviceTransportConfig). */
  midiChannel: number
}

/** A background job as an add-on sees it: what to do, and nothing of the band beyond what the job needs. */
export interface AddonJob {
  /** The job's id in the band's job queue (`async-jobs:<id>`). */
  id: string
  /** The kind of job the add-on declared it works on (`youtube-extract`, `stem-separation`, ...). */
  type: string
  /** What the job asks for, as the job document carries it (a URL, a source track id, a model). */
  input: Record<string, unknown>
}

export type ToAddon =
  | { type: 'init'; apiVersion: number; protocol: number; contractVersion?: number; settings: Record<string, unknown>; permissions: string[]; language: string }
  | { type: 'event'; id: number; event: { type: string; payload?: Record<string, unknown> }; context: AddonEventContext }
  /** The answer to a `midi-out` with `expectReply`: the first matching message, or null after the timeout. */
  | { type: 'midi-reply'; id: number; request: number; data: number[] | null }
  /** A background job for this add-on (#964). The answer is `job-result`; `job-progress` any number of times before it. */
  | { type: 'job'; id: number; job: AddonJob }
  /** A request that wants an answer now (#964): a clip to speak, a song to look up. The answer is `call-result`. */
  | { type: 'call'; id: number; method: string; args: Record<string, unknown> }
  /** The answer to a `helper-run` (#964): the helper's last `RESULT` line as JSON, the files it left, or an error. */
  | { type: 'helper-result'; id: number; request: number; result: unknown; files: { name: string; bytes: Uint8Array }[]; error?: string }
  | { type: 'shutdown' }

export type FromAddon =
  | { type: 'result'; id: number; result: ShowControlResult }
  /** Bytes for the device of event `id`. With `expectReply` StageBoard listens for a reply starting
   * with `prefix` *before* sending (a reply can be faster than attaching a listener afterwards -
   * found with the real MG-30, 2026-09-08) and answers with `midi-reply`. */
  | { type: 'midi-out'; id: number; bytes: number[]; request?: number; expectReply?: { prefix: number[]; timeoutMs: number } }
  /** Progress of job `id`, 0-1 (#964). */
  | { type: 'job-progress'; id: number; fraction: number }
  /** The end of job `id` (#964): what it made - tracks as files the add-on hands over - or why it failed. */
  | { type: 'job-result'; id: number; ok: true; files: { key: string; bytes: Uint8Array }[]; data?: Record<string, unknown> }
  | { type: 'job-result'; id: number; ok: false; message: string; messageCode?: string }
  /** The answer to a `call` (#964): data and files, or why it failed (with the message code a device translates). */
  | { type: 'call-result'; id: number; ok: true; data?: unknown; files?: { key: string; bytes: Uint8Array }[] }
  | { type: 'call-result'; id: number; ok: false; message: string; messageCode?: string }
  /**
   * Run one of the helper programs this add-on declared (`helpers` in its manifest, docs/32 §8) with these arguments (#964). StageBoard - not the
   * add-on - starts it, only if the add-on has the permission and the device has the helper; the add-on itself can never start a program.
   * `files` are what the helper is to read (the audio to separate): StageBoard puts them in the helper's own work folder, the add-on never sees a path.
   * The helper speaks the line protocol (`PROGRESS`, `RESULT`); its progress comes back as `job-progress` of job `id`, its end as `helper-result`.
   */
  | { type: 'helper-run'; id: number; request: number; helper: string; args: string[]; files?: { name: string; bytes: Uint8Array }[] }
  | { type: 'health'; status: 'online' | 'offline' | 'error'; message?: string }
  | { type: 'log'; line: string }

/** A Worker, a child process, or a stand-in for tests: what a sandbox host talks to. */
export interface AddonWorkerLike {
  postMessage: (message: ToAddon) => void
  onmessage: ((event: { data: FromAddon }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate: () => void
}

/**
 * The adapter between today's protocol 2 messages and the contract envelope (docs/36 §4, §9; #964). It keeps every existing add-on working while the
 * messages are replaced one by one: the envelope is the goal, these two functions are the bridge and disappear with the last v2 message.
 *
 * | protocol 2                          | envelope                                                              |
 * |-------------------------------------|-----------------------------------------------------------------------|
 * | `call`                              | `request`   method = the method, body `{args}`                        |
 * | `call-result`                       | `response`  body `{from:'call-result', data?, files}` / `error`       |
 * | `job`                               | `request`   method `job:<type>`, body = the job (id, type, input)     |
 * | `job-result`                        | `response`  body `{from:'job-result', files, data?}` / `error`        |
 * | `helper-run`                        | `request`   method `capability.helper`, body `{request, helper, args, files?}` |
 * | `helper-result`                     | `response`  body `{from:'helper-result', request, result, files}` / `error` (`helper.error`) |
 * | `job-progress`                      | `notify`    topic `progress`, body `{id, fraction}`                   |
 * | `log`                               | `notify`    topic `log`, body `{line}`                                |
 * | `health`                            | `notify`    topic `health`, body `{status, message?}`                 |
 * | `event`, `result`, `midi-out`, `midi-reply`, `init`, `shutdown` | none - device events and start-up are not method traffic |
 *
 * A response envelope carries no method (docs/36 §4), so a mapped result names the v2 message it was in `body.from` (or `error.params.from` when it
 * failed). That marker is the adapter's own bookkeeping; a protocol 3 script never sends it, and its response reads as a `call-result`.
 */

type EnvelopeRequest = Extract<Envelope, { kind: 'request' }>
type EnvelopeResponse = Extract<Envelope, { kind: 'response' }>
type EnvelopeNotify = Extract<Envelope, { kind: 'notify' }>

interface AddonFile {
  bytes: Uint8Array
}

/** A JSON object from an unknown envelope body, or null - the adapter never invents fields that are not there. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Protocol 2's answer: the response envelope, or null for a message the contract has no equivalent for. */
export function toEnvelope(message: FromAddon | ToAddon): Envelope | null {
  switch (message.type) {
    case 'call':
      return { kind: 'request', id: message.id, method: message.method, body: { args: message.args } }
    case 'call-result':
      return message.ok
        ? { kind: 'response', id: message.id, ok: true, body: { from: 'call-result', ...(message.data !== undefined ? { data: message.data } : {}), files: message.files ?? [] } }
        : { kind: 'response', id: message.id, ok: false, error: { code: message.messageCode ?? 'addon.error', message: message.message, params: { from: 'call-result' } } }
    case 'job':
      return { kind: 'request', id: message.id, method: `job:${message.job.type}`, body: message.job }
    case 'job-result':
      return message.ok
        ? { kind: 'response', id: message.id, ok: true, body: { from: 'job-result', files: message.files, ...(message.data ? { data: message.data } : {}) } }
        : { kind: 'response', id: message.id, ok: false, error: { code: message.messageCode ?? 'addon.error', message: message.message, params: { from: 'job-result' } } }
    case 'helper-run':
      return {
        kind: 'request',
        id: message.id,
        method: 'capability.helper',
        body: { request: message.request, helper: message.helper, args: message.args, ...(message.files ? { files: message.files } : {}) },
      }
    case 'helper-result':
      return message.error !== undefined
        ? { kind: 'response', id: message.id, ok: false, error: { code: 'helper.error', message: message.error, params: { from: 'helper-result', request: message.request } } }
        : { kind: 'response', id: message.id, ok: true, body: { from: 'helper-result', request: message.request, result: message.result, files: message.files } }
    case 'job-progress':
      return { kind: 'notify', topic: 'progress', body: { id: message.id, fraction: message.fraction } }
    case 'log':
      return { kind: 'notify', topic: 'log', body: { line: message.line } }
    case 'health':
      return { kind: 'notify', topic: 'health', body: { status: message.status, ...(message.message !== undefined ? { message: message.message } : {}) } }
    default:
      // An event and its MIDI reply belong to a device, and start-up is not a call: the envelope has no place for them.
      return null
  }
}

/** The protocol 2 message an envelope carries, or null when it is a kind v2 does not have (`ui-*`, `subscribe`/`update`). */
export function fromEnvelope(envelope: Envelope): FromAddon | ToAddon | null {
  switch (envelope.kind) {
    case 'request':
      return requestFromEnvelope(envelope)
    case 'response':
      return responseFromEnvelope(envelope)
    case 'notify':
      return notifyFromEnvelope(envelope)
    default:
      return null
  }
}

function requestFromEnvelope(envelope: EnvelopeRequest): FromAddon | ToAddon | null {
  const body = asRecord(envelope.body)

  if (envelope.method.startsWith('job:')) {
    if (!body) return null
    return { type: 'job', id: envelope.id, job: { id: typeof body.id === 'string' ? body.id : String(envelope.id), type: envelope.method.slice('job:'.length), input: asRecord(body.input) ?? {} } }
  }

  if (envelope.method === 'capability.helper') {
    const helper = body?.helper
    if (typeof helper !== 'string' || helper.length === 0) return null
    const args = Array.isArray(body?.args) ? body.args.filter((arg): arg is string => typeof arg === 'string') : []
    const files = Array.isArray(body?.files) ? (body.files as (AddonFile & { name: string })[]) : undefined
    return {
      type: 'helper-run',
      id: envelope.id,
      request: typeof body?.request === 'number' ? body.request : envelope.id,
      helper,
      args,
      ...(files ? { files } : {}),
    }
  }

  return { type: 'call', id: envelope.id, method: envelope.method, args: asRecord(body?.args) ?? {} }
}

function responseFromEnvelope(envelope: EnvelopeResponse): FromAddon | ToAddon | null {
  if (!envelope.ok) {
    const params = asRecord(envelope.error.params)
    const from = typeof params?.from === 'string' ? params.from : 'call-result'
    if (from === 'helper-result') {
      return { type: 'helper-result', id: envelope.id, request: typeof params?.request === 'number' ? params.request : envelope.id, result: null, files: [], error: envelope.error.message }
    }
    // `addon.error` is the adapter's own default, so it is not written back as if the add-on had chosen it.
    const messageCode = envelope.error.code === 'addon.error' ? {} : { messageCode: envelope.error.code }
    if (from === 'job-result') return { type: 'job-result', id: envelope.id, ok: false, message: envelope.error.message, ...messageCode }
    return { type: 'call-result', id: envelope.id, ok: false, message: envelope.error.message, ...messageCode }
  }

  const body = asRecord(envelope.body)
  const from = typeof body?.from === 'string' ? body.from : undefined
  const files = (): { key: string; bytes: Uint8Array }[] => (Array.isArray(body?.files) ? (body.files as { key: string; bytes: Uint8Array }[]) : [])

  if (from === 'helper-result') {
    return {
      type: 'helper-result',
      id: envelope.id,
      request: typeof body?.request === 'number' ? body.request : envelope.id,
      result: body?.result ?? null,
      files: Array.isArray(body?.files) ? (body.files as (AddonFile & { name: string })[]) : [],
    }
  }
  if (from === 'job-result') {
    const data = asRecord(body?.data)
    return { type: 'job-result', id: envelope.id, ok: true, files: files(), ...(data ? { data } : {}) }
  }
  // No marker: a protocol 3 script answered a method, and its body is that method's output (docs/36 §4).
  if (from === undefined) return { type: 'call-result', id: envelope.id, ok: true, ...(body !== null ? { data: body } : {}), files: [] }
  return {
    type: 'call-result',
    id: envelope.id,
    ok: true,
    ...(body && body.data !== undefined ? { data: body.data } : {}),
    files: files(),
  }
}

function notifyFromEnvelope(envelope: EnvelopeNotify): FromAddon | null {
  const body = asRecord(envelope.body)
  switch (envelope.topic) {
    case 'progress': {
      if (typeof body?.id !== 'number' || typeof body.fraction !== 'number') return null
      return { type: 'job-progress', id: body.id, fraction: body.fraction }
    }
    case 'log':
      return typeof body?.line === 'string' ? { type: 'log', line: body.line } : null
    case 'health': {
      const status = body?.status
      if (status !== 'online' && status !== 'offline' && status !== 'error') return null
      return { type: 'health', status, ...(typeof body?.message === 'string' ? { message: body.message } : {}) }
    }
    default:
      return null
  }
}
