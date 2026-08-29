import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from 'shared-types'
import type { CapabilityStatus } from './capabilities'
import { availableModes } from './modes'

describe('availableModes', () => {
  it('hides a capability-gated mode when the band has no matching plugin', () => {
    expect(availableModes(new Map())).not.toContain('backup')
  })

  it('offers a capability-gated mode once a matching plugin is installed', () => {
    const capabilities = new Map<string, CapabilityStatus>([[CAPABILITIES.backup, 'available']])
    expect(availableModes(capabilities)).toContain('backup')
  })

  it('still offers a capability-gated mode when the plugin is merely unreachable', () => {
    // Degraded, not missing - same "installed but offline" story as a widget.
    const capabilities = new Map<string, CapabilityStatus>([[CAPABILITIES.backup, 'degraded']])
    expect(availableModes(capabilities)).toContain('backup')
  })

  it('always offers core modes regardless of capabilities', () => {
    expect(availableModes(new Map())).toEqual(
      expect.arrayContaining(['live', 'library', 'plugins']),
    )
  })
})
