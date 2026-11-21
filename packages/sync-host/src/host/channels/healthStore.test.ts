import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetHealthStoreForTests, getSnapshot, setEntry, subscribe } from './healthStore.js'

beforeEach(() => {
  __resetHealthStoreForTests()
})

describe('getSnapshot', () => {
  it('is empty for a workspace nothing has reported into yet', () => {
    expect(getSnapshot('band-a')).toEqual({ plugins: {} })
  })

  it('reflects every entry set for that workspace', () => {
    setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 100 })
    setEntry('band-a', 'generic-webmidi', { status: 'offline', lastSeenAt: 200 })

    expect(getSnapshot('band-a')).toEqual({
      plugins: {
        'mock-mixer': { status: 'online', lastSeenAt: 100 },
        'generic-webmidi': { status: 'offline', lastSeenAt: 200 },
      },
    })
  })

  it('keeps workspaces fully isolated from each other', () => {
    setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 100 })
    expect(getSnapshot('band-b')).toEqual({ plugins: {} })
  })

  it('overwrites an existing entry for the same plugin', () => {
    setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 100 })
    setEntry('band-a', 'mock-mixer', { status: 'offline', lastSeenAt: 200 })

    expect(getSnapshot('band-a').plugins['mock-mixer']).toEqual({ status: 'offline', lastSeenAt: 200 })
  })
})

describe('subscribe', () => {
  it('calls the subscriber immediately with the current snapshot', () => {
    setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 100 })
    const subscriber = vi.fn()

    subscribe('band-a', subscriber)

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith({ plugins: { 'mock-mixer': { status: 'online', lastSeenAt: 100 } } })
  })

  it('calls every subscriber again with the full snapshot on a later update', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 100 })

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith({ plugins: { 'mock-mixer': { status: 'online', lastSeenAt: 100 } } })
  })

  it('does not notify a subscriber of a different workspace', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setEntry('band-b', 'mock-mixer', { status: 'online', lastSeenAt: 100 })

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('stops notifying once unsubscribed', () => {
    const subscriber = vi.fn()
    const unsubscribe = subscribe('band-a', subscriber)
    subscriber.mockClear()

    unsubscribe()
    setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 100 })

    expect(subscriber).not.toHaveBeenCalled()
  })
})
