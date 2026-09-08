import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVER_EXECUTION_TARGET, type DetectedHardware, type LogicalDevice, type PluginInstallation } from 'shared-types'
import type { CouchConfig } from './couch.js'

const allDocs = vi.hoisted(() => vi.fn())
vi.mock('./couch.js', () => ({ allDocs }))

const { __resetDiscoverySessionStoreForTests, assign, getPlugin, getSnapshot, reportCandidate, reportTriggered, start, stop } = await import(
  './discoverySessionStore.js'
)

// Matches discoverySessionStore.ts's own CANDIDATE_SETTLE_MS (not exported - tests only need to
// know it's finite and advance past it).
const SETTLE_MS = 2001

const COUCH: CouchConfig = { url: 'http://couch.local', user: 'admin', password: 'x' }

const GENERIC_MIDI: PluginInstallation = {
  id: 'generic-webmidi',
  name: 'Generic WebMIDI Input',
  version: '0.0.1',
  runtime: 'client',
  capabilities: ['midi-input'],
  transports: [],
  hardwareIds: [{ kind: 'webmidi' }],
  enabled: true,
  installedAt: 0,
}

const KEMPER: PluginInstallation = {
  id: 'kemper-profiler',
  name: 'Kemper Profiler',
  version: '0.0.1',
  runtime: 'client',
  capabilities: ['kemper-control'],
  transports: [],
  hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
  discoveryTrigger: {
    instruction: 'Tuner an- und ausschalten.',
    matchCcSequence: [
      { cc: 31, value: 127 },
      { cc: 31, value: 0 },
    ],
    timeoutMs: 15000,
  },
  enabled: true,
  installedAt: 0,
}

const MARCOS_KEMPER: LogicalDevice = {
  id: 'marcos-kemper',
  name: "Marco's Kemper",
  capability: 'kemper-control',
  pluginId: null,
  executionTarget: null,
}
const SARAHS_KEMPER: LogicalDevice = {
  id: 'sarahs-kemper',
  name: "Sarah's Kemper",
  capability: 'kemper-control',
  pluginId: null,
  executionTarget: null,
}

function kemperPort(portId: string, name = 'Kemper Profiler Emulator'): DetectedHardware {
  return { kind: 'webmidi', portId, name, manufacturer: '' }
}

async function startWith(plugins: PluginInstallation[], logicalDevices: LogicalDevice[]): Promise<void> {
  allDocs.mockImplementation((_couch: CouchConfig, _db: string, opts: { startkey: string }) =>
    Promise.resolve(opts.startkey.startsWith('plugins:') ? plugins : logicalDevices),
  )
  await start(COUCH, 'band-a', 'marco')
}

beforeEach(() => {
  __resetDiscoverySessionStoreForTests()
  allDocs.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getSnapshot', () => {
  it('is inactive for a workspace nothing has started', () => {
    expect(getSnapshot('band-a')).toEqual({ active: false, startedAt: null, startedBy: null, candidates: [], identifying: null })
  })
})

describe('start / stop', () => {
  it('marks the session active and reads the workspace snapshot once', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    const snapshot = getSnapshot('band-a')
    expect(snapshot.active).toBe(true)
    expect(snapshot.startedBy).toBe('marco')
    expect(allDocs).toHaveBeenCalledTimes(2) // plugins + logical devices
  })

  it('publishes candidates immediately, ahead of the settle window resolving anything', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    expect(getSnapshot('band-a').candidates).toHaveLength(1)
    expect(getSnapshot('band-a').candidates[0].status).toBe('unassigned')
  })

  it('stop() deactivates without clearing what was already resolved', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    vi.advanceTimersByTime(SETTLE_MS)
    stop('band-a')
    const snapshot = getSnapshot('band-a')
    expect(snapshot.active).toBe(false)
    expect(snapshot.candidates).toHaveLength(1)
  })

  it('ignores candidate/trigger reports once stopped', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    stop('band-a')
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    expect(getSnapshot('band-a').candidates).toHaveLength(0)
  })
})

describe('reportCandidate - unambiguous auto-assign (after the settle window)', () => {
  it('auto-assigns a specific (namePattern) match when it is the sole candidate for the only open role of that capability', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    vi.advanceTimersByTime(SETTLE_MS)

    const [candidate] = getSnapshot('band-a').candidates
    expect(candidate.status).toBe('assigned')
    expect(candidate.assignedLogicalDeviceId).toBe('marcos-kemper')
    expect(candidate.matchedPluginId).toBe('kemper-profiler')
  })

  it('does NOT auto-assign a generic catch-all match, even as the sole candidate', async () => {
    await startWith([GENERIC_MIDI], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1', 'Some Random Controller'))
    vi.advanceTimersByTime(SETTLE_MS)

    const [candidate] = getSnapshot('band-a').candidates
    expect(candidate.status).not.toBe('assigned')
  })

  it('does not resolve before the settle window has elapsed, even for a sole candidate', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    vi.advanceTimersByTime(1000) // well short of the ~2s settle window

    expect(getSnapshot('band-a').candidates[0].status).toBe('unassigned')
  })

  it('auto-assigns a server-reported (SERVER_EXECUTION_TARGET) candidate exactly like a tablet-reported one', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', SERVER_EXECUTION_TARGET, kemperPort('native-port-1'))
    vi.advanceTimersByTime(SETTLE_MS)

    const [candidate] = getSnapshot('band-a').candidates
    expect(candidate.status).toBe('assigned')
    expect(candidate.reporterId).toBe(SERVER_EXECUTION_TARGET)
    // Writing the actual DeviceTransportConfig is midiWatcher.ts's job (it reacts to seeing
    // itself win) - this store only does status/assignment bookkeeping, same as for a tablet.
  })
})

