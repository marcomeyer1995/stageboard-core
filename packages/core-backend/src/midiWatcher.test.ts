import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVER_EXECUTION_TARGET, type PluginInstallation } from 'shared-types'
import type { CouchConfig } from './couch.js'

let inputPorts: string[] = []
let outputPorts: string[] = []
const inputInstances: FakePort[] = []
const outputInstances: FakePort[] = []

class FakePort extends EventEmitter {
  openedIndex: number | null = null
  destroyed = false

  constructor(private readonly ports: () => string[]) {
    super()
  }

  getPortCount() {
    return this.ports().length
  }

  getPortName(i: number) {
    return this.ports()[i]
  }

  openPort(i: number) {
    this.openedIndex = i
  }

  closePort() {
    this.openedIndex = null
  }

  destroy() {
    this.destroyed = true
  }
}

class FakeInput extends FakePort {
  constructor() {
    super(() => inputPorts)
    inputInstances.push(this)
  }
}

class FakeOutput extends FakePort {
  constructor() {
    super(() => outputPorts)
    outputInstances.push(this)
  }
}

vi.mock('@julusian/midi', () => ({ Input: FakeInput, Output: FakeOutput }))

const reportCandidate = vi.hoisted(() => vi.fn())
const reportTriggered = vi.hoisted(() => vi.fn())
const getSnapshot = vi.hoisted(() => vi.fn())
const getPlugin = vi.hoisted(() => vi.fn())
const subscribe = vi.hoisted(() => vi.fn(() => vi.fn()))
vi.mock('./discoverySessionStore.js', () => ({ reportCandidate, reportTriggered, getSnapshot, getPlugin, subscribe }))

const putDoc = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./couch.js', () => ({ putDoc }))

const { createMidiWatcher } = await import('./midiWatcher.js')

const COUCH: CouchConfig = { url: 'http://couch.local', user: 'admin', password: 'x' }
const INACTIVE_SESSION = { active: false, startedAt: null, startedBy: null, candidates: [], identifying: null }

