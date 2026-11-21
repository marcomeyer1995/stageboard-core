import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallation } from 'shared-types'
import type { ViewWorkerFactory } from '../lib/addonUi/slotHost'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { DevicePanelSlots } = await import('./DevicePanelSlots')
const { useDeviceStateStore } = await import('../store/useDeviceStateStore')
const { usePluginsStore } = await import('../store/usePluginsStore')

/** The add-on's real view script runs in-process behind the Worker's message interface. */
const inProcess: ViewWorkerFactory = (code) => {
  const worker = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null, terminate: () => {}, postMessage: (m: unknown) => void queueMicrotask(() => scope.onmessage?.({ data: m })) }
  const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => void queueMicrotask(() => worker.onmessage?.({ data: m })) }
  new Function('self', code)(scope)
  return worker
}
const osc = { id: 'osc', name: 'OSC', version: '0.1.0', enabled: true, runtime: 'host', installedAt: 0, capabilities: ['osc'], transports: [], hardwareIds: [] } as unknown as PluginInstallation

beforeEach(() => {
  usePluginsStore.setState({ installed: [] })
  void useDeviceStateStore.getState().init('')
})

describe('the device panel of an add-on (#964, docs/36 §5a, §6)', () => {
  it('shows nothing for a device when no installed add-on offers a panel', () => {
    const { container } = render(<DevicePanelSlots logicalDeviceId="lights" pluginId="osc" createWorker={inProcess} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the OSC add-on\'s panel from its description and follows the device\'s live state without asking the add-on again', async () => {
    usePluginsStore.setState({ installed: [osc] })
    render(<DevicePanelSlots logicalDeviceId="lights" pluginId="osc" createWorker={inProcess} />)
    expect(await screen.findByText('Zuletzt gesendet')).toBeInTheDocument()
    // Bound to state:lights.lastCue - nothing published yet, then the host says a cue went out, then a newer one.
    act(() => useDeviceStateStore.getState().apply({ device: 'lights', key: 'lastCue', value: '/cue/12/go 1', at: 1 }))
    expect(await screen.findByText('/cue/12/go 1')).toBeInTheDocument()
    act(() => useDeviceStateStore.getState().apply({ device: 'lights', key: 'lastCue', value: '/blackout', at: 2 }))
    expect(await screen.findByText('/blackout')).toBeInTheDocument()
    expect(screen.queryByText('/cue/12/go 1')).toBeNull()
  })

  it('shows only the state of ITS device - another device\'s cue never appears in this panel', async () => {
    usePluginsStore.setState({ installed: [osc] })
    render(<DevicePanelSlots logicalDeviceId="lights" pluginId="osc" createWorker={inProcess} />)
    await screen.findByText('Zuletzt gesendet')
    act(() => useDeviceStateStore.getState().apply({ device: 'video', key: 'lastCue', value: '/video/play', at: 1 }))
    await act(async () => undefined)
    expect(screen.queryByText('/video/play')).toBeNull()
  })

  it('shows only the panel of the add-on the device belongs to - a device of another add-on, or of none, gets none', () => {
    usePluginsStore.setState({ installed: [osc] })
    for (const pluginId of ['kemper-profiler', null]) {
      const { container, unmount } = render(<DevicePanelSlots logicalDeviceId="lights" pluginId={pluginId} createWorker={inProcess} />)
      expect(container, String(pluginId)).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('a disabled add-on offers no panel', () => {
    usePluginsStore.setState({ installed: [{ ...osc, enabled: false }] })
    const { container } = render(<DevicePanelSlots logicalDeviceId="lights" pluginId="osc" createWorker={inProcess} />)
    expect(container).toBeEmptyDOMElement()
  })
})
