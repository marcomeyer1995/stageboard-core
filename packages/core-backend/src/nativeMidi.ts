import { Input, Output } from '@julusian/midi'

/**
 * This machine's own MIDI ports (RtMidi through `@julusian/midi`), in one place (#964): the Host's Discovery watcher (`midiWatcher.ts`) and
 * the `midi-out` capability StageBoard gives a device add-on (`addons/capabilities.ts`) use it. An add-on never opens a port: StageBoard sends
 * for it, to the port of the device it drives. MIDI is optional - when the ALSA sequencer cannot be opened (no `/dev/snd/seq` before a desktop
 * login, #336) every call says so and nothing throws.
 */
export interface NativeMidi {
  /** The names of the output ports, or null when MIDI cannot be opened on this machine. */
  outputs(): string[] | null
  /** The names of the input ports, or null when MIDI cannot be opened on this machine. */
  inputs(): string[] | null
  /** Sends `bytes` to the output named `port`: false when there is no such port (or no MIDI). */
  send(port: string, bytes: readonly number[]): boolean
  /**
   * Listens on the input of the same device **before** it sends (a reply can be faster than a listener attached afterwards - found with the
   * real MG-30, 2026-09-08), then sends: the first message that starts with `prefix`, or null after `timeoutMs`. `undefined`: nothing was sent
   * (no such output).
   */
  sendAndWait(port: string, bytes: readonly number[], prefix: readonly number[], timeoutMs: number): Promise<number[] | null | undefined>
  /** Every message on the input named `port`, until the returned stop; null when there is no such input (or no MIDI). */
  listen(port: string, onMessage: (message: number[]) => void): (() => void) | null
}

const names = (port: Input | Output): string[] => Array.from({ length: port.getPortCount() }, (_, i) => port.getPortName(i))

/** A port name without the ALSA address at its end (`... 24:0`), lower case. */
const bare = (name: string): string => name.replace(/\s+\d+:\d+$/, '').trim().toLowerCase()
/** The port part of `client:port` (ALSA); the whole name where there is no client (CoreMIDI, Windows). */
const portPart = (name: string): string => bare(name.includes(':') ? name.slice(name.indexOf(':') + 1) : name)
const clientPart = (name: string): string => (name.includes(':') ? name.split(':')[0]!.trim().toLowerCase() : '')

/**
 * The input that belongs to output `port`, in this order: the same name (ALSA and CoreMIDI name both directions of a device alike); the same
 * port name under another client (a virtual device: `RtMidiIn Client:NUX MG-30 Emulator 128:0` ↔ `RtMidiOut Client:NUX MG-30 Emulator 129:0`);
 * the first input of the same client (`MG-30:MG-30 MIDI 1 24:0` → `MG-30:...`).
 */
export function inputFor(port: string, inputs: readonly string[]): number {
  const same = inputs.findIndex((name) => bare(name) === bare(port))
  if (same !== -1) return same
  const samePort = inputs.findIndex((name) => portPart(name) === portPart(port))
  if (samePort !== -1) return samePort
  const client = clientPart(port)
  return client ? inputs.findIndex((name) => clientPart(name) === client) : -1
}

export const startsWith = (message: readonly number[], prefix: readonly number[]): boolean => prefix.every((byte, i) => message[i] === byte)

export function createNativeMidi(log?: { info: (msg: string) => void; error: (msg: string, meta?: Record<string, unknown>) => void }): NativeMidi {
  let unavailable = false
  /** Open outputs by name: a cue must not wait for a port to open. Dropped when a send fails (the device was unplugged). */
  const open = new Map<string, Output>()

  function make<T>(create: () => T): T | null {
    try {
      const port = create()
      if (unavailable) (unavailable = false), log?.info('Native MIDI available again')
      return port
    } catch (err) {
      if (!unavailable) (unavailable = true), log?.error('Native MIDI unavailable - running without this machine\'s own MIDI ports', { error: String(err) })
      return null
    }
  }

  function list(create: () => Input | Output): string[] | null {
    const probe = make(create)
    if (!probe) return null
    try {
      return names(probe)
    } finally {
      probe.destroy()
    }
  }

  function outputNamed(port: string): Output | null {
    const cached = open.get(port)
    if (cached) return cached
    const output = make(() => new Output())
    if (!output) return null
    const index = names(output).indexOf(port)
    if (index === -1) {
      output.destroy()
      return null
    }
    output.openPort(index)
    open.set(port, output)
    return output
  }

  function send(port: string, bytes: readonly number[]): boolean {
    const output = outputNamed(port)
    if (!output) return false
    try {
      output.sendMessage([...bytes])
      return true
    } catch (err) {
      log?.error('MIDI send failed', { port, error: String(err) })
      open.delete(port)
      output.destroy()
      return false
    }
  }

  return {
    outputs: () => list(() => new Output()),
    inputs: () => list(() => new Input()),
    send,
    listen(port, onMessage) {
      const input = make(() => new Input())
      if (!input) return null
      const index = names(input).indexOf(port)
      if (index === -1) {
        input.destroy()
        return null
      }
      input.on('message', (_delta: number, message: number[]) => onMessage(message))
      try {
        input.openPort(index)
      } catch (err) {
        // The port vanished between listing and opening.
        log?.error('Failed to open a MIDI input', { port, error: String(err) })
        input.destroy()
        return null
      }
      return () => {
        input.closePort()
        input.destroy()
      }
    },
    async sendAndWait(port, bytes, prefix, timeoutMs) {
      if (!outputNamed(port)) return undefined
      const input = make(() => new Input())
      const index = input ? inputFor(port, names(input)) : -1
      if (!input || index === -1) {
        input?.destroy()
        return send(port, bytes) ? null : undefined
      }
      return new Promise((resolve) => {
        let done = false
        const finish = (reply: number[] | null | undefined) => {
          if (done) return
          done = true
          clearTimeout(timer)
          input.closePort()
          input.destroy()
          resolve(reply)
        }
        const timer = setTimeout(() => finish(null), timeoutMs)
        // SysEx is what a device answers an identity request with; RtMidi ignores it unless told not to.
        input.ignoreTypes(false, true, true)
        input.on('message', (_delta: number, message: number[]) => {
          if (startsWith(message, prefix)) finish([...message])
        })
        input.openPort(index)
        if (!send(port, bytes)) finish(undefined)
      })
    },
  }
}

let shared: NativeMidi | null = null
/** The one set of this machine's MIDI ports for the whole process (the Discovery watcher and the add-ons share the open outputs). */
export function sharedNativeMidi(log?: Parameters<typeof createNativeMidi>[0]): NativeMidi {
  shared ??= createNativeMidi(log)
  return shared
}
