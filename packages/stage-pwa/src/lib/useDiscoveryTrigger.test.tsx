import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const reportDiscoveryTriggered = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./discoveryClient', () => ({ reportDiscoveryTriggered }))

const { getDeviceId } = await import('./deviceId')
const { useDiscoveryTrigger } = await import('./useDiscoveryTrigger')
const { useDiscoverySessionStore } = await import('../store/useDiscoverySessionStore')

function Detector() {
  useDiscoveryTrigger()
  return null
}

class FakeInput {
  listeners: ((event: { data: Uint8Array }) => void)[] = []
  constructor(
    public id: string,
    public name: string,
  ) {}
  manufacturer = ''
  addEventListener(_type: 'midimessage', handler: (event: { data: Uint8Array }) => void) {
    this.listeners.push(handler)
  }
  removeEventListener(_type: 'midimessage', handler: (event: { data: Uint8Array }) => void) {
    this.listeners = this.listeners.filter((l) => l !== handler)
  }
  fire(bytes: number[]) {
    this.listeners.forEach((l) => l({ data: new Uint8Array(bytes) }))
  }
}

const IDENTIFYING = {
  logicalDeviceId: 'marcos-kemper',
  logicalDeviceName: "Marco's Kemper",
  pluginId: 'kemper-profiler',
  instruction: 'Tuner an/aus',
  matchCcSequence: [
    { cc: 31, value: 127 },
    { cc: 31, value: 0 },
  ],
  deadline: Date.now() + 15000,
}

beforeEach(() => {
  useDiscoverySessionStore.setState({
    workspaceId: 'band-a',
    session: { active: false, startedAt: null, startedBy: null, candidates: [], identifying: null },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useDiscoveryTrigger', () => {
  it('does nothing when no role is identifying', async () => {
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn() })
    render(<Detector />)
    await Promise.resolve()
    expect(reportDiscoveryTriggered).not.toHaveBeenCalled()
  })

  it('does nothing when identifying but this tablet has no matching candidate of its own', async () => {
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn() })
    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: { active: true, startedAt: 1, startedBy: 'marco', identifying: IDENTIFYING, candidates: [] },
    })
    render(<Detector />)
    await Promise.resolve()
    expect(reportDiscoveryTriggered).not.toHaveBeenCalled()
  })

  it('listens on the matching input and reports triggered once the full sequence arrives', async () => {
    const fakeInput = new FakeInput('port-1', 'Kemper Profiler Emulator')
    const inputs = new Map([['port-1', fakeInput]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs }) })

    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: {
        active: true,
        startedAt: 1,
        startedBy: 'marco',
        identifying: IDENTIFYING,
        candidates: [
          {
            reporterId: getDeviceId(),
            hardwareKey: 'webmidi:port-1',
            name: 'Kemper Profiler Emulator',
            manufacturer: '',
            matchedPluginId: 'kemper-profiler',
            status: 'identifying',
            assignedLogicalDeviceId: null,
          },
        ],
      },
    })

    render(<Detector />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(fakeInput.listeners).toHaveLength(1)

    fakeInput.fire([0xb0, 31, 127])
    expect(reportDiscoveryTriggered).not.toHaveBeenCalled()
    fakeInput.fire([0xb0, 31, 0])

    expect(reportDiscoveryTriggered).toHaveBeenCalledWith('band-a', getDeviceId(), 'webmidi:port-1')
  })

  it('ignores a candidate belonging to a different reporter (another tablet)', async () => {
    const fakeInput = new FakeInput('port-1', 'Kemper Profiler Emulator')
    const inputs = new Map([['port-1', fakeInput]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs }) })

    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: {
        active: true,
        startedAt: 1,
        startedBy: 'marco',
        identifying: IDENTIFYING,
        candidates: [
          {
            reporterId: 'some-other-tablet',
            hardwareKey: 'webmidi:port-1',
            name: 'Kemper Profiler Emulator',
            manufacturer: '',
            matchedPluginId: 'kemper-profiler',
            status: 'identifying',
            assignedLogicalDeviceId: null,
          },
        ],
      },
    })

    render(<Detector />)
    await Promise.resolve()
    await Promise.resolve()

    expect(fakeInput.listeners).toHaveLength(0)
  })

  it('stops listening once the role is no longer identifying', async () => {
    const fakeInput = new FakeInput('port-1', 'Kemper Profiler Emulator')
    const inputs = new Map([['port-1', fakeInput]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs }) })

    const candidate = {
      reporterId: getDeviceId(),
      hardwareKey: 'webmidi:port-1',
      name: 'Kemper Profiler Emulator',
      manufacturer: '',
      matchedPluginId: 'kemper-profiler',
      status: 'identifying' as const,
      assignedLogicalDeviceId: null,
    }
    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: { active: true, startedAt: 1, startedBy: 'marco', identifying: IDENTIFYING, candidates: [candidate] },
    })

    render(<Detector />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(fakeInput.listeners).toHaveLength(1)

    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: { active: true, startedAt: 1, startedBy: 'marco', identifying: null, candidates: [{ ...candidate, status: 'assigned' }] },
    })
    await Promise.resolve()

    expect(fakeInput.listeners).toHaveLength(0)
  })
})
