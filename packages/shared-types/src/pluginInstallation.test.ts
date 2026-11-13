import { describe, expect, it } from 'vitest'
import { ADDON_API_VERSION, androidHelperCerts, apiVersionFits, HelpersSchema, PermissionSchema, PluginInstallationSchema } from './pluginInstallation.js'

const base = { id: 'x', name: 'X', version: '1.0.0', runtime: 'client', installedAt: 0 }
const cert = 'ab'.repeat(32)

describe('PluginInstallationSchema - apiVersion, permissions, helpers (#756)', () => {
  it('all three are optional - a manifest from before the fields still parses', () => {
    const parsed = PluginInstallationSchema.parse(base)
    expect(parsed.apiVersion).toBeUndefined()
    expect(parsed.permissions).toBeUndefined()
    expect(parsed.helpers).toBeUndefined()
  })

  it('accepts the permission shapes of docs/32 §7 and nothing else', () => {
    for (const ok of ['midi-out:Kemper*', 'midi-in:*', 'osc:192.168.1.20:7700', 'http:https://api.example.com', 'helper:youtube-download', 'audio-store', 'songs:read', 'songs:write']) {
      expect(PermissionSchema.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of ['', 'midi-out', 'midi-out:', 'songs', 'songs:delete', 'logins', 'audio-store:all']) {
      expect(PermissionSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('an Android helper needs at least one certificate, as lowercase hex', () => {
    expect(HelpersSchema.safeParse({ android: { package: 'de.stageboard.helper.youtube', certSha256: [cert] } }).success).toBe(true)
    expect(HelpersSchema.safeParse({ android: { package: 'de.stageboard.helper.youtube', certSha256: [] } }).success).toBe(false)
    expect(HelpersSchema.safeParse({ android: { package: 'de.stageboard.helper.youtube', certSha256: [cert.toUpperCase()] } }).success).toBe(false)
    expect(HelpersSchema.safeParse({ desktop: { program: 'yt-dlp', minVersion: '2026.08.19' } }).success).toBe(true)
  })
})

describe('apiVersionFits', () => {
  it('fits when the version is ours or not stated, never for another one', () => {
    expect(apiVersionFits({})).toBe(true)
    expect(apiVersionFits({ apiVersion: ADDON_API_VERSION })).toBe(true)
    expect(apiVersionFits({ apiVersion: ADDON_API_VERSION + 1 })).toBe(false)
  })
})

describe('androidHelperCerts', () => {
  it('is the trust list from the manifest, empty without one', () => {
    expect(androidHelperCerts({})).toEqual([])
    expect(androidHelperCerts({ helpers: { desktop: { program: 'yt-dlp' } } })).toEqual([])
    expect(androidHelperCerts({ helpers: { android: { package: 'p', certSha256: [cert] } } })).toEqual([cert])
  })
})
