import { describe, expect, it } from 'vitest'
import { AddonFileNameSchema, AddonReleaseManifestSchema, addonRepositoryUrl, parseAddonRepository, versionFromTag } from './addonRelease.js'

describe('parseAddonRepository (#852)', () => {
  it('reads the usual ways of writing a GitHub repository', () => {
    for (const text of ['https://github.com/me/stageboard-addon-x', 'github.com/me/stageboard-addon-x', 'https://github.com/me/stageboard-addon-x.git', ' https://www.github.com/me/stageboard-addon-x/ ']) {
      expect(parseAddonRepository(text), text).toEqual({ owner: 'me', repo: 'stageboard-addon-x' })
    }
    expect(addonRepositoryUrl({ owner: 'me', repo: 'x' })).toBe('https://github.com/me/x')
  })

  it('refuses anything that is not a plain owner/repo on GitHub', () => {
    for (const text of ['', 'me/x', 'https://gitlab.com/me/x', 'https://github.com/me', 'https://github.com/me/x/tree/main', 'https://github.com/../x']) {
      expect(parseAddonRepository(text), text).toBeNull()
    }
  })
})

describe('the release manifest', () => {
  const base = { id: 'x', name: 'X', version: '1.0.0', runtime: 'client', files: [{ name: 'client.js', sha256: 'a'.repeat(64), size: 10 }] }

  it('needs its files with SHA-256 and size', () => {
    expect(AddonReleaseManifestSchema.safeParse(base).success).toBe(true)
    expect(AddonReleaseManifestSchema.safeParse({ ...base, files: [] }).success).toBe(false)
    expect(AddonReleaseManifestSchema.safeParse({ ...base, files: [{ name: 'client.js', sha256: 'xyz', size: 10 }] }).success).toBe(false)
  })

  it('file names are plain asset names', () => {
    expect(AddonFileNameSchema.safeParse('client.js').success).toBe(true)
    for (const bad of ['../x.js', 'dir/x.js', '.hidden', 'stageboard-addon.json', 'a..b']) expect(AddonFileNameSchema.safeParse(bad).success, bad).toBe(false)
  })

  it('a tag is the version', () => {
    expect(versionFromTag('v1.3.0')).toBe('1.3.0')
    expect(versionFromTag('1.3.0')).toBe('1.3.0')
  })
})
