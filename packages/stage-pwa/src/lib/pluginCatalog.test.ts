import { describe, expect, it } from 'vitest'
import { capabilitiesLabel, installableCatalog, isTestPlugin, PLUGIN_CATALOG } from './pluginCatalog'

describe('pluginCatalog (System cleanup 2026-10-16)', () => {
  it('names capabilities in the band\'s words, unknown ids as they are', () => {
    expect(capabilitiesLabel(['click-track', 'midi-clock'])).toBe('Klick, MIDI-Clock')
    expect(capabilitiesLabel(['kemper-control'])).toBe('Gerätesteuerung')
    expect(capabilitiesLabel(['something-new'])).toBe('something-new')
  })

  it('offers the test stand-ins only in the dev app; click and track routing stay', () => {
    const release = installableCatalog(false).map((entry) => entry.id)
    expect(release).not.toContain('mock-mixer')
    expect(release).not.toContain('mock-lighting')
    expect(release).not.toContain('mock-backup')
    expect(release).toContain('mock-click')
    expect(release).toContain('mock-playback')
    expect(installableCatalog(true)).toHaveLength(PLUGIN_CATALOG.length)
    expect(isTestPlugin('mock-mixer')).toBe(true)
    expect(isTestPlugin('kemper-profiler')).toBe(false)
  })
})
