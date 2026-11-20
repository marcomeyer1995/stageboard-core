import { z } from 'zod'
import { PluginInstallationSchema } from './pluginInstallation.js'

/**
 * An add-on from its own GitHub repository (docs/32 §12, #852; Marco 2026-11-14: one repository
 * per add-on, as HACS does). A repository's releases are the versions: the latest release that is
 * not a pre-release is the current one, its tag the version. Each release carries
 * `stageboard-addon.json` as an asset - the manifest below - so a version's manifest never changes
 * afterwards.
 */

/** The manifest's file name as a release asset. */
export const ADDON_MANIFEST_FILE = 'stageboard-addon.json'

/** A file of one version, as a release asset of the same name: a plain name, no directories - a
 * release's assets are flat, and a path can never leave the version's folder on the host. */
export const AddonFileNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  .refine((name) => !name.includes('..') && name !== ADDON_MANIFEST_FILE, 'not a file name an add-on may use')

export const AddonFileSchema = z.object({
  name: AddonFileNameSchema,
  /** SHA-256 of the file, lowercase hex - checked by the host before it keeps or serves the file. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Size in bytes - shown before installing, and a first check of the download. */
  size: z.number().int().nonnegative(),
})
export type AddonFile = z.infer<typeof AddonFileSchema>

/** The manifest of docs/32 §2 (what a band's installation copies), plus what only a release has. */
export const AddonReleaseManifestSchema = PluginInstallationSchema.omit({ enabled: true, installedAt: true, settings: true, source: true, clientSource: true }).extend({
  /** Every file of this version (the client bundle `client.js`, a server part, assets). */
  files: z.array(AddonFileSchema).min(1),
  /** The file the devices load as the client bundle, one of `files`. */
  clientFile: AddonFileNameSchema.optional(),
  /** The host's server part, one of `files` (not loaded yet - #17). */
  serverFile: AddonFileNameSchema.optional(),
  /** What is new in this version - shown with the update. */
  changes: z.string().max(4000).optional(),
  /** The oldest StageBoard version it runs on. */
  minStageBoard: z.string().optional(),
  /**
   * What the **server part** needs from the device that runs it (#962): only the power of the device decides which add-on
   * it can host. An add-on that needs Windows or Linux and cannot run on Android says so here; a host that does not
   * fit refuses to install the server part (501) and tells what is missing. Absent: runs anywhere. Does not limit the
   * client bundle - that runs in every device's page.
   */
  runsOn: z
    .object({
      /** Node's `process.platform` names (`win32`, `linux`, `darwin`) and `android`. */
      platforms: z.array(z.string().min(1)).min(1).optional(),
      minCpuCores: z.number().int().positive().optional(),
      minMemoryMb: z.number().int().positive().optional(),
    })
    .optional(),
})
export type AddonReleaseManifest = z.infer<typeof AddonReleaseManifestSchema>

/** `github.com/<owner>/<repo>` - also from a full URL with `https://`, `.git` or a trailing slash. */
export interface AddonRepository {
  owner: string
  repo: string
}

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_])?$/

export function parseAddonRepository(text: string): AddonRepository | null {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(text.trim())
  if (!match) return null
  const [, owner, repo] = match as unknown as [string, string, string]
  return NAME.test(owner) && NAME.test(repo) ? { owner, repo } : null
}

export function addonRepositoryUrl(repository: AddonRepository): string {
  return `https://github.com/${repository.owner}/${repository.repo}`
}

/** A version from a release tag: `v1.3.0` → `1.3.0`. */
export function versionFromTag(tag: string): string {
  return tag.replace(/^v/i, '')
}

/**
 * A band's add-on source (`addon-sources:<id>` in its database, docs/32 §12c): where the add-on
 * comes from and what the host keeps of it.
 */
export const AddonSourceSchema = z.object({
  id: z.string().min(1),
  repository: z.string().min(1),
  /** The version the band uses. */
  installedVersion: z.string().min(1),
  /** Versions the host keeps for this band - the installed one and the one before (rollback). */
  keptVersions: z.array(z.string().min(1)).default([]),
  /** When the host last looked for a newer release (ms), and what it found. */
  lastCheckedAt: z.number().int().nonnegative().optional(),
  latestVersion: z.string().optional(),
  /** The admin accepted the "unknown publisher" warning once for this repository. */
  publisherConfirmed: z.boolean().default(false),
})
export type AddonSource = z.infer<typeof AddonSourceSchema>

/** `POST /workspaces/:id/addons/preview` - an admin asks what a repository offers. */
export const AddonPreviewRequestSchema = z.object({ repository: z.string().min(1).max(300) })

/** `POST /workspaces/:id/addons/install` - `expectedVersion` is what the admin saw in the preview;
 * `previousVersion` the version installed before (kept for rollback). */
export const AddonInstallRequestSchema = AddonPreviewRequestSchema.extend({
  expectedVersion: z.string().min(1),
  previousVersion: z.string().min(1).optional(),
})
