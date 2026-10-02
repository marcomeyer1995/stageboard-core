import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installShutdownHandlers, trackConnections } from './gracefulShutdown.js'

function setup(close: () => Promise<void>) {
  const proc = new EventEmitter()
  const log = { info: vi.fn(), error: vi.fn() }
  const exit = vi.fn()
  installShutdownHandlers(proc, { close, log, exit, deadlineMs: 1000 })
  return { proc, log, exit }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('installShutdownHandlers', () => {
  it('closes the app on SIGTERM and exits 0', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const { proc, exit } = setup(close)
    proc.emit('SIGTERM')
    await vi.runAllTimersAsync()
    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 when closing hangs past the deadline', async () => {
    const { proc, log, exit } = setup(() => new Promise(() => {}))
    proc.emit('SIGINT')
    await vi.advanceTimersByTimeAsync(999)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(log.error).toHaveBeenCalledWith('Shutdown did not finish in time - exiting anyway', expect.anything())
  })

  it('exits 1 when closing fails, and at once on a second signal', async () => {
    const failing = setup(() => Promise.reject(new Error('boom')))
    failing.proc.emit('SIGTERM')
    await vi.runAllTimersAsync()
    expect(failing.exit).toHaveBeenCalledWith(1)

    const hanging = setup(() => new Promise(() => {}))
    hanging.proc.emit('SIGTERM')
    hanging.proc.emit('SIGTERM')
    expect(hanging.exit).toHaveBeenCalledWith(1)
  })
})

describe('trackConnections', () => {
  it('destroys every still-open connection, forgets closed ones', () => {
    const server = new EventEmitter()
    const destroyAll = trackConnections(server)
    const open = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    const closed = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    server.emit('secureConnection', open)
    server.emit('secureConnection', closed)
    closed.emit('close')

    destroyAll()
    expect(open.destroy).toHaveBeenCalledTimes(1)
    expect(closed.destroy).not.toHaveBeenCalled()
  })
})
