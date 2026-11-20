import type { AsyncJob } from 'shared-types'

/**
 * Who works on a background job (#964, step 1b): the queue rules, once, for every host. A background job is a document of the band
 * (`AsyncJob`): a device writes it `queued`, whoever works on it writes progress and the result back into the same document. Until
 * now the laptop's watcher took every job nobody had claimed; with more than one host that is wrong - a laptop without the tool must
 * not end a job a tablet could do. The rules:
 *
 * - A job **needs** something (`jobNeeds`): the capability of the host that works on it (`GET /host/capabilities`).
 * - A host **claims** a job it can do by writing `runner: host:<its id>` (a device that does its own job writes `device:<id>`).
 * - A job with a `runner` belongs to that runner - restart or not; the others leave it alone.
 * - Two hosts may claim the same job before replication brings the writes together. The database picks one winning revision for both
 *   of them, so after the claim has settled each host reads the job again and goes on **only if it is still the runner** (`stillMine`).
 */

/** The job id (`GET /host/capabilities`' `jobs`/`plugins`) a job type needs from its host; null: no host does it (a device's job). */
export function jobNeeds(job: Pick<AsyncJob, 'type'>): string | null {
  switch (job.type) {
    case 'youtube-extract':
      return 'youtube-download'
    case 'stem-separation':
      return 'plugin:stem-separation'
    default:
      // `opus-convert` (#822) is for whichever *device* has a decoder in its browser engine - never a host's.
      return null
  }
}

export const hostRunner = (hostId: string): string => `host:${hostId}`

export interface JobWorker {
  hostId: string
  /** Whether this host can do what a job needs - `GET /host/capabilities` says. Absent: it can do everything (a host that says nothing). */
  canDo?: (needs: string) => boolean
}

const isHostJob = (job: AsyncJob): boolean => jobNeeds(job) !== null

/** The oldest queued job this host may take: no runner yet, a job for hosts, and one it can do. A plain FIFO. */
export function pickNextClaimable(jobs: readonly AsyncJob[], worker: JobWorker): AsyncJob | undefined {
  return jobs
    .filter((job) => job.status === 'queued' && !job.runner && isHostJob(job) && (worker.canDo?.(jobNeeds(job)!) ?? true))
    .sort((a, b) => a.createdAt - b.createdAt)[0]
}

/**
 * `running` jobs of this host that nothing works on any more - left behind by a restart mid-job. A job another runner holds is not
 * ours to fail; one with no runner is a job of the old kind (before claims), which was always the host's.
 */
export function stuckJobsOfHost(jobs: readonly AsyncJob[], hostId: string, currentJobId: string | null): AsyncJob[] {
  return jobs.filter((job) => job.status === 'running' && job.id !== currentJobId && isHostJob(job) && (!job.runner || job.runner === hostRunner(hostId)))
}

/** After the claim has settled: this host is still the one the job names. */
export const stillMine = (job: Pick<AsyncJob, 'runner'> | undefined, hostId: string): boolean => job?.runner === hostRunner(hostId)

/** Jobs no listed host can do stay queued; this says which they are, for a screen that tells the person why nothing happens. */
export function jobsNobodyCanDo(jobs: readonly AsyncJob[], workers: readonly JobWorker[]): AsyncJob[] {
  return jobs.filter((job) => job.status === 'queued' && !job.runner && isHostJob(job) && !workers.some((worker) => worker.canDo?.(jobNeeds(job)!) ?? true))
}
