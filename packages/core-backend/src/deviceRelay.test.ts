import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceRelayForTests, relay, subscribe } from './deviceRelay.js'

beforeEach(() => {
  __resetDeviceRelayForTests()
})

describe('relay', () => {
  it('returns false when nobody is subscribed for that device', () => {
    expect(relay('band-a', 'device-1', { capability: 'lighting', event: { type: 'strobe' } })).toBe(false)
  })

  it('delivers to the subscriber for that exact (workspace, device) pair and returns true', () => {
    const subscriber = vi.fn()
    subscribe('band-a', 'device-1', subscriber)

    const delivered = relay('band-a', 'device-1', { capability: 'lighting', event: { type: 'strobe' } })

    expect(delivered).toBe(true)
    expect(subscriber).toHaveBeenCalledWith({ capability: 'lighting', event: { type: 'strobe' } })
  })

  it('does not deliver to a subscriber for a different device in the same workspace', () => {
    const subscriber = vi.fn()
    subscribe('band-a', 'device-2', subscriber)

    relay('band-a', 'device-1', { capability: 'lighting', event: { type: 'strobe' } })

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('does not deliver to a subscriber for the same device in a different workspace', () => {
    const subscriber = vi.fn()
    subscribe('band-a', 'device-1', subscriber)

    relay('band-b', 'device-1', { capability: 'lighting', event: { type: 'strobe' } })

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('stops delivering once unsubscribed', () => {
    const subscriber = vi.fn()
    const unsubscribe = subscribe('band-a', 'device-1', subscriber)

    unsubscribe()
    const delivered = relay('band-a', 'device-1', { capability: 'lighting', event: { type: 'strobe' } })

    expect(delivered).toBe(false)
    expect(subscriber).not.toHaveBeenCalled()
  })
})
