import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogicalDevice, PluginInstallation, ShowCue } from 'shared-types'

const localMixerApplyEvent = vi.fn()
vi.mock('../store/useLocalMixerStore', () => ({
  useLocalMixerStore: { getState: () => ({ applyEvent: localMixerApplyEvent }) },
}))
vi.mock('../store/useLocalLightingStore', () => ({
  useLocalLightingStore: { getState: () => ({ applyEvent: vi.fn() }) },
}))

const triggerShowControl = vi.hoisted(() => vi.fn())
vi.mock('./showControlClient', () => ({ triggerShowControl }))

// cueFiring.ts -> clientTranslator.ts now also registers kemperTranslator.ts, which
// transitively imports workspaceDb.ts - constructs a real PouchDB at module load time,
// unavailable under happy-dom (see SystemView.test.tsx/workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { fireCue } = await import('./cueFiring')

// 'mixer', not 'midi-input': clientTranslator.ts's static Translator registry (#98) only
// backs mixer/lighting today, so these are the two capabilities where 'local-mine' is actually
// reachable - the two-Kempers-style naming is illustrative, the capability is what the routing
// logic actually keys off.
function mixerDevice(overrides: Partial<LogicalDevice> & Pick<LogicalDevice, 'id' | 'name'>): LogicalDevice {
  return { capability: 'mixer', pluginId: null, executionTarget: null, ...overrides }
}

function plugin(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    runtime: 'both',
    capabilities: ['mixer'],
    transports: [],
    hardwareIds: [],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

function cue(overrides: Partial<ShowCue> & Pick<ShowCue, 'targetLogicalDeviceId'>): ShowCue {
  return { id: 'cue-1', timeMs: 1000, type: 'set_volume', ...overrides }
}

describe('fireCue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when the target Logical Device no longer exists', async () => {
    const mixer1 = mixerDevice({ id: 'mixer-1', name: "Guitarist 1's Rig" })
    await fireCue(cue({ targetLogicalDeviceId: 'gone' }), {
      deviceId: 'me',
      logicalDevices: [mixer1],
      installed: [],
    })
    expect(triggerShowControl).not.toHaveBeenCalled()
  })

  it('forwards to the Stage-Server plugin when unbound and a plugin is reachable', async () => {
    const mixer1 = mixerDevice({ id: 'mixer-1', name: "Guitarist 1's Rig" })
    await fireCue(cue({ targetLogicalDeviceId: mixer1.id, payload: { channel: 'Band', volume: 80 } }), {
      deviceId: 'me',
      logicalDevices: [mixer1],
      installed: [plugin()],
    })
    expect(triggerShowControl).toHaveBeenCalledWith('mock-mixer', {
      type: 'set_volume',
      payload: { channel: 'Band', volume: 80 },
    })
  })

  it('#102: two Logical Devices sharing a capability each resolve their own independent binding', async () => {
    const mixer1 = mixerDevice({ id: 'mixer-1', name: "Guitarist 1's Rig", executionTarget: 'me' })
    const mixer2 = mixerDevice({ id: 'mixer-2', name: "Guitarist 2's Rig", executionTarget: 'someone-else' })
    const ctx = { deviceId: 'me', logicalDevices: [mixer1, mixer2], installed: [plugin()] }

    await fireCue(cue({ id: 'cue-for-1', targetLogicalDeviceId: mixer1.id }), ctx)
    expect(localMixerApplyEvent).toHaveBeenCalledTimes(1) // bound to this device - fires locally
    expect(triggerShowControl).not.toHaveBeenCalled()

    await fireCue(cue({ id: 'cue-for-2', targetLogicalDeviceId: mixer2.id }), ctx)
    // Bound to a different device ('local-other') - this device does nothing at all, no relay
    // call: the other tablet's own scheduler instance handles it independently (docs/00 §6).
    expect(localMixerApplyEvent).toHaveBeenCalledTimes(1)
    expect(triggerShowControl).not.toHaveBeenCalled()
  })

  it('does nothing when the binding points at this tablet but nothing can execute it locally', async () => {
    const mixer1 = mixerDevice({ id: 'mixer-1', name: "Guitarist 1's Rig", executionTarget: 'me' })
    await fireCue(cue({ targetLogicalDeviceId: mixer1.id }), {
      deviceId: 'me',
      logicalDevices: [mixer1],
      installed: [], // no client-runtime plugin installed for mixer
    })
    expect(localMixerApplyEvent).not.toHaveBeenCalled()
    expect(triggerShowControl).not.toHaveBeenCalled()
  })

  it('an explicitly pinned pluginId wins over auto-resolution', async () => {
    const mixer1 = mixerDevice({
      id: 'mixer-1',
      name: "Guitarist 1's Rig",
      executionTarget: 'server',
      pluginId: 'specific-plugin',
    })
    await fireCue(cue({ targetLogicalDeviceId: mixer1.id }), {
      deviceId: 'me',
      logicalDevices: [mixer1],
      installed: [plugin({ id: 'specific-plugin' }), plugin({ id: 'other-plugin' })],
    })
    expect(triggerShowControl).toHaveBeenCalledWith('specific-plugin', expect.anything())
  })
})