const KEMPER: PluginInstallation = {
  id: 'kemper-profiler',
  name: 'Kemper Profiler',
  version: '0.0.1',
  runtime: 'client',
  capabilities: ['kemper-control'],
  transports: [{ id: 'usb-midi', label: 'USB-MIDI', fields: [{ key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' }] }],
  hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
  enabled: true,
  installedAt: 0,
}

function logStub() {
  return { info: vi.fn(), error: vi.fn() }
}

function watch() {
  return createMidiWatcher({ couch: COUCH, workspaceId: 'band-a', log: logStub() })
}

/** The trigger-listening FakeInput is always the *last* one constructed once a role is
 * identifying (reportCurrentPorts's probes are transient, destroyed the same tick). */
function lastInput(): FakeInput {
  return inputInstances[inputInstances.length - 1]
}

beforeEach(() => {
  vi.useFakeTimers()
  inputInstances.length = 0
  outputInstances.length = 0
  inputPorts = ['Midi Through Port-0', 'Kemper Profiler Emulator']
  outputPorts = ['Midi Through Port-0', 'RtMidiIn Client:Kemper Profiler Emulator 128:0']
  reportCandidate.mockReset()
  reportTriggered.mockReset()
  getPlugin.mockReset().mockReturnValue(KEMPER)
  putDoc.mockReset().mockResolvedValue(undefined)
  getSnapshot.mockReset().mockReturnValue(INACTIVE_SESSION)
  subscribe.mockReset().mockReturnValue(vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createMidiWatcher', () => {
  it('reports every currently-visible native port immediately on start', () => {
    const watcher = watch()

    expect(reportCandidate).toHaveBeenCalledTimes(2)
    expect(reportCandidate).toHaveBeenCalledWith('band-a', SERVER_EXECUTION_TARGET, {
      kind: 'webmidi',
      portId: 'Midi Through Port-0',
      name: 'Midi Through Port-0',
      manufacturer: '',
    })
    expect(reportCandidate).toHaveBeenCalledWith('band-a', SERVER_EXECUTION_TARGET, {
      kind: 'webmidi',
      portId: 'Kemper Profiler Emulator',
      name: 'Kemper Profiler Emulator',
      manufacturer: '',
    })
    watcher.stop()
  })

  it('re-polls and re-reports on the configured interval', () => {
    const watcher = watch()
    reportCandidate.mockClear()

    vi.advanceTimersByTime(2000)

    expect(reportCandidate).toHaveBeenCalledTimes(2)
    watcher.stop()
  })

  it('stop() clears the poll interval - no further reports after stopping', () => {
    const watcher = watch()
    watcher.stop()
    reportCandidate.mockClear()

    vi.advanceTimersByTime(10_000)

    expect(reportCandidate).not.toHaveBeenCalled()
  })

  it('does not open any port for listening while nothing is identifying', () => {
    const watcher = watch()
    vi.advanceTimersByTime(2000)

    expect(inputInstances.every((i) => i.openedIndex === null)).toBe(true)
    watcher.stop()
  })

  describe('while a role is identifying and the Stage-Server itself is a contender', () => {
    const IDENTIFYING_SESSION = {
      active: true,
      startedAt: 1,
      startedBy: 'marco',
      identifying: {
        logicalDeviceId: 'marcos-kemper',
        logicalDeviceName: "Marco's Kemper",
        pluginId: 'kemper-profiler',
        instruction: 'Tuner an/aus',
        matchCcSequence: [
          { cc: 31, value: 127 },
          { cc: 31, value: 0 },
        ],
        deadline: Date.now() + 15000,
      },
      candidates: [
        {
          reporterId: SERVER_EXECUTION_TARGET,
          hardwareKey: 'webmidi:Kemper Profiler Emulator',
          name: 'Kemper Profiler Emulator',
          manufacturer: '',
          matchedPluginId: 'kemper-profiler',
          status: 'identifying' as const,
          assignedLogicalDeviceId: null,
        },
      ],
    }

    it('opens the matching native input port for listening', () => {
      getSnapshot.mockReturnValue(IDENTIFYING_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000) // the poll loop also calls syncTriggerListener

      const listener = lastInput()
      expect(listener.openedIndex).toBe(1) // "Kemper Profiler Emulator" is inputPorts[1]
      watcher.stop()
    })

    it('reports triggered once the full CC sequence arrives, in order', () => {
      getSnapshot.mockReturnValue(IDENTIFYING_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000)
      const listener = lastInput()

      listener.emit('message', 0, [0xb0, 31, 127])
      expect(reportTriggered).not.toHaveBeenCalled()
      listener.emit('message', 0, [0xb0, 31, 0])

      expect(reportTriggered).toHaveBeenCalledWith('band-a', SERVER_EXECUTION_TARGET, 'webmidi:Kemper Profiler Emulator')
      watcher.stop()
    })

    it('ignores an unrelated CC and does not report triggered on a partial sequence', () => {
      getSnapshot.mockReturnValue(IDENTIFYING_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000)
      const listener = lastInput()

      listener.emit('message', 0, [0xb0, 47, 12]) // some unrelated CC
      listener.emit('message', 0, [0xb0, 31, 127]) // step 1 of the sequence
      // no step 2 yet

      expect(reportTriggered).not.toHaveBeenCalled()
      watcher.stop()
    })

    it('closes the listening port once the role stops identifying', () => {
      getSnapshot.mockReturnValue(IDENTIFYING_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000)
      const listener = lastInput()
      expect(listener.openedIndex).toBe(1)

      getSnapshot.mockReturnValue(INACTIVE_SESSION)
      vi.advanceTimersByTime(2000)

      expect(listener.openedIndex).toBeNull()
      expect(listener.destroyed).toBe(true)
      watcher.stop()
    })
  })

  describe('when one of the Stage-Server\'s own candidates has just won a role', () => {
    const WON_SESSION = {
      active: true,
      startedAt: 1,
      startedBy: 'marco',
      identifying: null,
      candidates: [
        {
          reporterId: SERVER_EXECUTION_TARGET,
          hardwareKey: 'webmidi:Kemper Profiler Emulator', // the *input*-side port name
          name: 'Kemper Profiler Emulator',
          manufacturer: '',
          matchedPluginId: 'kemper-profiler',
          status: 'assigned' as const,
          assignedLogicalDeviceId: 'marcos-kemper',
        },
      ],
    }

    it('writes a DeviceTransportConfig doc using the real *output* port name, not the input-side hardwareKey', () => {
      getSnapshot.mockReturnValue(WON_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000)

      expect(putDoc).toHaveBeenCalledTimes(1)
      const [couchArg, db, doc] = putDoc.mock.calls[0]
      expect(couchArg).toBe(COUCH)
      expect(db).toBe('stageboard-band-a')
      expect(doc).toMatchObject({
        _id: 'device-transport-config:server:marcos-kemper',
        deviceId: SERVER_EXECUTION_TARGET,
        logicalDeviceId: 'marcos-kemper',
        // The real Output port ("RtMidiIn Client:..."), never the candidate's own hardwareKey
        // ("webmidi:Kemper Profiler Emulator", built from the *input* side).
        values: { midiOutputId: 'RtMidiIn Client:Kemper Profiler Emulator 128:0' },
      })
      watcher.stop()
    })

    it('writes each won role only once, even across many polls', () => {
      getSnapshot.mockReturnValue(WON_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000)
      vi.advanceTimersByTime(2000)
      vi.advanceTimersByTime(2000)

      expect(putDoc).toHaveBeenCalledTimes(1)
      watcher.stop()
    })

    it('does not write anything when no matching Output port exists yet', () => {
      outputPorts = ['Midi Through Port-0'] // no Kemper-named output
      getSnapshot.mockReturnValue(WON_SESSION)
      const watcher = watch()
      vi.advanceTimersByTime(2000)

      expect(putDoc).not.toHaveBeenCalled()
      watcher.stop()
    })
  })
})
