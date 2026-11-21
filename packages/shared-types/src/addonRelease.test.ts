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
  const base = { id: 'x', name: 'X', version: '1.0.0', runtime: 'device', files: [{ name: 'client.js', sha256: 'a'.repeat(64), size: 10 }] }

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

describe('the release manifest of the add-on contract (#964, docs/36 §3)', () => {
  const base = {
    id: 'youtube-download',
    name: 'YouTube',
    version: '1.2.0',
    runtime: 'device',
    files: [
      { name: 'view.js', sha256: 'a'.repeat(64), size: 10 },
      { name: 'work.js', sha256: 'b'.repeat(64), size: 20 },
    ],
  }

  /** The manifest of docs/36 §3, with the fields every release manifest already needed. */
  const manifest = {
    ...base,
    protocol: 3,
    viewFile: 'view.js',
    workFile: 'work.js',
    runsOn: { minMemoryMb: 512 },
    permissions: ['http:www.youtube.com', 'helper:yt-dlp', 'audio-store'],
    contributes: {
      methods: { search: { in: { type: 'object' }, out: { type: 'object' } } },
      jobs: { 'youtube-extract': { input: { type: 'object' }, needs: { helper: 'yt-dlp' } } },
      ui: [{ slot: 'song-editor.track-source', id: 'yt', title: 'From YouTube', icon: 'youtube' }],
    },
  }

  it('parses the manifest of docs/36 §3', () => {
    const parsed = AddonReleaseManifestSchema.safeParse(manifest)

    expect(parsed.success, parsed.error?.message).toBe(true)
    expect(parsed.data?.protocol).toBe(3)
    expect(parsed.data?.viewFile).toBe('view.js')
    expect(parsed.data?.workFile).toBe('work.js')
    expect(parsed.data?.contributes?.ui?.[0]?.slot).toBe('song-editor.track-source')
  })

  it('protocol is an integer of at least 1', () => {
    for (const protocol of [1, 3]) expect(AddonReleaseManifestSchema.safeParse({ ...base, protocol }).success, String(protocol)).toBe(true)
    for (const protocol of [0, -1, 1.5, '3']) expect(AddonReleaseManifestSchema.safeParse({ ...base, protocol }).success, String(protocol)).toBe(false)
  })

  it('viewFile and workFile are plain file names', () => {
    expect(AddonReleaseManifestSchema.safeParse({ ...base, viewFile: '../view.js' }).success).toBe(false)
    expect(AddonReleaseManifestSchema.safeParse({ ...base, workFile: 'dir/work.js' }).success).toBe(false)
  })

  it('rejects a contributes with an unknown slot', () => {
    const ui = [{ slot: 'song-editor.sidebar', id: 'yt', title: 'Sidebar' }]
    expect(AddonReleaseManifestSchema.safeParse({ ...base, contributes: { ui } }).success).toBe(false)
  })

  it('keeps clientFile and jobsFile working as the older names, and contributes is optional', () => {
    expect(AddonReleaseManifestSchema.safeParse({ ...base, clientFile: 'view.js', jobsFile: 'work.js' }).success).toBe(true)
    expect(AddonReleaseManifestSchema.safeParse(base).data?.contributes).toBeUndefined()
  })
})
