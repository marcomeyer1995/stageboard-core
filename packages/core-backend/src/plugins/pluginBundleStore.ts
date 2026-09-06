import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Where a plugin's downloaded client bundle lives on this Stage-Server's own disk (#101) -
 * same "plain directory tree, read fresh per call" pattern audioStore.ts already established
 * for track binaries, not a PouchDB attachment (this file never needs to replicate anywhere;
 * every tablet fetches it once from this server over the LAN instead).
 */
function pluginBundleDir(): string {
  return process.env.PLUGIN_BUNDLE_DIR ?? './data/plugins'
}

/** Same path-traversal guard shape as audioStore.ts's `isSafeAudioId` - a plugin id is always
 * a plain catalog identifier (`mock-mixer`, `kemper`), never user-supplied free text. */
const SAFE_ID = /^[a-zA-Z0-9-]+$/
export function isSafePluginId(id: string): boolean {
  return SAFE_ID.test(id)
}

function bundlePath(pluginId: string): string {
  return join(pluginBundleDir(), pluginId, 'client.js')
}

export async function writePluginBundle(pluginId: string, code: Buffer): Promise<void> {
  const path = bundlePath(pluginId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, code)
}

/** `null` when nothing has been downloaded for this plugin yet - "not found", not an error. */
export async function readPluginBundle(pluginId: string): Promise<Buffer | null> {
  try {
    return await readFile(bundlePath(pluginId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Whether a bundle has already been downloaded for this plugin - the sync loop's own
 * "already have it, nothing to do" check (pluginSync.ts's `installationsNeedingBundleDownload`).
 * A plain existence check, not a version comparison: re-downloading on every version bump is a
 * known simplification for this first slice (see #101's PR) - correct today (nothing yet
 * republishes a plugin under the same id/version with different code), revisit if that changes. */
export async function hasPluginBundle(pluginId: string): Promise<boolean> {
  return (await readPluginBundle(pluginId)) !== null
}
