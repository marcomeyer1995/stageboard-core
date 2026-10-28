import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
const input = new EventTarget() as EventTarget & { id: string; name: string }
input.id = 'in-1'
input.name = 'FCB1010'
const access = Object.assign(new EventTarget(), { inputs: new Map([['in-1', input]]) })
vi.mock('./webMidiOutput', () => ({ getMidiAccess: async () => access }))
const presses = vi.hoisted(() => ({ pressTrigger: vi.fn(async () => null), releaseTrigger: vi.fn(() => null) }))
vi.mock('./triggerPress', () => presses)
vi.mock('./showMode', () => ({ useShowMode: () => ({ canControl: true }), useShowModeOnDemand: () => ({ canControl: true }) }))

const { getDeviceId } = await import('./deviceId')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useMidiControllerRulesStore } = await import('../store/useMidiControllerRulesStore')
const { useMidiControllers, midiLearn } = await import('./useMidiControllers')
const { claimedMidiInputs } = await import('./webMidi')

const next = { kind: 'momentary' as const, press: { kind: 'show' as const, op: 'next' as const }, release: { kind: 'none' as const } }
const send = (data: number[]) => act(() => void input.dispatchEvent(Object.assign(new Event('midimessage'), { data: new Uint8Array(data) })))
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.clearAllMocks()
  useLogicalDevicesStore.setState({ devices: [{ id: 'fcb', name: 'FCB', capability: 'midi-controller', pluginId: 'midi-controller', executionTarget: getDeviceId() }] })
  useDeviceTransportConfigStore.setState({ configs: [{ id: 'c', deviceId: getDeviceId(), logicalDeviceId: 'fcb', transportId: 'usb-midi', values: { midiInputId: 'gone', midiInputIdName: 'FCB1010' } }] })
  useMidiControllerRulesStore.setState({ docs: [{ id: 'fcb', rules: [{ id: 'r1', trigger: { message: 'note', channel: 1, number: 36 }, behavior: next }] }] })
})

describe('useMidiControllers (#547 step 2)', () => {
  it('a button of the controller plugged in here runs its rule - port found again by name after a replug', async () => {
    const { unmount } = renderHook(() => useMidiControllers())
    await flush()
    expect(claimedMidiInputs.has('in-1')).toBe(true)
    send([0x90, 36, 100])
    expect(presses.pressTrigger).toHaveBeenCalledWith('midi:fcb:r1', next, expect.anything())
    send([0x90, 36, 0])
    expect(presses.releaseTrigger).toHaveBeenCalledWith('midi:fcb:r1', next, expect.anything())
    send([0x90, 37, 100])
    expect(presses.pressTrigger).toHaveBeenCalledTimes(1)
    unmount()
    expect(claimedMidiInputs.has('in-1')).toBe(false)
  })

  it('while learning, a press goes to the dialog instead of running a rule', async () => {
    renderHook(() => useMidiControllers())
    await flush()
    const capture = vi.fn()
    midiLearn.capture = capture
    send([0x90, 36, 100])
    midiLearn.capture = null
    expect(capture).toHaveBeenCalledWith('fcb', expect.objectContaining({ message: 'note', number: 36 }))
    expect(presses.pressTrigger).not.toHaveBeenCalled()
  })

  it('a controller bound to another tablet is not listened to here', async () => {
    useLogicalDevicesStore.setState({ devices: [{ id: 'fcb', name: 'FCB', capability: 'midi-controller', pluginId: 'midi-controller', executionTarget: 'other-tablet' }] })
    renderHook(() => useMidiControllers())
    await flush()
    send([0x90, 36, 100])
    expect(presses.pressTrigger).not.toHaveBeenCalled()
  })
})
