import type { ShowControlResult } from 'shared-types'

/**
 * The messages between StageBoard and a sandboxed JS add-on (docs/32 §4, #757). The add-on runs in
 * its own Worker: it sees neither the band's data nor its logins nor the page, only these messages.
 * StageBoard decides which device and port an event is for and sends what the add-on asks for -
 * only with the permission for it (docs/32 §7).
 */

export const ADDON_PROTOCOL_VERSION = 1

/** What an add-on gets with each event - this device's settings for the device it drives. */
export interface AddonEventContext {
  /** MIDI channel 1-16 set up for the device (DeviceTransportConfig). */
  midiChannel: number
}

export type ToAddon =
  | { type: 'init'; apiVersion: number; protocol: number; settings: Record<string, unknown>; permissions: string[]; language: string }
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

/** A Worker or a stand-in for tests. */
export interface AddonWorkerLike {
  postMessage: (message: ToAddon) => void
  onmessage: ((event: { data: FromAddon }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate: () => void
}
