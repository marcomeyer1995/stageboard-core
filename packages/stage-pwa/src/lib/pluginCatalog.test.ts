import { describe, expect, it } from 'vitest'
import { capabilitiesLabel, installableCatalog, isTestPlugin, PLUGIN_CATALOG } from './pluginCatalog'

describe('pluginCatalog (System cleanup 2026-10-16)', () => {
  it('names capabilities in the band\'s words, unknown ids as they are', () => {
    expect(capabilitiesLabel(['click-track', 'midi-clock'])).toBe('Klick, MIDI-Clock')
    expect(capabilitiesLabel(['kemper-control'])).toBe('Gerätesteuerung')
    expect(capabilitiesLabel(['something-new'])).toBe('something-new')
  })

  it('offers the test stand-ins only in the dev app - Klick and Backing-Track are built in now', () => {
    const release = installableCatalog(false).map((entry) => entry.id)
    expect(release).not.toContain('mock-mixer')
    expect(release).not.toContain('mock-lighting')
    expect(release).not.toContain('mock-backup')
    expect(release).not.toContain('mock-click')
    expect(release).not.toContain('mock-playback')
    expect(installableCatalog(true)).toHaveLength(PLUGIN_CATALOG.length)
    expect(isTestPlugin('mock-mixer')).toBe(true)
    expect(isTestPlugin('kemper-profiler')).toBe(false)
  })
})

describe('sale build (#546)', () => {
  it('leaves Ultimate Guitar Import and YouTube-Download out, the normal build offers them', () => {
    const sale = installableCatalog(false, true).map((entry) => entry.id)
    expect(sale).not.toContain('ultimate-guitar-import')
    expect(sale).not.toContain('youtube-download')
    const normal = installableCatalog(false, false).map((entry) => entry.id)
    expect(normal).toContain('ultimate-guitar-import')
    expect(normal).toContain('youtube-download')
  })
})

