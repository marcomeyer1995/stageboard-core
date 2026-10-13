import { describe, expect, it } from 'vitest'
import { AUDIO_OUTPUT, latencyProfileId, type LatencyProfileDoc } from 'shared-types'
import { audioOutputLatencyMs, findLatencyProfile } from './latencyProfiles'

function profile(deviceId: string, output: string, route: LatencyProfileDoc['route'], latencyMs: number): LatencyProfileDoc {
  return { id: latencyProfileId(deviceId, output, route), deviceId, output, route, latencyMs, source: 'manual' }
}

describe('latency profiles (#491)', () => {
  const profiles = [profile('fire', AUDIO_OUTPUT, 'speaker', 430), profile('fire', AUDIO_OUTPUT, 'bluetooth', 620), profile('fire', 'kemper', null, 12)]

  it('finds the profile of exactly this device, output and route', () => {
    expect(findLatencyProfile(profiles, 'fire', AUDIO_OUTPUT, 'bluetooth')?.latencyMs).toBe(620)
    expect(findLatencyProfile(profiles, 'fire', 'kemper', null)?.latencyMs).toBe(12)
    expect(findLatencyProfile(profiles, 'fire', AUDIO_OUTPUT, 'wired')).toBeNull()
    expect(findLatencyProfile(profiles, 'xiaomi', AUDIO_OUTPUT, 'speaker')).toBeNull()
  })

  it("this device's audio latency follows its route; 0 without a value or switched off, never negative", () => {
    expect(audioOutputLatencyMs(profiles, 'fire', 'speaker', true)).toBe(430)
    expect(audioOutputLatencyMs(profiles, 'fire', 'bluetooth', true)).toBe(620)
    expect(audioOutputLatencyMs(profiles, 'fire', 'usb', true)).toBe(0)
    expect(audioOutputLatencyMs(profiles, 'fire', 'speaker', false)).toBe(0)
    expect(audioOutputLatencyMs([profile('x', AUDIO_OUTPUT, 'speaker', -20)], 'x', 'speaker', true)).toBe(0)
  })

  it('ids are unique per device, output and route', () => {
    expect(latencyProfileId('fire', AUDIO_OUTPUT, 'speaker')).not.toBe(latencyProfileId('fire', AUDIO_OUTPUT, 'bluetooth'))
    expect(latencyProfileId('server', 'light', null)).toBe('server:light:-')
  })
})
