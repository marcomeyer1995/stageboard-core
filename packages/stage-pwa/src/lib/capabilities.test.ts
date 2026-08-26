import { describe, expect, it } from 'vitest'
import { HEALTH_TIMEOUT_MS, type PluginHealth, type PluginInstallation } from 'shared-types'
import { capabilityStatusFor, pluginProviding, resolveCapabilities } from './capabilities'

const NOW = 1_000_000

function plugin(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    runtime: 'server',
    capabilities: ['mixer'],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

function health(lastSeenAt: number, status: 'online' | 'offline' | 'error' = 'online'): PluginHealth {
  return { plugins: { 'mock-mixer': { status, lastSeenAt } } }
}

describe('resolveCapabilities', () => {
  it('reports a capability with a fresh heartbeat as available', () => {
    const statuses = resolveCapabilities([plugin()], health(NOW), {}, NOW)
    expect(statuses.get('mixer')).toBe('available')
  })

  it('degrades a capability whose heartbeat went stale', () => {
    const statuses = resolveCapabilities(
      [plugin()],
      health(NOW - HEALTH_TIMEOUT_MS - 1),
      {},
      NOW,
    )
    expect(statuses.get('mixer')).toBe('degraded')
  })

  it('degrades a capability with no heartbeat at all (server never started)', () => {
    const statuses = resolveCapabilities([plugin()], { plugins: {} }, {}, NOW)
    expect(statuses.get('mixer')).toBe('degraded')
  })

  it('degrades a plugin that reports an error', () => {
    const statuses = resolveCapabilities([plugin()], health(NOW, 'error'), {}, NOW)
    expect(statuses.get('mixer')).toBe('degraded')
  })

  it('leaves a disabled plugin out entirely, so its widgets count as missing', () => {
    const statuses = resolveCapabilities([plugin({ enabled: false })], health(NOW), {}, NOW)
    expect(statuses.has('mixer')).toBe(false)
    expect(capabilityStatusFor(['mixer'], statuses)).toBe('missing')
  })

  it('judges client-side plugins by the local probe, not the server heartbeat', () => {
    const webmidi = plugin({
      id: 'generic-webmidi',
      runtime: 'client',
      capabilities: ['midi-input'],
    })
    expect(
      resolveCapabilities([webmidi], { plugins: {} }, { 'midi-input': true }, NOW).get('midi-input'),
    ).toBe('available')
    expect(
      resolveCapabilities([webmidi], { plugins: {} }, { 'midi-input': false }, NOW).get('midi-input'),
    ).toBe('degraded')
  })

  it('takes the best of two plugins providing the same capability', () => {
    const dead = plugin({ id: 'other-mixer' })
    const statuses = resolveCapabilities([dead, plugin()], health(NOW), {}, NOW)
    expect(statuses.get('mixer')).toBe('available')
  })
})

describe('capabilityStatusFor', () => {
  const statuses = resolveCapabilities(
    [plugin(), plugin({ id: 'lights', capabilities: ['lighting'] })],
    health(NOW),
    {},
    NOW,
  )

  it('treats a widget with no requirements as always available', () => {
    expect(capabilityStatusFor([], statuses)).toBe('available')
  })

  it('reports the weakest requirement', () => {
    // 'lights' has no heartbeat entry -> degraded, and that wins over the healthy mixer.
    expect(capabilityStatusFor(['mixer', 'lighting'], statuses)).toBe('degraded')
  })

  it('reports missing when a requirement is provided by nobody', () => {
    expect(capabilityStatusFor(['mixer', 'audio-playback'], statuses)).toBe('missing')
  })
})

describe('pluginProviding', () => {
  it('finds the installed plugin offering a capability', () => {
    expect(pluginProviding([plugin({ id: 'mock-playback', capabilities: ['audio-playback'] })], 'audio-playback')).toBe(
      'mock-playback',
    )
  })

  it('ignores a disabled plugin', () => {
    expect(
      pluginProviding(
        [plugin({ id: 'mock-playback', capabilities: ['audio-playback'], enabled: false })],
        'audio-playback',
      ),
    ).toBeNull()
  })

  it('returns null when nobody provides the capability', () => {
    expect(pluginProviding([plugin()], 'audio-playback')).toBeNull()
  })
})
