import { join } from 'node:path'
import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createOscAddonPlugin } from './oscAddon.js'
import { setOscTargetResolver } from '../plugins/oscPlugin.js'

let receiver: Socket
let port: number
const received: Buffer[] = []

beforeAll(async () => {
  receiver = createSocket('udp4')
  receiver.on('message', (m) => received.push(m))
  await new Promise<void>((r) => receiver.bind(0, '127.0.0.1', r))
  port = (receiver.address() as AddressInfo).port
  setOscTargetResolver(async (id) => (id === 'lights' ? { host: '127.0.0.1', port } : null))
})
afterAll(() => receiver.close())

const waitFor = async (n: number) => { for (let i = 0; i < 100 && received.length < n; i++) await new Promise((r) => setTimeout(r, 20)) }
const cue = (payload: Record<string, unknown>, logicalDeviceId: string | undefined = 'lights') => ({ type: 'osc.send', logicalDeviceId, payload }) as never
async function send(address: string, args = ''): Promise<Buffer> {
  received.length = 0
  expect(await createOscAddonPlugin().trigger(cue({ address, args }))).toEqual({ status: 'ok' })
  await waitFor(1)
  return received[0]!
}

describe('the OSC add-on in the sandbox (#964): real UDP packets', () => {
  it('encodes the OSC 1.0 spec example "/oscillator/4/frequency" 440.0', async () => {
    const expected = Buffer.from([...Buffer.from('/oscillator/4/frequency'), 0, ...Buffer.from(',f'), 0, 0, 0x43, 0xdc, 0x00, 0x00])
    expect([...(await send('/oscillator/4/frequency', '440.0'))]).toEqual([...expected])
  })

  it('pads every string to four bytes and writes ints big-endian; T/F have no data', async () => {
    const msg = await send('/cue', '12 "go" true')
    expect(msg.length % 4).toBe(0)
    expect(msg.subarray(0, 8)).toEqual(Buffer.from([...Buffer.from('/cue'), 0, 0, 0, 0]))
    expect(msg.subarray(8, 16)).toEqual(Buffer.from([...Buffer.from(',isT'), 0, 0, 0, 0]))
    expect(msg.readInt32BE(16)).toBe(12)
    expect(msg.subarray(20, 24)).toEqual(Buffer.from([...Buffer.from('go'), 0, 0]))
  })

  it('reads the cue\'s values as typed arguments - more than one: int, float, bool, quoted and bare strings, comma decimals', async () => {
    const msg = await send('/x', '1 0.5 true "Intro Teil" go -3 2,5')
    const tags = msg.toString('latin1', 4, 16).replace(/\0/g, '')
    expect(tags).toBe(',ifTssif')
    expect(msg.readInt32BE(16)).toBe(1)
    expect(msg.readFloatBE(20)).toBe(0.5)
    expect(msg.readFloatBE(msg.length - 4)).toBe(2.5)
    expect(msg.readInt32BE(msg.length - 8)).toBe(-3)
    expect(msg.includes(Buffer.from('Intro Teil'))).toBe(true)
  })

  it('keeps umlauts as UTF-8', async () => {
    expect((await send('/ä/ü', 'Größe')).includes(Buffer.from('Größe'))).toBe(true)
  })
})

describe('what the add-on says when it cannot send - its own words, nothing sent (#964)', () => {
  const plugin = () => createOscAddonPlugin()

  it('an address OSC does not allow', async () => {
    received.length = 0
    for (const address of ['cue/12', '/cue 12', '/cue/*', '']) {
      expect(await plugin().trigger(cue({ address }))).toEqual({ status: 'error', message: `Keine gültige OSC-Adresse: „${address}“` })
    }
    await new Promise((r) => setTimeout(r, 150))
    expect(received).toHaveLength(0)
  })

  it('a device with no host and port, and an unknown command', async () => {
    expect(await plugin().trigger(cue({ address: '/x' }, 'no-such-device'))).toEqual({ status: 'error', message: 'Für dieses OSC-Gerät fehlen Host und Port (Bühne).' })
    // A command the add-on never declared is refused at the contract's boundary - the add-on is not even asked.
    expect(await plugin().trigger({ type: 'kemper.tuner' } as never)).toMatchObject({ status: 'error', message: expect.stringContaining('kemper.tuner') })
  })

  it('a send that fails is reported with host, port and the reason', async () => {
    setOscTargetResolver(async () => ({ host: '127.0.0.1', port: 70000 }))
    expect(await plugin().trigger(cue({ address: '/x' }, 'any'))).toMatchObject({ status: 'error', message: expect.stringContaining('OSC an 127.0.0.1:70000 fehlgeschlagen') })
    setOscTargetResolver(async (id) => (id === 'lights' ? { host: '127.0.0.1', port } : null))
  })
})

