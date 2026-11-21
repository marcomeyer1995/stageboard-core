import { beforeEach, describe, expect, it } from 'vitest'
import type { DeviceStateEvent, StateField } from 'shared-types'
import { __resetForTests, publish, snapshot, subscribe } from './deviceStateHub.js'

const declared: Record<string, StateField> = { scene: { type: 'enum', values: ['a', 'b'] }, level: { type: 'number', min: 0, max: 1 } }
const event = (key: string, value: DeviceStateEvent['value'], device = 'lights'): DeviceStateEvent => ({ device, key, value, at: 1 })
beforeEach(__resetForTests)

describe('the device state of a band (#964, docs/36 §5a)', () => {
  it('shares a value with every follower of the band at once - and with nobody of another band', () => {
    const a: DeviceStateEvent[] = []
    const b: DeviceStateEvent[] = []
    const other: DeviceStateEvent[] = []
    subscribe('band', (e) => a.push(e))
    subscribe('band', (e) => b.push(e))
    subscribe('other', (e) => other.push(e))
    expect(publish('band', event('scene', 'a'), declared)).toEqual({ ok: true, devices: 2 })
    expect(a).toEqual([event('scene', 'a')])
    expect(b).toEqual(a)
    expect(other).toEqual([])
  })

  it('a device that connects later is told the latest value of every field - one per field, the newest', () => {
    publish('band', event('scene', 'a'), declared)
    publish('band', event('level', 0.2), declared)
    publish('band', event('scene', 'b'), declared)
    publish('band', event('scene', 'a', 'video'), declared)
    const told: DeviceStateEvent[] = []
    subscribe('band', (e) => told.push(e))
    expect(told).toHaveLength(3)
    expect(told).toEqual(expect.arrayContaining([event('scene', 'b'), event('level', 0.2), event('scene', 'a', 'video')]))
    expect(snapshot('band')).toHaveLength(3)
  })

  it('refuses what the add-on did not declare or what does not fit - nothing reaches the band, nothing is remembered', () => {
    const heard: DeviceStateEvent[] = []
    subscribe('band', (e) => heard.push(e))
    for (const [e, why] of [
      [event('colour', 'red'), 'an undeclared field'], [event('constructor', 'x'), 'an inherited name'], [event('__proto__', 'x'), 'a prototype key'],
      [event('scene', 'c'), 'a value outside the enum'], [event('level', 1.5), 'a number above its range'], [event('level', Number.NaN), 'NaN'], [event('level', '0.5' as never), 'a string for a number'],
    ] as const) {
      expect(publish('band', e, declared), why).toMatchObject({ ok: false, reason: expect.any(String) })
    }
    expect(heard).toEqual([])
    expect(snapshot('band')).toEqual([])
  })

  it('stops sending to a follower that left, and bounds how many fields one band can fill', () => {
    const heard: DeviceStateEvent[] = []
    const stop = subscribe('band', (e) => heard.push(e))
    stop()
    expect(publish('band', event('scene', 'a'), declared)).toEqual({ ok: true, devices: 0 })
    expect(heard).toEqual([])
    const wide: Record<string, StateField> = { v: { type: 'number' } }
    let refused = 0
    for (let i = 0; i < 600; i++) if (!publish('flood', { device: `d${i}`, key: 'v', value: i, at: 1 }, wide).ok) refused++
    expect(refused).toBe(100)
    expect(snapshot('flood')).toHaveLength(500)
  })
})
