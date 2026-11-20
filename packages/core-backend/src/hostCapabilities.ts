import type { AddonReleaseManifest, HostCapabilities } from 'shared-types'
import { unmetRequirement, type JobRunners } from 'sync-host'
import { builtinRunners, thisMachine } from './builtinRunners.js'
import { PLUGIN_CATALOG } from './plugins/catalog.js'

/**
 * This device's capabilities (docs/25 §6, 2026-11-07; #962, #964): platform, power, database, and per job and per plugin of this
 * build whether it can run here and what it lacks - **derived from the runners the host has** (`builtinRunners.ts`), not from tables
 * kept here. Test plugins are left out. A Node machine does every job whose runner finds its tool - the same answer shape a tablet
 * gives, with other values.
 */
export function hostCapabilities(runners: JobRunners = builtinRunners(), catalog: readonly string[] = Object.keys(PLUGIN_CATALOG)): HostCapabilities {
  return runners.capabilities(thisMachine(), { plugins: catalog.filter((id) => !id.startsWith('mock-')), notBuilt: 'a runner for it on this host' })
}

/**
 * What this machine lacks to host an add-on's server part (#962, step 4) - null when it can, or when the add-on has no server
 * part (the client bundle runs in every device's page, wherever the add-on was installed).
 */
export function addonHostNeeds(manifest: Pick<AddonReleaseManifest, 'serverFile' | 'runsOn'>, capabilities: HostCapabilities = hostCapabilities()): string | null {
  return manifest.serverFile ? unmetRequirement(manifest.runsOn, capabilities) : null
}
