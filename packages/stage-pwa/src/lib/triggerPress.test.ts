import { beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({ runAction: vi.fn(async () => null), scheduleRelease: vi.fn(() => () => {}) }))
vi.mock('./runAction', () => actions)
const store = vi.hoisted(() => {
  const state = { switches: [] as unknown[], states: {} as Record<string, string>, setState: (id: string, value: string) => void (state.states[id] = value) }
  return state
})
vi.mock('../store/useSwitchesStore', () => ({ useSwitchesStore: { getState: () => store } }))

const { applyRemoteSwitchEvent, expireRemoteHolders, HOLD_TIMEOUT_MS, pressTrigger, releaseTrigger, resetTriggerState, setSwitchPublisher } = await import('./triggerPress')

const on = { kind: 'playback' as const, op: 'tempo-up' as const }
const off = { kind: 'playback' as const, op: 'tempo-down' as const }
const show = {} as never
const toSwitch = (switchId: string) => ({ kind: 'switch' as const, switchId })
const published: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  resetTriggerState()
  published.length = 0
  setSwitchPublisher((switchId, kind) => void published.push(`${switchId}:${kind}`))
  store.states = {}
  store.switches = [
    { id: 'bl', name: 'Blinder', color: 'amber', behavior: { kind: 'momentary', press: on, release: { kind: 'on-release', action: off } } },
    { id: 'fx', name: 'Delay', color: 'accent', behavior: { kind: 'latching', on, off } },
  ]
})

describe('switches across tablets (docs/23 §11.5)', () => {
  it('held on another tablet: lit here; pressing and letting go here sends neither action - the last one there does', async () => {
    applyRemoteSwitchEvent('bl', 'fire', 'held')
    expect(store.states.bl).toBe('pressed')
    await pressTrigger('key:b', toSwitch('bl'), show)
    releaseTrigger('key:b', toSwitch('bl'), show)
    expect(actions.runAction).not.toHaveBeenCalled()
    expect(published).toEqual(['bl:held', 'bl:released'])
    applyRemoteSwitchEvent('bl', 'fire', 'released')
    expect(store.states.bl).toBe('off')
  })

  it('a tablet that goes silent while holding counts as released after 3 s; the device running the show sends the release', () => {
    applyRemoteSwitchEvent('bl', 'fire', 'held', 0)
    expireRemoteHolders(show, true, HOLD_TIMEOUT_MS - 1)
    expect(store.states.bl).toBe('pressed')
    expireRemoteHolders(show, true, HOLD_TIMEOUT_MS)
    expect(store.states.bl).toBe('off')
    expect(actions.runAction).toHaveBeenCalledWith(off, show)
  })

  it('...and every other device only stops showing it lit', () => {
    applyRemoteSwitchEvent('bl', 'fire', 'held', 0)
    expireRemoteHolders(show, false, HOLD_TIMEOUT_MS)
    expect(store.states.bl).toBe('off')
    expect(actions.runAction).not.toHaveBeenCalled()
  })

  it('a rastend switch turned on elsewhere: the next press here turns it off, and tells the others', async () => {
    applyRemoteSwitchEvent('fx', 'fire', 'on')
    expect(store.states.fx).toBe('on')
    await pressTrigger('widget:1', toSwitch('fx'), show)
    expect(actions.runAction).toHaveBeenCalledWith(off, show)
    expect(published).toEqual(['fx:off'])
    expect(store.states.fx).toBe('off')
  })
})
