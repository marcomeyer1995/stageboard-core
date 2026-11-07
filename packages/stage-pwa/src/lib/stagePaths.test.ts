import { describe, expect, it } from 'vitest'
import { AUDIO_OUTPUT, CAPABILITIES, NATIVE_AUDIO_OUTPUT, SERVER_EXECUTION_TARGET, latencyProfileId, type LatencyProfileDoc, type LogicalDevice } from 'shared-types'
import { stagePaths } from './stagePaths'

function role(id: string, capability: string, executionTarget: string | null, name = id): LogicalDevice {
  return { id, name, capability, pluginId: null, executionTarget } as LogicalDevice
}

function profile(deviceId: string, output: string, route: LatencyProfileDoc['route'], latencyMs: number, source: LatencyProfileDoc['source'] = 'manual'): LatencyProfileDoc {
  return { id: latencyProfileId(deviceId, output, route), deviceId, output, route, latencyMs, source }
}

const builtIn = new Map([
  [CAPABILITIES.clickTrack, 'Klick'],
  [CAPABILITIES.audioPlayback, 'Backing-Track'],
])

const base = {
  devices: [
    { id: 'fire', name: 'Fire' },
    { id: 'redmi', name: 'Redmi' },
    { id: 'old', name: 'Altes Tablet' },
  ],
  ownDeviceId: 'redmi',
  builtIn,
  personAt: (id: string) => ({ fire: 'Kai', redmi: 'Marco' })[id] ?? null,
  serverName: 'Stage-Server',
}

describe('stage paths (docs/31)', () => {
  it('groups the paths by device, this device first, and leaves out devices without any', () => {
    const groups = stagePaths({ ...base, logicalDevices: [role('click', CAPABILITIES.clickTrack, 'fire')], profiles: [] })
    expect(groups.map((g) => [g.name, g.own])).toEqual([
      ['Redmi', true],
      ['Fire', false],
    ])
  })

  it('one audio path per route with exactly one value - the native output\'s if there is one', () => {
    const groups = stagePaths({
      ...base,
      logicalDevices: [role('click', CAPABILITIES.clickTrack, 'fire'), role('track', CAPABILITIES.audioPlayback, 'fire')],
      profiles: [profile('fire', AUDIO_OUTPUT, 'speaker', 446, 'measured'), profile('fire', NATIVE_AUDIO_OUTPUT, 'speaker', 15), profile('fire', AUDIO_OUTPUT, 'wired', 120, 'measured')],
    })
    const fire = groups.find((g) => g.deviceId === 'fire')!
    expect(fire.paths.map((p) => [p.route, p.output, p.latencyMs, p.state])).toEqual([
      ['speaker', NATIVE_AUDIO_OUTPUT, 15, 'manual'],
      ['wired', AUDIO_OUTPUT, 120, 'measured'],
    ])
    expect(fire.paths[0]!.roles).toEqual(['Klick', 'Backing-Track'])
    expect(fire.paths[0]!.person).toBe('Kai')
  })

  it('a device that plays the click without any value gets a missing speaker path', () => {
    const fire = stagePaths({ ...base, logicalDevices: [role('click', CAPABILITIES.clickTrack, 'fire')], profiles: [] }).find((g) => g.deviceId === 'fire')!
    expect(fire.paths.map((p) => [p.kind, p.route, p.state])).toEqual([['audio', 'speaker', 'missing']])
  })

  it('outputs a device drives (Kemper, lights) are paths of their own, also on the Stage-Server', () => {
    const groups = stagePaths({
      ...base,
      logicalDevices: [role('kemper', 'amp', 'redmi', 'Kemper'), role('dmx', CAPABILITIES.lighting, SERVER_EXECUTION_TARGET, 'Licht')],
      profiles: [profile('redmi', 'kemper', null, 8, 'measured')],
    })
    expect(groups.find((g) => g.deviceId === 'redmi')!.paths.map((p) => [p.kind, p.name, p.latencyMs, p.state])).toEqual([['output', 'Kemper', 8, 'measured']])
    expect(groups.find((g) => g.deviceId === SERVER_EXECUTION_TARGET)!.paths.map((p) => [p.name, p.state, p.person])).toEqual([['Licht', 'missing', null]])
  })

  it('leaves out an old device that plays nothing and has only a stored value', () => {
    const now = 100 * 24 * 60 * 60 * 1000
    const groups = stagePaths({
      ...base,
      now,
      devices: [{ id: 'old', name: 'Altes Tablet', lastSeenAt: now - 30 * 24 * 60 * 60 * 1000 }, { id: 'fire', name: 'Fire', lastSeenAt: now }],
      logicalDevices: [],
      profiles: [profile('old', AUDIO_OUTPUT, 'speaker', 72, 'measured'), profile('fire', AUDIO_OUTPUT, 'speaker', 15)],
    })
    expect(groups.map((g) => g.name)).toEqual(['Fire'])
  })
})
