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

/** What a job type needs from its host when the host has no runners to ask (its default): YouTube a download tool, stems the stem plugin; a
 * device's conversion nothing. A host that registers runners answers from them (`JobRunners.needsOfJob`, jobRunners.ts) - see `needsOf`. */
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
  /** What a job needs from its host - from the runners the host has registered. Absent: the default table above. */
  needsOf?: (job: Pick<AsyncJob, 'type'>) => string | null
  /** Whether this host can do what a job needs - `GET /host/capabilities` says. Absent: it can do everything (a host that says nothing). */
  canDo?: (needs: string) => boolean
}

const needsFor = (worker: Pick<JobWorker, 'needsOf'>) => worker.needsOf ?? jobNeeds

/** The oldest queued job this host may take: no runner yet, a job for hosts, and one it can do. A plain FIFO. */
export function pickNextClaimable(jobs: readonly AsyncJob[], worker: JobWorker): AsyncJob | undefined {
  const needsOf = needsFor(worker)
  return jobs
    .filter((job) => job.status === 'queued' && !job.runner && needsOf(job) !== null && (worker.canDo?.(needsOf(job)!) ?? true))
    .sort((a, b) => a.createdAt - b.createdAt)[0]
}

/**
 * `running` jobs of this host that nothing works on any more - left behind by a restart mid-job. A job another runner holds is not
 * ours to fail; one with no runner is a job of the old kind (before claims), which was always the host's.
 */
export function stuckJobsOfHost(jobs: readonly AsyncJob[], hostId: string, currentJobId: string | null, needsOf: (job: Pick<AsyncJob, 'type'>) => string | null = jobNeeds): AsyncJob[] {
  return jobs.filter((job) => job.status === 'running' && job.id !== currentJobId && needsOf(job) !== null && (!job.runner || job.runner === hostRunner(hostId)))
}

/** After the claim has settled: this host is still the one the job names. */
export const stillMine = (job: Pick<AsyncJob, 'runner'> | undefined, hostId: string): boolean => job?.runner === hostRunner(hostId)

/** Jobs no listed host can do stay queued; this says which they are, for a screen that tells the person why nothing happens. */
export function jobsNobodyCanDo(jobs: readonly AsyncJob[], workers: readonly JobWorker[]): AsyncJob[] {
  return jobs.filter((job) => {
    if (job.status !== 'queued' || job.runner) return false
    return workers.every((worker) => {
      const needs = needsFor(worker)(job)
      return needs !== null && !(worker.canDo?.(needs) ?? true)
    })
  })
}
