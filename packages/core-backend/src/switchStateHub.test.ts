import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetForTests, broadcast, HOLD_TIMEOUT_MS, subscribe } from './switchStateHub.js'

const event = (kind: 'held' | 'released' | 'on' | 'off', switchId = 'bl', deviceId = 'a') => ({ deviceId, switchId, kind, at: 1 })

beforeEach(() => __resetForTests())

describe('switchStateHub (docs/23 §11.5)', () => {
  it('sends a change to every device of the band', () => {
    const one = vi.fn()
    const other = vi.fn()
    subscribe('band', one)
    subscribe('other-band', other)
    expect(broadcast('band', event('on'))).toBe(1)
    expect(one).toHaveBeenCalledWith(event('on'))
    expect(other).not.toHaveBeenCalled()
  })

  it('a device that connects later gets the last on/off and the current holders - not released or dropped-out ones', () => {
    broadcast('band', event('on', 'fx'), 0)
    broadcast('band', event('held', 'bl', 'a'), 0)
    broadcast('band', event('held', 'bl', 'b'), 0)
    broadcast('band', event('released', 'bl', 'b'), 0)
    broadcast('band', event('held', 'sm', 'c'), -HOLD_TIMEOUT_MS)
    const late = vi.fn()
    subscribe('band', late, 100)
    expect(late.mock.calls.map(([e]) => `${e.switchId}:${e.deviceId}:${e.kind}`)).toEqual(['fx:a:on', 'bl:a:held'])
  })
})
