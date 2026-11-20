import type { ShowControlResult } from './plugin.js'

/**
 * The messages between StageBoard and a sandboxed **device** add-on that drives hardware - events in, MIDI out (docs/32 §4, #757). Everything else an
 * add-on says to StageBoard or hears from it - methods, jobs, capabilities, UI - is the contract's envelope (`addonContract.ts`, docs/36, #964); the
 * messages for jobs, calls and helpers that lived here are gone. These device messages move onto the envelope with the device state (docs/36 §5a).
 * **There is no server**: the same messages whatever device runs the add-on - in a Worker of the app, or (envelope only) in a Node process.
 */

/** The version of the add-on API this build speaks; an add-on that needs a newer one is refused. */
export const ADDON_PROTOCOL_VERSION = 2

/** What an add-on gets with each event - this device's settings for the device it drives. */
export interface AddonEventContext {
  /** MIDI channel 1-16 set up for the device (DeviceTransportConfig). */
  midiChannel: number
}

export type ToAddon =
  | { type: 'init'; apiVersion: number; protocol: number; contractVersion?: number; settings: Record<string, unknown>; permissions: string[]; language: string }
  | { type: 'event'; id: number; event: { type: string; payload?: Record<string, unknown> }; context: AddonEventContext }
  /** The answer to a `midi-out` with `expectReply`: the first matching message, or null after the timeout. */
  | { type: 'midi-reply'; id: number; request: number; data: number[] | null }
  | { type: 'shutdown' }

export type FromAddon =
  | { type: 'result'; id: number; result: ShowControlResult }
  /** Bytes for the device of event `id`. With `expectReply` StageBoard listens for a reply starting
   * with `prefix` *before* sending (a reply can be faster than attaching a listener afterwards -
   * found with the real MG-30, 2026-09-08) and answers with `midi-reply`. */
  | { type: 'midi-out'; id: number; bytes: number[]; request?: number; expectReply?: { prefix: number[]; timeoutMs: number } }
  | { type: 'health'; status: 'online' | 'offline' | 'error'; message?: string }
  | { type: 'log'; line: string }

/** A Worker, a child process, or a stand-in for tests: what a sandbox host talks to. */
export interface AddonWorkerLike {
  postMessage: (message: ToAddon) => void
  onmessage: ((event: { data: FromAddon }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate: () => void
}
