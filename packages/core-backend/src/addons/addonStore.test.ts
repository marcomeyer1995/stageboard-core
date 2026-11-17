import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AddonError, addonFilePath, installAddonVersion, keptManifest, previewAddon, pruneAddonVersions, type AddonDeps } from './addonStore.js'

const CLIENT = Buffer.from('export default { id: "nux-mg30" }\n')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

function manifest(over: Record<string, unknown> = {}) {
  return {
    id: 'nux-mg30',
    name: 'NUX MG-30',
    version: '0.1.0',
    runtime: 'client',
    capabilities: ['mg30-control'],
    apiVersion: 1,
    permissions: ['midi-out:NUX MG-30'],
    files: [{ name: 'client.js', sha256: sha(CLIENT), size: CLIENT.length }],
    clientFile: 'client.js',
    changes: 'First version from its own repository',
    ...over,
  }
}

// A stand-in for GitHub: the API's releases/latest and the release assets.
let server: Server
let base = ''
let release: { tag: string; manifest: unknown; client: Buffer } = { tag: 'v0.1.0', manifest: manifest(), client: CLIENT }
let noRelease = false

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url.startsWith('/repos/')) {
      if (noRelease) return void res.writeHead(404).end('{}')
      const m = Buffer.from(JSON.stringify(release.manifest))
      res.writeHead(200, { 'content-type': 'application/json' })
      return void res.end(
        JSON.stringify({
          tag_name: release.tag,
          assets: [
            { name: 'stageboard-addon.json', browser_download_url: `${base}/assets/stageboard-addon.json`, size: m.length },
            { name: 'client.js', browser_download_url: `${base}/assets/client.js`, size: release.client.length },
          ],
        }),
      )
    }
    if (url === '/assets/stageboard-addon.json') return void res.end(JSON.stringify(release.manifest))
    if (url === '/assets/client.js') return void res.end(release.client)
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  base = `http://127.0.0.1:${address.port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'addons-'))
  release = { tag: 'v0.1.0', manifest: manifest(), client: CLIENT }
  noRelease = false
})
afterEach(() => rm(root, { recursive: true, force: true }))

const deps = (): AddonDeps => ({ apiBase: base })

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'ok'
  } catch (err) {
    return err instanceof AddonError ? err.code : `other: ${String(err)}`
  }
}

describe('previewAddon (docs/32 §12)', () => {
  it('reads the latest release: manifest, publisher, source and download size', async () => {
    const { preview } = await previewAddon('https://github.com/someone/stageboard-addon-nux-mg30.git', deps())
    expect(preview).toMatchObject({
      repository: 'https://github.com/someone/stageboard-addon-nux-mg30',
      publisher: 'someone',
      release: 'v0.1.0',
      downloadBytes: CLIENT.length,
      manifest: { id: 'nux-mg30', version: '0.1.0', permissions: ['midi-out:NUX MG-30'] },
    })
  })

  it('names what is wrong instead of installing something half', async () => {
    expect(await code(previewAddon('not a repository', deps()))).toBe('bad-repository')
    noRelease = true
    expect(await code(previewAddon('github.com/someone/x', deps()))).toBe('no-release')
    noRelease = false
    release.manifest = manifest({ version: '0.2.0' })
    expect(await code(previewAddon('github.com/someone/x', deps()))).toBe('version-mismatch')
    release.manifest = manifest({ apiVersion: 99 })
    expect(await code(previewAddon('github.com/someone/x', deps()))).toBe('api-version')
    release.manifest = manifest({ files: [{ name: 'other.js', sha256: sha(CLIENT), size: CLIENT.length }] })
    expect(await code(previewAddon('github.com/someone/x', deps()))).toBe('missing-file')
    release.manifest = { id: 'x' }
    expect(await code(previewAddon('github.com/someone/x', deps()))).toBe('bad-manifest')
    expect(await code(previewAddon('github.com/someone/x', { apiBase: 'http://127.0.0.1:1' }))).toBe('unreachable')
  })
})

describe('installAddonVersion', () => {
  it('keeps every file once its SHA-256 matches, with the manifest beside it', async () => {
    const { preview, release: rel } = await previewAddon('github.com/someone/x', deps())
    const dir = await installAddonVersion(preview.manifest, rel, root, deps())
    expect(dir).toBe(join(root, 'nux-mg30', '0.1.0'))
    expect(await readFile(join(dir, 'client.js'))).toEqual(CLIENT)
    expect((await keptManifest(root, 'nux-mg30', '0.1.0'))?.version).toBe('0.1.0')
  })

  it('keeps nothing when a file does not match its SHA-256', async () => {
    const { preview, release: rel } = await previewAddon('github.com/someone/x', deps())
    release.client = Buffer.from('export default { id: "nux-mg30", evil: 1 }\n'.slice(0, CLIENT.length))
    expect(await code(installAddonVersion(preview.manifest, rel, root, deps()))).toBe('checksum')
    expect(await readdir(join(root, 'nux-mg30')).catch(() => [])).toEqual([])
  })

  it('keeps the installed version and the one before, removes older ones', async () => {
    const { preview, release: rel } = await previewAddon('github.com/someone/x', deps())
    await installAddonVersion(preview.manifest, rel, root, deps())
    await installAddonVersion({ ...preview.manifest, version: '0.2.0' }, rel, root, deps())
    await installAddonVersion({ ...preview.manifest, version: '0.3.0' }, rel, root, deps())
    expect(await pruneAddonVersions(root, 'nux-mg30', ['0.3.0', '0.2.0'])).toEqual(['0.1.0'])
    expect((await readdir(join(root, 'nux-mg30'))).sort()).toEqual(['0.2.0', '0.3.0'])
  })
})

describe('addonFilePath', () => {
  it('only plain ids, versions and file names - never a path out of the folder', () => {
    expect(addonFilePath('/r', 'nux-mg30', '0.1.0', 'client.js')).toBe(join('/r', 'nux-mg30', '0.1.0', 'client.js'))
    expect(addonFilePath('/r', '../etc', '0.1.0', 'client.js')).toBeNull()
    expect(addonFilePath('/r', 'nux-mg30', '..', 'client.js')).toBeNull()
    expect(addonFilePath('/r', 'nux-mg30', '0.1.0', '../x.js')).toBeNull()
    expect(addonFilePath('/r', 'nux-mg30', '0.1.0', 'stageboard-addon.json')).toBeNull()
  })
})