describe('getPlugin', () => {
  it('returns the plugin by id from the workspace snapshot start() captured', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    expect(getPlugin('band-a', 'kemper-profiler')).toEqual(KEMPER)
  })

  it('is null for an unknown plugin id or workspace', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    expect(getPlugin('band-a', 'nope')).toBeNull()
    expect(getPlugin('band-b', 'kemper-profiler')).toBeNull()
  })
})

describe('ambiguous roles - sequential trigger-based identification', () => {
  it('puts the role into "identifying" once the settle window elapses with more than one open candidate', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)

    const snapshot = getSnapshot('band-a')
    expect(snapshot.identifying).toMatchObject({
      logicalDeviceId: 'marcos-kemper',
      pluginId: 'kemper-profiler',
      instruction: 'Tuner an- und ausschalten.',
    })
    expect(snapshot.candidates.every((c) => c.status === 'identifying')).toBe(true)
  })

  it('assigns the role to whichever candidate triggers first, and frees the other one', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)

    reportTriggered('band-a', 'tablet-2', 'webmidi:port-2')

    const snapshot = getSnapshot('band-a')
    expect(snapshot.identifying).toBeNull()
    const winner = snapshot.candidates.find((c) => c.reporterId === 'tablet-2')!
    const loser = snapshot.candidates.find((c) => c.reporterId === 'tablet-1')!
    expect(winner.status).toBe('assigned')
    expect(winner.assignedLogicalDeviceId).toBe('marcos-kemper')
    expect(loser.status).toBe('unassigned')
  })

  it('moves on to the next open role once one is resolved (two Kempers, two roles)', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER, SARAHS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)

    reportTriggered('band-a', 'tablet-2', 'webmidi:port-2') // claims marcos-kemper (first role)

    const snapshot = getSnapshot('band-a')
    expect(snapshot.identifying).toMatchObject({ logicalDeviceId: 'sarahs-kemper' })
    const remaining = snapshot.candidates.find((c) => c.reporterId === 'tablet-1')!
    expect(remaining.status).toBe('identifying')
  })

  it('treats a single candidate as ambiguous when more than one open role shares its capability (one Kemper, two Kemper roles)', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER, SARAHS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    vi.advanceTimersByTime(SETTLE_MS)

    // Not auto-assigned to whichever role happens to come first in the list - only one Kemper
    // has shown up so far, but there are two open Kemper-capability roles it could belong to, so
    // this must go through the same trigger-based flow as a genuinely multi-candidate role.
    const snapshot = getSnapshot('band-a')
    expect(snapshot.candidates[0].status).toBe('identifying')
    expect(snapshot.identifying).toMatchObject({ logicalDeviceId: 'marcos-kemper' })
  })

  it('ignores a triggered report for a candidate that is not currently in the identifying set', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)

    reportTriggered('band-a', 'tablet-3', 'webmidi:port-3') // unrelated port, never reported as a candidate

    expect(getSnapshot('band-a').identifying).not.toBeNull()
  })

  it('flags an ambiguous role needs-manual outright when the matched plugin declares no discoveryTrigger', async () => {
    const midiInputRole: LogicalDevice = {
      id: 'footswitch',
      name: 'Footswitch',
      capability: 'midi-input',
      pluginId: null,
      executionTarget: null,
    }
    await startWith([GENERIC_MIDI], [midiInputRole])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1', 'Controller A'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2', 'Controller B'))
    vi.advanceTimersByTime(SETTLE_MS)

    const snapshot = getSnapshot('band-a')
    expect(snapshot.identifying).toBeNull()
    expect(snapshot.candidates.every((c) => c.status === 'needs-manual')).toBe(true)
  })

  it('flags remaining identifying candidates needs-manual once the trigger window times out', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)
    vi.advanceTimersByTime(15_001) // KEMPER.discoveryTrigger.timeoutMs

    const snapshot = getSnapshot('band-a')
    expect(snapshot.identifying).toBeNull()
    expect(snapshot.candidates.every((c) => c.status === 'needs-manual')).toBe(true)
  })
})

