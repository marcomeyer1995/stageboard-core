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

const { startMdnsResponder } = await import('./mdnsResponder.js')

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
    const handle = startMdnsResponder({ lanIp: '192.168.178.158', hostname: 'stageboard.local', log, retryMs: 5000, createSocket })

    await vi.advanceTimersByTimeAsync(0)
    expect(instances).toHaveLength(0)
    expect(log.error).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(createSocket).toHaveBeenCalledTimes(3)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(instances).toHaveLength(1)
    expect(log.info).toHaveBeenCalledWith('Advertising stageboard.local -> 192.168.178.158 via mDNS')
    await handle.stop()
  })

  it('answers A queries for its hostname only', async () => {
    const handle = startMdnsResponder({ lanIp: '10.0.0.5', hostname: 'stageboard.local', log, createSocket: async () => socket })
    await vi.advanceTimersByTimeAsync(0)
    const mdns = instances[0]!

    mdns.emit('query', { questions: [{ type: 'A', name: 'other.local' }] })
    expect(mdns.respond).not.toHaveBeenCalled()
    mdns.emit('query', { questions: [{ type: 'A', name: 'stageboard.local' }] })
    expect(mdns.respond).toHaveBeenCalledWith({ answers: [{ name: 'stageboard.local', type: 'A', ttl: 120, data: '10.0.0.5' }] })
    await handle.stop()
    expect(mdns.destroy).toHaveBeenCalled()
  })

  it('stop() while still retrying ends the retries', async () => {
    const createSocket = vi.fn().mockRejectedValue(new Error('ENODEV'))
    const handle = startMdnsResponder({ lanIp: '10.0.0.5', hostname: 'stageboard.local', log, retryMs: 5000, createSocket })
    await vi.advanceTimersByTimeAsync(0)
    await handle.stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(createSocket).toHaveBeenCalledTimes(1)
  })
})
