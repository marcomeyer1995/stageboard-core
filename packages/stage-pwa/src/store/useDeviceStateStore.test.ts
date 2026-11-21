import { beforeEach, describe, expect, it } from 'vitest'
import { resolveBind } from '../lib/addonUi/bind'
import { useDeviceStateStore } from './useDeviceStateStore'

const event = (key: string, value: string | number | boolean, at: number, device = 'lights') => ({ device, key, value, at })
beforeEach(() => void useDeviceStateStore.getState().init(''))

describe('the live device state of the band (#964, docs/36 §5a)', () => {
  it('keeps the latest value per device and field, and a widget binds to it with state:<device>.<key>', () => {
    const { apply } = useDeviceStateStore.getState()
    apply(event('scene', 'a', 1))
    apply(event('level', 0.25, 2))
    apply(event('scene', 'b', 3))
    apply(event('scene', 'x', 3, 'video'))
    const { values } = useDeviceStateStore.getState()
    expect(values).toEqual({ lights: { scene: 'b', level: 0.25 }, video: { scene: 'x' } })
    expect(resolveBind('state:lights.scene', { jobs: {}, state: values })).toBe('b')
    expect(resolveBind('state:lights.level', { jobs: {}, state: values })).toBe(0.25)
  })

  it('an older message (a replay after a reconnect, a late arrival) never overwrites a newer value', () => {
    const { apply } = useDeviceStateStore.getState()
    apply(event('scene', 'new', 10))
    apply(event('scene', 'old', 5))
    expect(useDeviceStateStore.getState().values.lights?.scene).toBe('new')
  })

  it('a new band starts empty - nothing of the last band is drawn', () => {
    useDeviceStateStore.getState().apply(event('scene', 'a', 1))
    void useDeviceStateStore.getState().init('')
    expect(useDeviceStateStore.getState().values).toEqual({})
  })
})
