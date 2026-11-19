import type { HostCapabilities } from 'shared-types'
import { HostCapabilitiesSchema } from 'shared-types'

/**
 * What a host can be asked to do, and which requests are those jobs (#962, step 3). **Only the power of the device decides**:
 * a request for a job the device cannot do is refused with 501 and the missing capability - never with 404 - so a phone
 * knows to send it to a host that can. The table is the one list of "things that need a capable device"; the laptop answers
 * them itself, the tablet refuses the ones it cannot run.
 */
export interface JobRoute {
  method: 'GET' | 'POST'
  /** Fastify-style. */
  pattern: string
  /** The job's id in `HostCapabilities.jobs`, or - for a plugin - `plugin:<id>` (a `:name` in the pattern fills it in). */
  job: string
}

export const JOB_ROUTES: readonly JobRoute[] = [
  { method: 'POST', pattern: '/server/backup/overview', job: 'backup' },
  { method: 'POST', pattern: '/server/backup/save', job: 'backup' },
  { method: 'POST', pattern: '/server/backup/delete', job: 'backup' },
  { method: 'POST', pattern: '/server/backup/run', job: 'backup' },
  { method: 'POST', pattern: '/server/backup/test', job: 'backup' },
  { method: 'GET', pattern: '/server/backup-status', job: 'backup' },
  { method: 'POST', pattern: '/server/measure-inputs/overview', job: 'measure-inputs' },
  { method: 'POST', pattern: '/server/measure-inputs/save', job: 'measure-inputs' },
  { method: 'POST', pattern: '/server/measure-inputs/level', job: 'measure-inputs' },
  { method: 'POST', pattern: '/calibration/runs', job: 'calibration' },
  { method: 'GET', pattern: '/calibration/runs/:id', job: 'calibration' },
  { method: 'GET', pattern: '/speech', job: 'speech' },
  { method: 'GET', pattern: '/speech/voices', job: 'speech' },
  { method: 'GET', pattern: '/speech/voices/:key/license', job: 'speech' },
  { method: 'POST', pattern: '/speech/voices/:key/install', job: 'speech' },
  { method: 'GET', pattern: '/lookup/:provider/search', job: 'lookup' },
  { method: 'GET', pattern: '/lookup/:provider/detail', job: 'lookup' },
  { method: 'GET', pattern: '/youtube/search', job: 'youtube-download' },
  { method: 'GET', pattern: '/youtube/thumbnail', job: 'youtube-download' },
  { method: 'GET', pattern: '/plugins', job: 'plugin-runtime' },
  { method: 'GET', pattern: '/plugins/:id/client.js', job: 'plugin-runtime' },
  { method: 'POST', pattern: '/plugins/:name/trigger', job: 'plugin:name' },
  { method: 'GET', pattern: '/addons/:id/:version/:file', job: 'plugin-runtime' },
  { method: 'POST', pattern: '/workspaces/:workspaceId/addons/preview', job: 'plugin-runtime' },
  { method: 'POST', pattern: '/workspaces/:workspaceId/addons/install', job: 'plugin-runtime' },
  { method: 'POST', pattern: '/workspaces/:workspaceId/activate-hardware', job: 'hardware' },
  { method: 'GET', pattern: '/osc-in/info', job: 'osc-in' },
  { method: 'GET', pattern: '/host/look-up', job: 'host-lookup' },
]

/** Every job id the table names (without the per-plugin ones) - what a host must say something about. */
export const JOB_IDS: readonly string[] = [...new Set(JOB_ROUTES.map((route) => route.job).filter((job) => !job.startsWith('plugin:')))]

const matches = (pattern: string, path: string): Record<string, string> | null => {
  const want = pattern.split('/')
  const have = path.split('/')
  if (want.length !== have.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i]!.startsWith(':')) params[want[i]!.slice(1)] = have[i]!
    else if (want[i] !== have[i]) return null
  }
  return params
}

/** The job a request is for, or null when it is no job request. */
export function jobOfRequest(method: string, path: string): string | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path
  for (const route of JOB_ROUTES) {
    if (route.method !== method.toUpperCase()) continue
    const params = matches(route.pattern, clean)
    if (!params) continue
    if (route.job === 'plugin:name') {
      try {
        return `plugin:${decodeURIComponent(params.name ?? '')}`
      } catch {
        return null
      }
    }
    return route.job
  }
  return null
}

/** The 501 a device that cannot do the job answers - `null` when it can (or when the request is no job). */
export function refusalFor(capabilities: HostCapabilities, method: string, path: string): { status: 501; body: unknown } | null {
  const job = jobOfRequest(method, path)
  if (job === null) return null
  const entry = job.startsWith('plugin:') ? capabilities.plugins.find((plugin) => plugin.id === job.slice('plugin:'.length)) : capabilities.jobs.find((candidate) => candidate.id === job)
  if (entry?.available) return null
  const needs = entry?.needs ?? (entry ? null : 'unknown')
  return {
    status: 501,
    body: {
      error: 'capability_missing',
      capability: job,
      needs,
      reason: `This device cannot do "${job}"${needs ? ` - it lacks ${needs}` : ''}. Ask a host that can.`,
    },
  }
}

/** What every host reports for the jobs only a Node machine runs, when it is not one: they say what they lack. */
export function unavailableJobs(needs: string, ids: readonly string[] = JOB_IDS): HostCapabilities['jobs'] {
  return ids.map((id) => ({ id, available: false, needs }))
}

export const parseCapabilities = (raw: unknown): HostCapabilities | null => {
  const parsed = HostCapabilitiesSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** What an add-on's server part needs from a device (`AddonReleaseManifest.runsOn`). */
export interface RunsOn {
  platforms?: string[]
  minCpuCores?: number
  minMemoryMb?: number
}

/**
 * What this device lacks to run an add-on's server part, as words for the person - or null when it can (#962, step 4).
 * Only what the device tells counts: a power it did not report is not held against it (it is not invented either way).
 */
export function unmetRequirement(runsOn: RunsOn | undefined, capabilities: HostCapabilities): string | null {
  if (!runsOn) return null
  const platform = capabilities.kind === 'android' ? 'android' : capabilities.platform
  if (runsOn.platforms && !runsOn.platforms.includes(platform)) return `one of ${runsOn.platforms.join(', ')} (this device is ${platform})`
  if (runsOn.minCpuCores !== undefined && capabilities.cpuCores !== undefined && capabilities.cpuCores < runsOn.minCpuCores) return `${runsOn.minCpuCores} CPU cores (this device has ${capabilities.cpuCores})`
  if (runsOn.minMemoryMb !== undefined && capabilities.memoryMb !== undefined && capabilities.memoryMb < runsOn.minMemoryMb) return `${runsOn.minMemoryMb} MB of memory (this device has ${capabilities.memoryMb})`
  return null
}

/** The 501 for an add-on this device cannot host. */
export function addonRefusal(addonId: string, needs: string): { status: 501; body: unknown } {
  return { status: 501, body: { status: 'error', error: 'capability_missing', capability: `plugin:${addonId}`, needs, reason: `This device cannot host the add-on "${addonId}" - it needs ${needs}. Install it on a host that can.` } }
}
