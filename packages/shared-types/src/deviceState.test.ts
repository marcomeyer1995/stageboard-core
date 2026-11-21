import { describe, expect, it } from 'vitest'
import { checkStateValue, DeviceStateEventSchema } from './deviceState.js'

describe('checkStateValue - what an add-on may publish into the band (#964, docs/36 §5a)', () => {
  it('checks the type of every kind of field', () => {
    expect(checkStateValue({ type: 'boolean' }, true)).toEqual({ ok: true })
    expect(checkStateValue({ type: 'boolean' }, 'true')).toMatchObject({ ok: false })
    expect(checkStateValue({ type: 'string' }, 'Szene 1')).toEqual({ ok: true })
    expect(checkStateValue({ type: 'string' }, 'x'.repeat(501))).toMatchObject({ ok: false })
    expect(checkStateValue({ type: 'string' }, 5)).toMatchObject({ ok: false })
  })

  it('a number is finite and inside its range - NaN, Infinity and a string that looks like a number are refused', () => {
    const level = { type: 'number' as const, min: 0, max: 1 }
    expect(checkStateValue(level, 0)).toEqual({ ok: true })
    expect(checkStateValue(level, 1)).toEqual({ ok: true })
    for (const bad of [-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY, '0.5', null, undefined]) expect(checkStateValue(level, bad), String(bad)).toMatchObject({ ok: false })
    expect(checkStateValue({ type: 'number' }, 1e9)).toEqual({ ok: true }) // unbounded when the add-on declares no bound
  })

  it('an enum accepts only its declared values - strings and numbers alike, nothing inherited from Object.prototype', () => {
    const scene = { type: 'enum' as const, values: ['a', 'b', 3] }
    expect(checkStateValue(scene, 'a')).toEqual({ ok: true })
    expect(checkStateValue(scene, 3)).toEqual({ ok: true })
    for (const bad of ['c', '3', 'constructor', '__proto__', true, null]) expect(checkStateValue(scene, bad), String(bad)).toMatchObject({ ok: false })
  })
})

describe('DeviceStateEventSchema', () => {
  it('accepts a plain value and refuses objects, arrays and an empty device or key - a value is a scalar', () => {
    const base = { device: 'lights', key: 'scene', at: 1 }
    expect(DeviceStateEventSchema.safeParse({ ...base, value: 'a' }).success).toBe(true)
    expect(DeviceStateEventSchema.safeParse({ ...base, value: 0.5 }).success).toBe(true)
    for (const bad of [{ ...base, value: { a: 1 } }, { ...base, value: [1] }, { ...base, device: '' }, { ...base, key: '' }, { ...base, value: 'x'.repeat(501) }, { ...base, at: -1, value: 1 }]) expect(DeviceStateEventSchema.safeParse(bad).success).toBe(false)
  })
})