// No discoveryTrigger declared - mirrors the real NUX MG-30 plugin (pluginCatalog.ts): its own
// identity check is a SysEx handshake, not a CC sequence, so it can never reach "identifying" on
// its own and needs assign()'s manual-click path whenever more than one role/candidate is live.
const MG30: PluginInstallation = {
  id: 'nux-mg30',
  name: 'NUX MG-30',
  version: '0.0.1',
  runtime: 'client',
  capabilities: ['mg30-control'],
  transports: [],
  hardwareIds: [{ kind: 'webmidi', namePattern: 'MG-30' }],
  enabled: true,
  installedAt: 0,
}

const MARCOS_MG30: LogicalDevice = {
  id: 'marcos-mg30',
  name: "Marco's MG-30",
  capability: 'mg30-control',
  pluginId: null,
  executionTarget: null,
}

function mg30Port(portId: string): DetectedHardware {
  return { kind: 'webmidi', portId, name: 'MG-30', manufacturer: '' }
}

describe('assign - a human directly confirming a candidate for a role', () => {
  it('resolves a needs-manual candidate (no discoveryTrigger, so it could never self-resolve)', async () => {
    await startWith([MG30], [MARCOS_MG30])
    reportCandidate('band-a', 'tablet-1', mg30Port('port-1'))
    reportCandidate('band-a', 'tablet-2', mg30Port('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(getSnapshot('band-a').candidates.every((c) => c.status === 'needs-manual')).toBe(true) // sanity: genuinely stuck beforehand

    assign('band-a', 'tablet-1', 'webmidi:port-1', 'marcos-mg30')

    const snapshot = getSnapshot('band-a')
    const chosen = snapshot.candidates.find((c) => c.reporterId === 'tablet-1')!
    expect(chosen.status).toBe('assigned')
    expect(chosen.assignedLogicalDeviceId).toBe('marcos-mg30')
    // The other candidate for the same now-closed role is left untouched (still needs-manual,
    // not silently freed) - unlike the trigger-based flow, there was no live "contender" queue
    // waiting on this specific role, so nothing else needs to be reset here.
    const other = snapshot.candidates.find((c) => c.reporterId === 'tablet-2')!
    expect(other.status).toBe('needs-manual')
  })

  it('resolves the currently-identifying role and frees the losing contender, exactly like a physical trigger would', async () => {
    await startWith([KEMPER], [MARCOS_KEMPER])
    reportCandidate('band-a', 'tablet-1', kemperPort('port-1'))
    reportCandidate('band-a', 'tablet-2', kemperPort('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)
    expect(getSnapshot('band-a').identifying).not.toBeNull() // sanity: mid trigger-flow

    assign('band-a', 'tablet-1', 'webmidi:port-1', 'marcos-kemper')

    const snapshot = getSnapshot('band-a')
    expect(snapshot.identifying).toBeNull()
    const winner = snapshot.candidates.find((c) => c.reporterId === 'tablet-1')!
    const loser = snapshot.candidates.find((c) => c.reporterId === 'tablet-2')!
    expect(winner.status).toBe('assigned')
    expect(winner.assignedLogicalDeviceId).toBe('marcos-kemper')
    expect(loser.status).toBe('unassigned')
  })

  it('is a no-op once the target role is already taken (stale click)', async () => {
    await startWith([MG30], [MARCOS_MG30])
    reportCandidate('band-a', 'tablet-1', mg30Port('port-1'))
    reportCandidate('band-a', 'tablet-2', mg30Port('port-2'))
    vi.advanceTimersByTime(SETTLE_MS)
    assign('band-a', 'tablet-1', 'webmidi:port-1', 'marcos-mg30')

    assign('band-a', 'tablet-2', 'webmidi:port-2', 'marcos-mg30')

    const stillTablet2 = getSnapshot('band-a').candidates.find((c) => c.reporterId === 'tablet-2')!
    expect(stillTablet2.status).toBe('needs-manual')
    expect(stillTablet2.assignedLogicalDeviceId).toBeNull()
  })

  it('is a no-op for a candidate that was never reported', async () => {
    await startWith([MG30], [MARCOS_MG30])
    assign('band-a', 'tablet-1', 'webmidi:port-1', 'marcos-mg30')
    expect(getSnapshot('band-a').candidates).toHaveLength(0)
  })

  it('is a no-op once the session has stopped', async () => {
    await startWith([MG30], [MARCOS_MG30])
    reportCandidate('band-a', 'tablet-1', mg30Port('port-1'))
    reportCandidate('band-a', 'tablet-2', mg30Port('port-2')) // keeps it ambiguous - needs-manual, not auto-assigned
    vi.advanceTimersByTime(SETTLE_MS)
    stop('band-a')

    assign('band-a', 'tablet-1', 'webmidi:port-1', 'marcos-mg30')

    expect(getSnapshot('band-a').candidates.find((c) => c.reporterId === 'tablet-1')!.status).toBe('needs-manual')
  })
})
