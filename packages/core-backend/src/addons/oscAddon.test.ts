import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOscAddonPlugin } from './oscAddon.js'
import { createOscPlugin, encodeOscMessage, parseOscArgs, setOscTargetResolver } from '../plugins/oscPlugin.js'
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

describe('the OSC add-on in the sandbox (#964)', () => {
  it('sends real UDP packets that are byte for byte what the built-in plugin encodes - ints, floats, strings, booleans', async () => {
    const plugin = createOscAddonPlugin()
    for (const [address, args] of [['/cue/1/go', ''], ['/fader', '0.5 1 "hello world" true false -7 1,25'], ['/ä/ü', 'Größe']] as const) {
      received.length = 0
      expect(await plugin.trigger(cue({ address, args }))).toEqual({ status: 'ok' })
      await waitFor(1)
      expect([...received[0]!]).toEqual([...encodeOscMessage(address, parseOscArgs(args))])
    }
  })

  it('refuses an address OSC does not allow - nothing is sent - with the same words as the built-in plugin', async () => {
    received.length = 0
    const mine = await createOscAddonPlugin().trigger(cue({ address: '/bad address*' }))
    const builtin = await createOscPlugin().trigger(cue({ address: '/bad address*' }))
    expect(mine).toEqual(builtin)
    expect(mine.status).toBe('error')
    await new Promise((r) => setTimeout(r, 150))
    expect(received).toHaveLength(0)
  })

  it('says so when the device has no network settings, and for an unknown command', async () => {
    const plugin = createOscAddonPlugin()
    const builtin = createOscPlugin()
    expect(await plugin.trigger(cue({ address: '/x' }, 'no-such-device'))).toEqual(await builtin.trigger(cue({ address: '/x' }, 'no-such-device')))
    expect(await plugin.trigger({ type: 'other' } as never)).toEqual(await builtin.trigger({ type: 'other' } as never))
  })

  it('a send that fails is reported with host, port and the reason', async () => {
    setOscTargetResolver(async () => ({ host: '127.0.0.1', port: 70000 }))
    const result = await createOscAddonPlugin().trigger(cue({ address: '/x' }, 'any'))
    expect(result).toMatchObject({ status: 'error', messageCode: 'osc.sendFailed' })
    setOscTargetResolver(async (id) => (id === 'lights' ? { host: '127.0.0.1', port } : null))
  })

  it('the udp-send helper refuses what is no datagram, and only a declared helper may be asked for', async () => {
    const run = helperRunnerFor(['udp-send'])
    await expect(run('udp-send', ['127.0.0.1', '0'], () => {}, [{ name: 'packet', bytes: new Uint8Array(4) }])).rejects.toThrow(/port/)
    await expect(run('udp-send', ['127.0.0.1', '9'], () => {}, [{ name: 'packet', bytes: new Uint8Array(9000) }])).rejects.toThrow(/8192/)
    await expect(helperRunnerFor(['stems'])('udp-send', [], () => {}, [])).rejects.toThrow('No helper')
  })
})
