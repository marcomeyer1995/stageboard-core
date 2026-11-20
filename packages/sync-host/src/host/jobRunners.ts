import type { AsyncJob, HostCapabilities } from 'shared-types'
import { JOB_IDS, unmetRequirement, type RunsOn } from './capabilities.js'
import type { JobRef } from './jobQueue.js'

/**
 * What a host can do, declared by the things that do it (#964, step 3): a **runner** is one capability of a host - a job (backup,
 * speech, ...) or a plugin (stem separation, ...) - with a manifest: its id, what it lacks on this device (`missing`), what its
 * jobs file needs from a device (`runsOn`, the same field an add-on's manifest has), and which background job type it works on.
 * `GET /host/capabilities` and the job queue's "what does this job need" are *derived* from the runners a host has registered - there
 * is no second table to keep in step. A Node host registers the runners that ship with it; a tablet registers what it can do; an
 * add-on that brings a jobs file (docs/32, #17) registers the same way, so installing it is what makes a device able to do its job: there is
 * no server, an add-on runs on the devices that can run it.
 */
export interface JobRunner {
  /** The capability id: a job id (`speech`) or, with `kind: 'plugin'`, a plugin id (`stem-separation`). */
  id: string
  kind: 'job' | 'plugin'
  /** What this device lacks to run it, in words (`demucs`), or null when it can. Absent: nothing is lacking. */
  missing?: () => string | null
  /** What the jobs file needs from the device (platform, cores, memory); checked against the device's own power. */
  runsOn?: RunsOn
  /** Plain words for the person: why it is slow or missing here and how to improve it. */
  note?: string
  /** The background job type (`AsyncJob['type']`) this runner works on, if it is one. */
  asyncJobType?: AsyncJob['type']
}

/** The device the registry answers for: its power and what it is. */
export interface DeviceDescription {
  kind: HostCapabilities['kind']
  platform: string
  arch: string
  cpuCores?: number
  memoryMb?: number
}

export interface JobRunners {
  register(runner: JobRunner): void
  get(kind: JobRunner['kind'], id: string): JobRunner | undefined
  all(): readonly JobRunner[]
  /** The capability a background job needs from its host (`speech`, `plugin:stem-separation`), or null - not a host's job. */
  needsOfJob(job: JobRef): string | null
  /**
   * The capabilities answer. `jobs` lists every job id of sync-host's `JOB_ROUTES` (a job nobody registered is unavailable and says
   * `notBuilt`); `plugins` lists `plugins` (the ids this build knows) - each as available or with what it lacks.
   */
  capabilities(device: DeviceDescription, options: { plugins: readonly string[]; notBuilt: string }): HostCapabilities
}

export function createJobRunners(initial: readonly JobRunner[] = []): JobRunners {
  const runners = new Map<string, JobRunner>()
  const key = (kind: JobRunner['kind'], id: string) => `${kind}:${id}`
  const register = (runner: JobRunner) => void runners.set(key(runner.kind, runner.id), runner)
  initial.forEach(register)

  return {
    register,
    get: (kind, id) => runners.get(key(kind, id)),
    all: () => [...runners.values()],
    needsOfJob(job) {
      if (job.type === 'audio-import') return job.addonId ? `plugin:${job.addonId}` : null
      const runner = [...runners.values()].find((r) => r.asyncJobType === job.type)
      return runner ? (runner.kind === 'plugin' ? `plugin:${runner.id}` : runner.id) : null
    },
    capabilities(device, options) {
      const power = { kind: device.kind, platform: device.platform, arch: device.arch, database: 'builtin' as const, ...(device.cpuCores ? { cpuCores: device.cpuCores } : {}), ...(device.memoryMb ? { memoryMb: device.memoryMb } : {}) }
      const entry = (runner: JobRunner | undefined, id: string, notBuilt: string) => {
        if (!runner) return { id, available: false, needs: notBuilt }
        // What the runner says it lacks first; then what its manifest asks of this device's power.
        const needs = runner.missing?.() ?? unmetRequirement(runner.runsOn, { ...power, jobs: [], plugins: [] })
        return { id, available: needs === null, needs, ...(runner.note ? { note: runner.note } : {}) }
      }
      return {
        ...power,
        jobs: JOB_IDS.map((id) => entry(runners.get(key('job', id)), id, options.notBuilt)),
        // A plugin nobody registered a runner for needs nothing special: it is a plugin that runs anywhere the build has it.
        plugins: options.plugins.map((id) => {
          const runner = runners.get(key('plugin', id))
          return runner ? entry(runner, id, options.notBuilt) : { id, available: true, needs: null }
        }),
      }
    },
  }
}
