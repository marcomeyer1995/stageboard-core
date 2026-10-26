import { createSocket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createOscPlugin, encodeOscMessage, isOscAddress, oscTargetFromConfig, parseOscArgs, setOscTargetResolver } from './oscPlugin.js'

const context = (): PluginContext => ({ log: { info: vi.fn(), error: vi.fn() } })

afterEach(() => setOscTargetResolver(async () => null))

describe('OSC encoding (#484)', () => {
  it('encodes the OSC 1.0 spec example "/oscillator/4/frequency" 440.0', () => {
    // From the OSC 1.0 specification's own example message.
    const expected = Buffer.from([
      ...Buffer.from('/oscillator/4/frequency'), 0,
      ...Buffer.from(',f'), 0, 0,
      0x43, 0xdc, 0x00, 0x00,
    ])
    expect(encodeOscMessage('/oscillator/4/frequency', [{ type: 'f', value: 440 }])).toEqual(expected)
  })

  it('pads every string to four bytes and writes ints big-endian; T/F have no data', () => {
    const msg = encodeOscMessage('/cue', [{ type: 'i', value: 12 }, { type: 's', value: 'go' }, { type: 'T' }])
    expect(msg.length % 4).toBe(0)
    expect(msg.subarray(0, 8)).toEqual(Buffer.from([...Buffer.from('/cue'), 0, 0, 0, 0]))
    expect(msg.subarray(8, 16)).toEqual(Buffer.from([...Buffer.from(',isT'), 0, 0, 0, 0]))
    expect(msg.readInt32BE(16)).toBe(12)
    expect(msg.subarray(20, 24)).toEqual(Buffer.from([...Buffer.from('go'), 0, 0]))
  })

  it('reads the cue\'s values as typed arguments - more than one', () => {
    expect(parseOscArgs('1 0.5 true "Intro Teil" go -3 2,5')).toEqual([
      { type: 'i', value: 1 },
      { type: 'f', value: 0.5 },
      { type: 'T' },
      { type: 's', value: 'Intro Teil' },
      { type: 's', value: 'go' },
      { type: 'i', value: -3 },
      { type: 'f', value: 2.5 },
    ])
    expect(parseOscArgs('   ')).toEqual([])
  })

  it('knows a valid address', () => {
    expect(isOscAddress('/cue/12/go')).toBe(true)
    expect(isOscAddress('cue/12')).toBe(false)
    expect(isOscAddress('/cue 12')).toBe(false)
    expect(isOscAddress('/cue/*')).toBe(false)
  })
})

describe('OSC plugin', () => {
  it('sends the cue as UDP to the device\'s host and port', async () => {
    const receiver = createSocket('udp4')
    const received = new Promise<Buffer>((resolve) => receiver.once('message', resolve))
    await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve))
    const { port } = receiver.address() as AddressInfo
    const resolver = vi.fn(async () => ({ host: '127.0.0.1', port }))
    setOscTargetResolver(resolver)
    const plugin = createOscPlugin()
    plugin.init(context())
    const result = await plugin.trigger({ type: 'osc.send', payload: { address: '/cue/12/go', args: '1' }, logicalDeviceId: 'qlc' })
    expect(result).toEqual({ status: 'ok' })
    expect(resolver).toHaveBeenCalledWith('qlc')
    expect(await received).toEqual(encodeOscMessage('/cue/12/go', [{ type: 'i', value: 1 }]))
    receiver.close()
    await plugin.shutdown?.()
  })

  it('fails with a reason the Nachbericht can show - no host/port, a bad address, an unknown command', async () => {
    const plugin = createOscPlugin()
    plugin.init(context())
    expect(await plugin.trigger({ type: 'osc.send', payload: { address: '/x' }, logicalDeviceId: 'qlc' })).toEqual({ status: 'error', message: 'Für dieses OSC-Gerät fehlen Host und Port (Bühnentechnik).' })
    setOscTargetResolver(async () => ({ host: '127.0.0.1', port: 9 }))
    expect(await plugin.trigger({ type: 'osc.send', payload: { address: 'x y' } })).toMatchObject({ status: 'error', message: 'Keine gültige OSC-Adresse: „x y“' })
    expect(await plugin.trigger({ type: 'kemper.tuner' })).toMatchObject({ status: 'error' })
  })
})

describe('OSC target from the device\'s transport config', () => {
  const config = (values: Record<string, string>) => ({ id: 'server:qlc', deviceId: 'server', logicalDeviceId: 'qlc', transportId: 'network-osc', values })

  it('reads host and port', () => {
    expect(oscTargetFromConfig(config({ host: ' 192.168.178.40 ', port: '7700' }))).toEqual({ host: '192.168.178.40', port: 7700 })
  })

  it('nothing usable without both, or with a port out of range', () => {
    expect(oscTargetFromConfig(null)).toBeNull()
    expect(oscTargetFromConfig(config({ host: 'qlc.local' }))).toBeNull()
    expect(oscTargetFromConfig(config({ host: 'qlc.local', port: '70000' }))).toBeNull()
    expect(oscTargetFromConfig(config({ host: '', port: '7700' }))).toBeNull()
  })
})
