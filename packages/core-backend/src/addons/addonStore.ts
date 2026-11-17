import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ADDON_MANIFEST_FILE,
  AddonFileNameSchema,
  AddonReleaseManifestSchema,
  addonRepositoryUrl,
  apiVersionFits,
  parseAddonRepository,
  versionFromTag,
  type AddonReleaseManifest,
  type AddonRepository,
} from 'shared-types'

/**
 * Add-ons from their own repositories (docs/32 §12, #852), the host's part: read a repository's
 * latest release, check its manifest, download every file, check each SHA-256, keep the files
 * under the state directory and serve them to the devices - so devices never load an add-on from
 * the internet, also offline. Two versions are kept (the installed one and the one before, for
 * rollback).
 */

export const GITHUB_API = 'https://api.github.com'
/** A manifest larger than this is not a manifest. */
const MANIFEST_MAX_BYTES = 256 * 1024
/** One add-on file larger than this is refused (a client bundle is a few hundred kB). */
const FILE_MAX_BYTES = 64 * 1024 * 1024

export type AddonErrorCode = 'unreachable' | 'no-release' | 'not-an-addon' | 'bad-manifest' | 'version-mismatch' | 'api-version' | 'missing-file' | 'checksum' | 'too-large' | 'bad-repository'

/** A failure the app can name for the admin (docs/32 §12d: "a clear message"). */
export class AddonError extends Error {
  constructor(
    readonly code: AddonErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface AddonRelease {
  tag: string
  assets: ReleaseAsset[]
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface AddonDeps {
  fetch?: FetchLike
  apiBase?: string
}

const HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'StageBoard' }

/** The latest release that is not a pre-release (GitHub's `releases/latest`). */
export async function latestRelease(repository: AddonRepository, deps: AddonDeps = {}): Promise<AddonRelease> {
  const fetchImpl = deps.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${deps.apiBase ?? GITHUB_API}/repos/${repository.owner}/${repository.repo}/releases/latest`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    throw new AddonError('unreachable', String(err))
  }
  if (response.status === 404) throw new AddonError('no-release', addonRepositoryUrl(repository))
  if (!response.ok) throw new AddonError('unreachable', `HTTP ${response.status}`)
  const body = (await response.json()) as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string; size: number }> }
  if (!body.tag_name) throw new AddonError('no-release', addonRepositoryUrl(repository))
  return { tag: body.tag_name, assets: (body.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) }
}

async function download(asset: ReleaseAsset, maxBytes: number, deps: AddonDeps): Promise<Buffer> {
  if (asset.size > maxBytes) throw new AddonError('too-large', asset.name)
  let response: Response
  try {
    response = await (deps.fetch ?? fetch)(asset.url, { headers: { 'user-agent': 'StageBoard' }, signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    throw new AddonError('unreachable', `${asset.name}: ${String(err)}`)
  }
  if (!response.ok) throw new AddonError('unreachable', `${asset.name}: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > maxBytes) throw new AddonError('too-large', asset.name)
  return data
}

/** The release's manifest, checked: schema, version = tag, interface version, every file present. */
export async function readReleaseManifest(release: AddonRelease, deps: AddonDeps = {}): Promise<AddonReleaseManifest> {
  const asset = release.assets.find((a) => a.name === ADDON_MANIFEST_FILE)
  if (!asset) throw new AddonError('not-an-addon', `no ${ADDON_MANIFEST_FILE} in release ${release.tag}`)
  let json: unknown
  try {
    json = JSON.parse((await download(asset, MANIFEST_MAX_BYTES, deps)).toString('utf8'))
  } catch (err) {
    if (err instanceof AddonError) throw err
    throw new AddonError('bad-manifest', 'not JSON')
  }
  const parsed = AddonReleaseManifestSchema.safeParse(json)
  if (!parsed.success) throw new AddonError('bad-manifest', parsed.error.issues[0]?.message)
  const manifest = parsed.data
  if (manifest.version !== versionFromTag(release.tag)) throw new AddonError('version-mismatch', `${manifest.version} vs ${release.tag}`)
  if (!apiVersionFits(manifest)) throw new AddonError('api-version', String(manifest.apiVersion))
  for (const file of manifest.files) {
    const match = release.assets.find((a) => a.name === file.name)
    if (!match || match.size !== file.size) throw new AddonError('missing-file', file.name)
  }
  for (const ref of [manifest.clientFile, manifest.serverFile]) {
    if (ref && !manifest.files.some((f) => f.name === ref)) throw new AddonError('missing-file', ref)
  }
  return manifest
}

/** What the admin sees before installing (docs/32 §12a): the manifest - permissions, where it runs,
 * helpers - the publisher, the exact source and the download size. */
export interface AddonPreview {
  repository: string
  publisher: string
  release: string
  downloadBytes: number
  manifest: AddonReleaseManifest
}

export async function previewAddon(repositoryText: string, deps: AddonDeps = {}): Promise<{ preview: AddonPreview; release: AddonRelease }> {
  const repository = parseAddonRepository(repositoryText)
  if (!repository) throw new AddonError('bad-repository', repositoryText)
  const release = await latestRelease(repository, deps)
  const manifest = await readReleaseManifest(release, deps)
  return {
    preview: {
      repository: addonRepositoryUrl(repository),
      publisher: repository.owner,
      release: release.tag,
      downloadBytes: manifest.files.reduce((sum, f) => sum + f.size, 0),
      manifest,
    },
    release,
  }
}

export function addonRoot(): string {
  return process.env.STAGEBOARD_ADDON_DIR ?? join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'addons')
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/

/** The path of one kept file, or null for anything that isn't a plain add-on id, version and file name. */
export function addonFilePath(root: string, id: string, version: string, name: string): string | null {
  if (!ID.test(id) || !VERSION.test(version) || version.includes('..') || !AddonFileNameSchema.safeParse(name).success) return null
  return join(root, id, version, name)
}

/**
 * Downloads and checks every file of this version and keeps it under `<root>/<id>/<version>/`
 * (with the manifest beside it). Nothing is kept unless every file matches its SHA-256 - files go
 * to a temporary folder first and are moved in place together. An already kept version is not
 * downloaded again.
 */
export async function installAddonVersion(manifest: AddonReleaseManifest, release: AddonRelease, root: string, deps: AddonDeps = {}): Promise<string> {
  if (!ID.test(manifest.id) || !VERSION.test(manifest.version)) throw new AddonError('bad-manifest', 'id or version')
  const dir = join(root, manifest.id, manifest.version)
  if (await stat(join(dir, ADDON_MANIFEST_FILE)).then(() => true, () => false)) return dir
  const temp = join(root, manifest.id, `.part-${randomUUID()}`)
  await mkdir(temp, { recursive: true })
  try {
    for (const file of manifest.files) {
      const asset = release.assets.find((a) => a.name === file.name)
      if (!asset) throw new AddonError('missing-file', file.name)
      const data = await download(asset, Math.min(FILE_MAX_BYTES, file.size), deps)
      const sha256 = createHash('sha256').update(data).digest('hex')
      if (data.length !== file.size || sha256 !== file.sha256) throw new AddonError('checksum', file.name)
      await writeFile(join(temp, file.name), data)
    }
    await writeFile(join(temp, ADDON_MANIFEST_FILE), JSON.stringify(manifest, null, 2))
    await rm(dir, { recursive: true, force: true })
    await rename(temp, dir)
    return dir
  } catch (err) {
    await rm(temp, { recursive: true, force: true })
    throw err
  }
}

/** Removes kept versions of this add-on other than `keep` (the installed one and the one before). */
export async function pruneAddonVersions(root: string, id: string, keep: readonly string[]): Promise<string[]> {
  if (!ID.test(id)) return []
  const removed: string[] = []
  const entries = await readdir(join(root, id)).catch(() => [] as string[])
  for (const entry of entries) {
    if (keep.includes(entry)) continue
    await rm(join(root, id, entry), { recursive: true, force: true })
    removed.push(entry)
  }
  return removed
}

/** The kept manifest of a version, or null. */
export async function keptManifest(root: string, id: string, version: string): Promise<AddonReleaseManifest | null> {
  const path = addonFilePath(root, id, version, 'x') && join(root, id, version, ADDON_MANIFEST_FILE)
  if (!path) return null
  try {
    return AddonReleaseManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}
