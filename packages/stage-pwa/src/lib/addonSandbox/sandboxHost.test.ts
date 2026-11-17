import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddonWorkerLike, FromAddon, ToAddon } from './protocol'
import { ADDON_EVENT_TIMEOUT_MS, AddonSandbox, type SandboxIO, type WorkerFactory } from './sandboxHost'

// The real add-on (the MG-30 repository's client.js) in a stand-in for a Worker: the script gets its
// own `self`, and messages go both ways asynchronously, as between a page and a Worker.
const MG30 = readFileSync(join(__dirname, '__fixtures__', 'nux-mg30-client.js'), 'utf8')

const inProcess: WorkerFactory = (code) => {
  const scope: { onmessage: ((e: { data: ToAddon }) => unknown) | null; postMessage: (m: FromAddon) => void } = {
    onmessage: null,
    postMessage: (m) => queueMicrotask(() => worker.onmessage?.({ data: structuredClone(m) })),
  }
  const worker: AddonWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (m) => queueMicrotask(() => void scope.onmessage?.({ data: structuredClone(m) })),
    terminate: () => {
      scope.onmessage = null
    },
  }
  new Function('self', code)(scope)
  return worker
}

function io(reply: number[] | null = null): SandboxIO & { sent: number[][]; asked: { bytes: number[]; prefix: number[] }[] } {
  const sent: number[][] = []
  const asked: { bytes: number[]; prefix: number[] }[] = []
  return {
    sent,
    asked,
    context: { midiChannel: 3 },
    send: (bytes) => void sent.push(bytes),
    sendAndWait: async (bytes, prefix) => {
      asked.push({ bytes, prefix })
      return reply ? Uint8Array.from(reply) : null
    },
  }
}

const installation = { id: 'nux-mg30', permissions: ['midi-out:NUX MG-30'], settings: {} }

afterEach(() => vi.useRealTimers())

describe('AddonSandbox with the MG-30 add-on (#757)', () => {
  it('a patch: program change on the device channel, and the patch name back', async () => {
    const sandbox = new AddonSandbox(installation, MG30, 'de', inProcess)
    const port = io()
    const result = await sandbox.run({ type: 'mg30.selectPatch', payload: { program: 5 } }, port)
    expect(port.sent).toEqual([[0xc2, 5]])
    expect(result).toEqual({ status: 'ok', data: { program: 5, patchName: '02B' } })
  })

  it('a knob: control change - and nothing for a CC that is no knob', async () => {
    const sandbox = new AddonSandbox(installation, MG30, 'de', inProcess)
    const port = io()
    expect(await sandbox.run({ type: 'mg30.setKnob', payload: { cc: 22, value: 64 } }, port)).toMatchObject({ status: 'ok' })
    expect(port.sent).toEqual([[0xb2, 22, 64]])
    const refused = await sandbox.run({ type: 'mg30.setKnob', payload: { cc: 16, value: 64 } }, port)
    expect(refused).toMatchObject({ status: 'error', message: 'mg30.setKnob: CC 16 ist kein Regler des MG-30.' })
    expect(port.sent).toHaveLength(1)
  })

  it('test: the identity request, listened for before sending, and the firmware from the reply', async () => {
    const sandbox = new AddonSandbox(installation, MG30, 'en', inProcess)
    const reply = [0xf0, 0x43, 0x58, 0x10, ...'4.0.3'.split('').map((c) => c.charCodeAt(0)), 0, 0xf7]
    const port = io(reply)
    expect(await sandbox.run({ type: 'test' }, port)).toEqual({ status: 'ok', message: 'Firmware 4.0.3' })
    expect(port.asked).toEqual([{ bytes: [0xf0, 0x43, 0x58, 0x00, 0xf7], prefix: [0xf0, 0x43, 0x58, 0x10] }])
    expect(await sandbox.run({ type: 'test' }, io(null))).toEqual({ status: 'error', message: 'MG-30: no answer to the identity request.' })
  })

  it('without the permission nothing reaches the device', async () => {
    const sandbox = new AddonSandbox({ ...installation, permissions: [] }, MG30, 'de', inProcess)
    const port = io()
    await sandbox.run({ type: 'mg30.selectPatch', payload: { program: 1 } }, port)
    expect(port.sent).toEqual([])
    expect(sandbox.log).toContain('refused midi-out from nux-mg30')
  })

  it('an add-on that never answers fails the event after the timeout', async () => {
    vi.useFakeTimers()
    const silent: WorkerFactory = () => ({ onmessage: null, onerror: null, postMessage: () => {}, terminate: () => {} })
    const sandbox = new AddonSandbox(installation, '', 'de', silent)
    const pending = sandbox.run({ type: 'mg30.selectPatch', payload: { program: 1 } }, io())
    vi.advanceTimersByTime(ADDON_EVENT_TIMEOUT_MS)
    expect(await pending).toEqual({ status: 'error', message: 'Add-on nux-mg30: keine Antwort' })
  })
})
