import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardwareSetup, LogicalDevice, PluginInstallation, ShowCue } from 'shared-types'

const localMixerApplyEvent = vi.fn()
vi.mock('../store/useLocalMixerStore', () => ({
  useLocalMixerStore: { getState: () => ({ applyEvent: localMixerApplyEvent }) },
}))
vi.mock('../store/useLocalLightingStore', () => ({
  useLocalLightingStore: { getState: () => ({ applyEvent: vi.fn() }) },
}))

const triggerShowControl = vi.hoisted(() => vi.fn())
vi.mock('./showControlClient', () => ({ triggerShowControl }))

const { fireCue } = await import('./cueFiring')

// 'mixer', not 'midi-input': clientTranslator.ts's static Translator registry (#98) only
// backs mixer/lighting today, so these are the two capabilities where 'local-mine' is actually
// reachable - the two-Kempers-style naming is illustrative, the capability is what the routing
// logic actually keys off.
const MIXER_1: LogicalDevice = { id: 'mixer-1', name: "Guitarist 1's Rig", capability: 'mixer' }
const MIXER_2: LogicalDevice = { id: 'mixer-2', name: "Guitarist 2's Rig", capability: 'mixer' }

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

function setup(bindings: HardwareSetup['bindings']): HardwareSetup {
  return { id: 'setup-1', name: 'Festival', bindings }
}

describe('fireCue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when the target Logical Device no longer exists', async () => {
    await fireCue(cue({ targetLogicalDeviceId: 'gone' }), {
      deviceId: 'me',
      hardwareSetup: null,
      logicalDevices: [MIXER_1],
      installed: [],
    })
    expect(triggerShowControl).not.toHaveBeenCalled()
  })

  it('forwards to the Stage-Server plugin when unbound and a plugin is reachable', async () => {
    await fireCue(cue({ targetLogicalDeviceId: MIXER_1.id, payload: { channel: 'Band', volume: 80 } }), {
      deviceId: 'me',
      hardwareSetup: null,
      logicalDevices: [MIXER_1],
      installed: [plugin()],
    })
    expect(triggerShowControl).toHaveBeenCalledWith('mock-mixer', {
      type: 'set_volume',
      payload: { channel: 'Band', volume: 80 },
    })
  })

  it('#102: two Logical Devices sharing a capability each resolve their own independent binding', async () => {
    const active = setup({
      [MIXER_1.id]: { executionTarget: 'me', pluginId: null },
      [MIXER_2.id]: { executionTarget: 'someone-else', pluginId: null },
    })
    const ctx = { deviceId: 'me', hardwareSetup: active, logicalDevices: [MIXER_1, MIXER_2], installed: [plugin()] }

    await fireCue(cue({ id: 'cue-for-1', targetLogicalDeviceId: MIXER_1.id }), ctx)
    expect(localMixerApplyEvent).toHaveBeenCalledTimes(1) // bound to this device - fires locally
    expect(triggerShowControl).not.toHaveBeenCalled()

    await fireCue(cue({ id: 'cue-for-2', targetLogicalDeviceId: MIXER_2.id }), ctx)
    // Bound to a different device ('local-other') - this device does nothing at all, no relay
    // call: the other tablet's own scheduler instance handles it independently (docs/00 §6).
    expect(localMixerApplyEvent).toHaveBeenCalledTimes(1)
    expect(triggerShowControl).not.toHaveBeenCalled()
  })

  it('does nothing when the binding points at this tablet but nothing can execute it locally', async () => {
    const active = setup({ [MIXER_1.id]: { executionTarget: 'me', pluginId: null } })
    await fireCue(cue({ targetLogicalDeviceId: MIXER_1.id }), {
      deviceId: 'me',
      hardwareSetup: active,
      logicalDevices: [MIXER_1],
      installed: [], // no client-runtime plugin installed for mixer
    })
    expect(localMixerApplyEvent).not.toHaveBeenCalled()
    expect(triggerShowControl).not.toHaveBeenCalled()
  })

  it('an explicitly pinned pluginId wins over auto-resolution', async () => {
    const active = setup({ [MIXER_1.id]: { executionTarget: 'server', pluginId: 'specific-plugin' } })
    await fireCue(cue({ targetLogicalDeviceId: MIXER_1.id }), {
      deviceId: 'me',
      hardwareSetup: active,
      logicalDevices: [MIXER_1],
      installed: [plugin({ id: 'specific-plugin' }), plugin({ id: 'other-plugin' })],
    })
    expect(triggerShowControl).toHaveBeenCalledWith('specific-plugin', expect.anything())
  })
})
