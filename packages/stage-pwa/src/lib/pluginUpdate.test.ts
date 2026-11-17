import { PluginInstallationSchema, type PluginInstallation } from 'shared-types'
import { describe, expect, it } from 'vitest'
import { PLUGIN_CATALOG } from './pluginCatalog'
import { availableUpdate, compareVersions, updatedInstallation } from './pluginUpdate'

const entry = {
  id: 'youtube-download',
  name: 'YouTube',
  version: '0.0.2',
  runtime: 'client' as const,
  capabilities: [],
  transports: [],
  hardwareIds: [],
  permissions: ['helper:de.stageboard.helper.youtube', 'audio-store'],
  helpers: { android: { package: 'de.stageboard.helper.youtube', certSha256: ['a'.repeat(64)] } },
}

function installed(over: Partial<PluginInstallation> = {}): PluginInstallation {
  return PluginInstallationSchema.parse({ ...entry, enabled: false, installedAt: 5, settings: { route: 'host' }, ...over })
}

describe('compareVersions', () => {
  it('compares dot versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1)
    expect(compareVersions('0.0.2', '0.0.2')).toBe(0)
    expect(compareVersions('v1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0-beta', '1.2.0')).toBe(0)
    expect(compareVersions('0.0.1', '0.0.2')).toBe(-1)
  })
})

describe('availableUpdate (#834)', () => {
  it('nothing when the installation matches the catalogue', () => {
    expect(availableUpdate(installed(), entry)).toBeNull()
  })

  it('a newer version, with the permissions that are new', () => {
    const old = installed({ version: '0.0.1', permissions: ['audio-store'] })
    expect(availableUpdate(old, entry)).toEqual({ from: '0.0.1', to: '0.0.2', newPermissions: ['helper:de.stageboard.helper.youtube'] })
  })

  it('the same version with a manifest field the copy lacks - the YouTube case before #796', () => {
    const old = installed({ helpers: undefined })
    expect(availableUpdate(old, entry)).toMatchObject({ from: '0.0.2', to: '0.0.2' })
  })

  it('never a downgrade, never another add-on', () => {
    expect(availableUpdate(installed({ version: '0.1.0' }), entry)).toBeNull()
    expect(availableUpdate(installed(), { ...entry, id: 'other' })).toBeNull()
    expect(availableUpdate(installed(), undefined)).toBeNull()
  })

  it('every add-on installed fresh from the catalogue shows no update', () => {
    for (const candidate of PLUGIN_CATALOG) {
      const fresh = PluginInstallationSchema.parse({ ...candidate, enabled: true, installedAt: 1 })
      expect(availableUpdate(fresh, candidate), candidate.id).toBeNull()
    }
  })
})

describe('updatedInstallation', () => {
  it("takes the catalogue's manifest and keeps the band's own state", () => {
    const old = installed({ version: '0.0.1', helpers: undefined })
    const next = updatedInstallation(old, entry)
    expect(next).toMatchObject({ version: '0.0.2', helpers: entry.helpers, enabled: false, installedAt: 5, settings: { route: 'host' } })
  })
})
