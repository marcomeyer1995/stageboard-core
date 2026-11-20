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
  | { type: 'init'; apiVersion: number; protocol: number; settings: Record<string, unknown>; permissions: string[]; language: string }
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
