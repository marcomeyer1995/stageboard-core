import { describe, expect, it } from 'vitest'
import { decodeOscPacket, oscTargetFromConfig } from './oscPlugin.js'

/** Test-side OSC 1.0 encoder (the sender is the OSC add-on's business, addons/oscAddon.test.ts): just enough to feed the receiver. */
type Arg = { type: 'i' | 'f'; value: number } | { type: 's'; value: string } | { type: 'T' } | { type: 'F' }
const str = (text: string) => {
  const bytes = Buffer.from(text, 'utf8')
  const out = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4)
  bytes.copy(out)
  return out
}
function encodeOscMessage(address: string, args: Arg[]): Buffer {
  const parts = [str(address), str(`,${args.map((a) => a.type).join('')}`)]
  for (const a of args) {
    if (a.type === 'i') parts.push(Buffer.from([(a.value >> 24) & 255, (a.value >> 16) & 255, (a.value >> 8) & 255, a.value & 255]))
    else if (a.type === 'f') {
      const b = Buffer.alloc(4)
      b.writeFloatBE(a.value)
      parts.push(b)
    } else if (a.type === 's') parts.push(str(a.value))
  }
  return Buffer.concat(parts)
}

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

describe('OSC in: decoding what a controller sends (#484)', () => {
  it('reads back what the sender encodes - address and typed values', () => {
    const packet = encodeOscMessage('/1/push1', [{ type: 'f', value: 1 }, { type: 'i', value: -2 }, { type: 's', value: 'Chorus' }, { type: 'T' }, { type: 'F' }])
    expect(decodeOscPacket(packet)).toEqual([{ address: '/1/push1', args: [1, -2, 'Chorus', true, false] }])
  })

  it('a message without arguments, with an empty type tag, and garbage', () => {
    expect(decodeOscPacket(Buffer.from([...Buffer.from('/go'), 0]))).toEqual([{ address: '/go', args: [] }])
    expect(decodeOscPacket(encodeOscMessage('/go', []))).toEqual([{ address: '/go', args: [] }])
    expect(decodeOscPacket(Buffer.from('hello world'))).toEqual([])
    expect(decodeOscPacket(Buffer.from([0x2f, 0x61]))).toEqual([]) // unterminated
  })

  it('unpacks a bundle (TouchOSC sends some that way)', () => {
    const a = encodeOscMessage('/a', [{ type: 'i', value: 1 }])
    const b = encodeOscMessage('/b', [{ type: 'f', value: 0 }])
    const size = (m: Buffer) => {
      const s = Buffer.alloc(4)
      s.writeInt32BE(m.length)
      return s
    }
    const bundle = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), size(a), a, size(b), b])
    expect(decodeOscPacket(bundle)).toEqual([
      { address: '/a', args: [1] },
      { address: '/b', args: [0] },
    ])
  })
})
