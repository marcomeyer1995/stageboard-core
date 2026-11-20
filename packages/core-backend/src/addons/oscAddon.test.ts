import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOscAddonPlugin } from './oscAddon.js'
import { setOscTargetResolver } from '../plugins/oscPlugin.js'
import { helperRunnerFor } from './helpers.js'

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

describe('the udp-send helper (#964)', () => {
  it('refuses what is no datagram, and only a declared helper may be asked for', async () => {
    const run = helperRunnerFor(['udp-send'])
    await expect(run('udp-send', ['127.0.0.1', '0'], () => {}, [{ name: 'packet', bytes: new Uint8Array(4) }])).rejects.toThrow(/port/)
    await expect(run('udp-send', ['127.0.0.1', '9'], () => {}, [{ name: 'packet', bytes: new Uint8Array(9000) }])).rejects.toThrow(/8192/)
    await expect(helperRunnerFor(['stems'])('udp-send', [], () => {}, [])).rejects.toThrow('No helper')
  })
})