describe('OSC sends only where StageBoard says (#964, docs/36 §5, review)', () => {
  it('a hostile add-on cannot send to a target of its own choosing - only the target granted for THIS call goes out', async () => {
    const { createAddonMethods } = await import('./addonMethods.js')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const root = mkdtempSync(join(tmpdir(), 'sb-udp-'))
    mkdirSync(join(root, 'evil'))
    writeFileSync(join(root, 'evil', 'manifest.json'), JSON.stringify({ id: 'evil', permissions: [], contributes: { methods: { go: { in: { type: 'object' }, out: { type: 'object' }, timeoutMs: 5000 } } } }))
    // It is told a target, but asks for a different port - and for a different host.
    writeFileSync(join(root, 'evil', 'work.js'), `
      var out = {}, pending = 0
      function ask(host, port, id, key, done) { pending++; var rid = 100 + pending; waiting[rid] = function (m) { out[key] = m.ok ? 'SENT' : m.error.code; if (--pending === 0) done() }; self.postMessage({ kind: 'request', id: rid, method: 'capability.udp', body: { host: host, port: port, bytes: new Uint8Array([1]), forRequest: id } }) }
      var waiting = {}
      self.onmessage = function (e) { var m = e.data
        if (m.kind === 'response') { var w = waiting[m.id]; if (w) w(m); return }
        if (m.kind !== 'request') return
        var finish = function () { self.postMessage({ kind: 'response', id: m.id, ok: true, body: out }) }
        ask(m.body.host, m.body.port, m.id, 'granted', finish)
        ask(m.body.host, m.body.port + 1, m.id, 'otherPort', finish)
        ask('127.0.0.2', m.body.port, m.id, 'otherHost', finish)
        ask(m.body.host, m.body.port, undefined, 'noRequestId', finish)
      }`)
    const methods = createAddonMethods({ root, dirs: ['evil'] })
    const answer = await methods.call('evil', 'go', { host: '127.0.0.1', port }, { grants: [`udp:127.0.0.1:${port}`] })
    expect(answer).toMatchObject({ ok: true, body: { granted: 'SENT', otherPort: 'permission.denied', otherHost: 'permission.denied', noRequestId: 'permission.denied' } })
    // And without a grant at all it sends nothing: the add-on has no permission of its own.
    const none = await methods.call('evil', 'go', { host: '127.0.0.1', port })
    expect(none).toMatchObject({ ok: true, body: { granted: 'permission.denied', otherPort: 'permission.denied' } })
  })

  it('a grant belongs to the call it was given for: a later call does not inherit it', async () => {
    received.length = 0
    expect(await createOscAddonPlugin().trigger(cue({ address: '/once' }))).toEqual({ status: 'ok' })
    await waitFor(1)
    setOscTargetResolver(async () => null)
    expect(await createOscAddonPlugin().trigger(cue({ address: '/two' }, 'no-target'))).toMatchObject({ status: 'error' })
    setOscTargetResolver(async (id) => (id === 'lights' ? { host: '127.0.0.1', port } : null))
    expect(received).toHaveLength(1)
  })

  it('the old udp-send helper is gone: no helper sends to a free target any more', async () => {
    const { HELPERS } = await import('./helpers.js')
    expect(Object.keys(HELPERS)).not.toContain('udp-send')
  })
})

describe('the OSC device publishes its state (#964, docs/36 §5a - the proof that the contract carries a device)', () => {
  it('after a cue is sent the band\'s device state says which one - declared by the add-on, checked, shared, replayed to a device that connects later', async () => {
    const { createAddonMethods } = await import('./addonMethods.js')
    const { relayAddonState } = await import('./stateRelay.js')
    const { deviceStateHub } = await import('sync-host')
    deviceStateHub.__resetForTests()
    const methods = createAddonMethods()
    expect(methods.declaredState('osc')).toEqual({ lastCue: { type: 'string' } })
    methods.onState((addonId, body) => void relayAddonState({ channels: { publishDeviceState: deviceStateHub.publish }, workspaceId: 'band', addonId, body, declared: methods.declaredState(addonId) }))
    const seen: unknown[] = []
    deviceStateHub.subscribe('band', (e) => seen.push(e))
    received.length = 0
    expect(await createOscAddonPlugin({ methods }).trigger(cue({ address: '/cue/12/go', args: '1' }))).toEqual({ status: 'ok' })
    await waitFor(1)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toMatchObject({ device: 'lights', key: 'lastCue', value: '/cue/12/go 1' })
    // A device that opens the band later is told the current value without asking the add-on.
    const late: unknown[] = []
    deviceStateHub.subscribe('band', (e) => late.push(e))
    expect(late).toEqual([expect.objectContaining({ device: 'lights', key: 'lastCue', value: '/cue/12/go 1' })])
  })

  it('a refused cue publishes nothing', async () => {
    const { createAddonMethods } = await import('./addonMethods.js')
    const { deviceStateHub } = await import('sync-host')
    deviceStateHub.__resetForTests()
    const methods = createAddonMethods()
    const heard: unknown[] = []
    methods.onState((_id, body) => void heard.push(body))
    expect(await createOscAddonPlugin({ methods }).trigger(cue({ address: 'not an address' }))).toMatchObject({ status: 'error' })
    await new Promise((r) => setTimeout(r, 150))
    expect(heard).toEqual([])
  })
})
