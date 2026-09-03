import { describe, expect, it } from 'vitest'
import { resolveAudioEngine } from './audioEngine'

describe('resolveAudioEngine', () => {
  it('always plays locally in Practice mode, regardless of any Gig-mode device claim', () => {
    expect(resolveAudioEngine('practice', null, 'me', null)).toBe('local-mine')
    expect(resolveAudioEngine('practice', 'someone-else', 'me', 'mock-playback')).toBe('local-mine')
  })

  it('uses the plugin in Gig mode when no device is claimed and a plugin is reachable', () => {
    expect(resolveAudioEngine('gig', null, 'me', 'mock-playback')).toBe('plugin')
  })

  it('falls back to no engine at all in Gig mode with no claim and no plugin', () => {
    expect(resolveAudioEngine('gig', null, 'me', null)).toBe('none')
  })

  it('plays locally when this device is the claimed audio output - a plugin never wins over an explicit claim', () => {
    expect(resolveAudioEngine('gig', 'me', 'me', 'mock-playback')).toBe('local-mine')
    expect(resolveAudioEngine('gig', 'me', 'me', null)).toBe('local-mine')
  })

  it("is not this device's job when a different device is the claimed audio output", () => {
    expect(resolveAudioEngine('gig', 'someone-else', 'me', 'mock-playback')).toBe('local-other')
    expect(resolveAudioEngine('gig', 'someone-else', 'me', null)).toBe('local-other')
  })
})
