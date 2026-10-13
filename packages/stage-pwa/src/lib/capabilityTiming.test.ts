import { describe, expect, it } from 'vitest'
import type { LogicalDevice, PluginInstallation } from 'shared-types'
import { capabilityTiming, cueLatencyMs } from './capabilityTiming'

function plugin(overrides: Partial<PluginInstallation> & Pick<PluginInstallation, 'id' | 'capabilities'>): PluginInstallation {
  return { name: overrides.id, version: '1', runtime: 'client', transports: [], hardwareIds: [], enabled: true, installedAt: 0, ...overrides }
}

describe('capabilityTiming (docs/21)', () => {
  it("takes the plugin manifest's own declaration", () => {
    const dmx = plugin({ id: 'dmx', capabilities: ['lighting'], timing: [{ capability: 'lighting', timingClass: 'realtime', honoursScheduledAt: true, defaultLatencyMs: 25 }] })
    expect(capabilityTiming([dmx], 'lighting')).toMatchObject({ timingClass: 'realtime', honoursScheduledAt: true, defaultLatencyMs: 25 })
  })

  it('falls back to the catalog entry for a manifest installed before docs/21 (no timing field)', () => {
    const kemper = plugin({ id: 'kemper-profiler', capabilities: ['kemper-control'] })
    expect(capabilityTiming([kemper], 'kemper-control')).toMatchObject({ timingClass: 'realtime', honoursScheduledAt: true })
  })

  it('honours the plugin a Logical Device pins, and ignores disabled plugins', () => {
    const a = plugin({ id: 'a', capabilities: ['lighting'], timing: [{ capability: 'lighting', timingClass: 'soft', honoursScheduledAt: false }] })
    const b = plugin({ id: 'b', capabilities: ['lighting'], timing: [{ capability: 'lighting', timingClass: 'realtime', honoursScheduledAt: false }] })
    expect(capabilityTiming([a, b], 'lighting', 'b').timingClass).toBe('realtime')
    expect(capabilityTiming([{ ...a, enabled: false }, b], 'lighting').timingClass).toBe('realtime')
  })

  it('click and backing track are sample-exact built-ins without any plugin; anything undeclared is none, on receipt', () => {
    expect(capabilityTiming([], 'click-track').timingClass).toBe('sample')
    expect(capabilityTiming([], 'audio-playback').timingClass).toBe('sample')
    expect(capabilityTiming([], 'something-new')).toEqual({ capability: 'something-new', timingClass: 'none', honoursScheduledAt: false })
  })

  it("a cue is sent its target's declared latency early, 0 when unknown", () => {
    const dmx = plugin({ id: 'dmx', capabilities: ['lighting'], timing: [{ capability: 'lighting', timingClass: 'realtime', honoursScheduledAt: false, defaultLatencyMs: 25 }] })
    const devices: LogicalDevice[] = [
      { id: 'front', name: 'Frontlicht', capability: 'lighting', pluginId: null, executionTarget: null },
      { id: 'iem', name: 'IEM', capability: 'mixer', pluginId: null, executionTarget: null },
    ]
    const cue = (target: string) => ({ id: 'c', timeMs: 0, type: 'x', targetLogicalDeviceId: target })
    expect(cueLatencyMs(cue('front'), devices, [dmx])).toBe(25)
    expect(cueLatencyMs(cue('iem'), devices, [dmx])).toBe(0)
    expect(cueLatencyMs(cue('gone'), devices, [dmx])).toBe(0)
  })
})
