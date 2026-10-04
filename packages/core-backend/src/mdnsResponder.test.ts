import { EventEmitter } from 'node:events'
import type { Socket } from 'node:dgram'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeMdns extends EventEmitter {
  respond = vi.fn()
  destroy = vi.fn((cb: () => void) => cb())
}
const instances: FakeMdns[] = []
vi.mock('multicast-dns', () => ({
  default: () => {
    const mdns = new FakeMdns()
    instances.push(mdns)
    return mdns
  },
}))

const { mdnsAnswer, startMdnsResponder } = await import('./mdnsResponder.js')

const ID = { port: 443, instance: 'StageBoard laptop', certFingerprint: 'ab'.repeat(32) }

const socket = { close: vi.fn() } as unknown as Socket
const log = { info: vi.fn(), error: vi.fn() }

beforeEach(() => {
  vi.useFakeTimers()
  instances.length = 0
  log.info.mockReset()
  log.error.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('startMdnsResponder', () => {
  it('retries while the network is not up, logging the failure once (#339)', async () => {
    const createSocket = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('addMembership ENODEV'), { code: 'ENODEV' }))
      .mockRejectedValueOnce(new Error('addMembership ENODEV'))
      .mockResolvedValue(socket)
    const handle = startMdnsResponder({ lanIp: '192.168.178.158', hostname: 'stageboard.local', ...ID, log, retryMs: 5000, createSocket })

    await vi.advanceTimersByTimeAsync(0)
    expect(instances).toHaveLength(0)
    expect(log.error).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(createSocket).toHaveBeenCalledTimes(3)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(instances).toHaveLength(1)
    expect(log.info).toHaveBeenCalledWith('Advertising stageboard.local -> 192.168.178.158 via mDNS (service "StageBoard laptop" _stageboard._tcp.local)')
    await handle.stop()
  })

  it('answers A queries for its hostname only', async () => {
    const handle = startMdnsResponder({ lanIp: '10.0.0.5', hostname: 'stageboard.local', ...ID, log, createSocket: async () => socket })
    await vi.advanceTimersByTimeAsync(0)
    const mdns = instances[0]!

    mdns.emit('query', { questions: [{ type: 'A', name: 'other.local' }] })
    expect(mdns.respond).not.toHaveBeenCalled()
    mdns.emit('query', { questions: [{ type: 'A', name: 'stageboard.local' }] })
    expect(mdns.respond).toHaveBeenCalledWith({ answers: [{ name: 'stageboard.local', type: 'A', ttl: 120, data: '10.0.0.5' }], additionals: [] })
    await handle.stop()
    expect(mdns.destroy).toHaveBeenCalled()
  })

  it('stop() while still retrying ends the retries', async () => {
    const createSocket = vi.fn().mockRejectedValue(new Error('ENODEV'))
    const handle = startMdnsResponder({ lanIp: '10.0.0.5', hostname: 'stageboard.local', ...ID, log, retryMs: 5000, createSocket })
    await vi.advanceTimersByTimeAsync(0)
    await handle.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(createSocket).toHaveBeenCalledTimes(1)
  })
})

describe('mdnsAnswer - DNS-SD for the native app (#351)', () => {
  const id = { lanIp: '192.168.178.158', hostname: 'stageboard.local', ...ID }
  const instance = 'StageBoard laptop._stageboard._tcp.local'

  it('a browse for _stageboard._tcp gets the instance, with SRV, TXT (fingerprint) and A alongside', () => {
    const response = mdnsAnswer([{ name: '_stageboard._tcp.local', type: 'PTR' }], id)!
    expect(response.answers).toEqual([{ name: '_stageboard._tcp.local', type: 'PTR', ttl: 120, data: instance }])
    expect(response.additionals).toEqual([
      { name: instance, type: 'SRV', ttl: 120, data: { port: 443, target: 'stageboard.local' } },
      { name: instance, type: 'TXT', ttl: 120, data: ['v=1', `fp=${'ab'.repeat(32)}`] },
      { name: 'stageboard.local', type: 'A', ttl: 120, data: '192.168.178.158' },
    ])
  })

  it('resolving the instance answers SRV and TXT; the hostname answers A; unrelated names nothing', () => {
    expect(mdnsAnswer([{ name: instance, type: 'SRV' }, { name: instance, type: 'TXT' }], id)!.answers.map((r) => r.type)).toEqual(['SRV', 'TXT'])
    expect(mdnsAnswer([{ name: 'stageboard.local', type: 'A' }], id)!.answers).toEqual([{ name: 'stageboard.local', type: 'A', ttl: 120, data: '192.168.178.158' }])
    expect(mdnsAnswer([{ name: 'printer.local', type: 'A' }], id)).toBeNull()
  })
})

