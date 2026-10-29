import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async allDocs() {
      return { rows: [] }
    }
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
vi.mock('./stageServer', () => ({ getStageServerUrl: () => 'https://stage.test' }))
vi.mock('./triggerPress', () => ({ pressTrigger: vi.fn(async () => null), releaseTrigger: vi.fn(async () => null) }))
vi.mock('./runAction', () => ({ latestTrackedShow: () => ({ show: true }) }))

const { useOscInput, oscLearn } = await import('./useOscInput')
const { pressTrigger, releaseTrigger } = await import('./triggerPress')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useOscInputRulesStore } = await import('../store/useOscInputRulesStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')

class FakeEventSource {
  static open: FakeEventSource[] = []
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeEventSource.open.push(this)
  }
  close() {
    this.closed = true
  }
  emit(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

function Host() {
  useOscInput()
  return null
}

const live = () => FakeEventSource.open.filter((s) => !s.closed)
const behavior = { kind: 'momentary', press: { kind: 'show', op: 'play-pause' }, release: { kind: 'none' } }

beforeEach(() => {
  FakeEventSource.open = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.mocked(pressTrigger).mockClear()
  vi.mocked(releaseTrigger).mockClear()
  useWorkspaceStore.setState({ activeWorkspaceId: 'band' })
  useLogicalDevicesStore.setState({ devices: [{ id: 'touch', name: 'TouchOSC', capability: 'osc-input', pluginId: 'osc-input', executionTarget: 'server' }] } as never)
  useOscInputRulesStore.setState({ docs: [{ id: 'touch', rules: [{ id: 'r1', trigger: { address: '/1/push1' }, behavior } as never] }], learning: false })
  useShowStateStore.setState({ isMaster: true, deviceId: 'me', state: { ...useShowStateStore.getState().state, drivingDeviceId: 'me' } })
})
afterEach(() => vi.unstubAllGlobals())

describe('useOscInput (#484)', () => {
  it('the device driving the show listens and runs the rule - press and release', () => {
    render(<Host />)
    expect(live()).toHaveLength(1)
    expect(live()[0]!.url).toBe('https://stage.test/workspaces/band/osc-in/stream')
    live()[0]!.emit({ address: '/1/push1', args: [1], at: 1 })
    expect(pressTrigger).toHaveBeenCalledWith('osc:touch:r1', behavior, { show: true })
    live()[0]!.emit({ address: '/1/push1', args: [0], at: 2 })
    expect(releaseTrigger).toHaveBeenCalledWith('osc:touch:r1', behavior, { show: true })
    live()[0]!.emit({ address: '/unknown', args: [1], at: 3 })
    expect(pressTrigger).toHaveBeenCalledTimes(1)
  })

  it('other devices keep no stream open - unless they learn a button', () => {
    useShowStateStore.setState({ isMaster: false })
    render(<Host />)
    expect(live()).toHaveLength(0)
    const captured: string[] = []
    act(() => useOscInputRulesStore.getState().setLearning(true))
    oscLearn.capture = (message) => captured.push(message.address)
    live()[0]!.emit({ address: '/2/fader3', args: [0.7], at: 1 })
    expect(captured).toEqual(['/2/fader3'])
    expect(pressTrigger).not.toHaveBeenCalled()
    oscLearn.capture = null
    act(() => useOscInputRulesStore.getState().setLearning(false))
    expect(live()).toHaveLength(0)
  })

  it('no OSC-Eingang device: nothing listens', () => {
    useLogicalDevicesStore.setState({ devices: [] } as never)
    render(<Host />)
    expect(live()).toHaveLength(0)
  })
})
