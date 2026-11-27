import type { AsyncJob } from 'shared-types'
import { hostRunner, pickNextClaimable, stillMine, stuckJobsOfHost, type JobRef } from './jobQueue.js'

/**
 * How a host works the band's background jobs (#964, step 1): the claim loop, once, for every host - the laptop's watcher and the
 * tablet host both run this one. The rules are jobQueue.ts's; this is the order they are applied in:
 *
 * 1. Take the oldest queued job this host may do (`pickNextClaimable`). One job at a time.
 * 2. Claim it: `running`, progress 0, `runner: host:<id>`.
 * 3. When the band lists another host that might claim the same job, wait for the claim to settle in replication and go on only if
 *    the job still names this host (`stillMine`) - two hosts that claimed at once see the same winning revision, so exactly one goes on.
 * 4. Run it. The runner writes the outcome into the job itself and never throws.
 *
 * The storage, the clock and the work are the host's own (ports below); the worker holds no band data.
 */
export interface JobClaimLoopDeps {
  hostId: string
  /** The band's jobs as this host has them now. */
  jobs: () => readonly AsyncJob[] | Promise<readonly AsyncJob[]>
  /** What a job needs from its host (the host's runners). Absent: jobQueue.ts's default table. */
  needsOf?: (job: JobRef) => string | null
  /** Whether this host can do what a job needs (`GET /host/capabilities`). Absent: everything. */
  canDo?: (needs: string) => boolean
  /**
   * With no other host in the band, take every job for hosts - also one this host cannot do, so the runner ends it with its own
   * message ("no demucs") instead of the person waiting for nothing. The laptop host does this; a tablet leaves such a job queued
   * (a laptop or a device may still come). Default false.
   */
  takeAllWhenAlone?: boolean
  /** Whether this host serves the band right now (not a passive backup). Absent: always. */
  serving?: () => boolean
  /** Whether the band lists another host that might claim the same job. */
  hasPeers: () => boolean | Promise<boolean>
  /** The job's document as stored now - read again after the claim settled. */
  read: (id: string) => Promise<AsyncJob | undefined>
  /** Writes the claim; `claimed` is the job as it is to be stored. */
  claim: (claimed: AsyncJob) => Promise<void>
  /** Does the work and writes its outcome into the job; never throws. */
  run: (claimed: AsyncJob) => Promise<void>
  /** How long a claim settles when there are peers (default 2 s). */
  settleMs?: number
  now?: () => number
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
}

export interface JobClaimLoop {
  /** One pass: claims and runs at most one job. True when a job ran (there may be another one queued behind it). */
  tick: () => Promise<boolean>
  /** The job this worker runs now, or null. */
  current: () => string | null
  /**
   * Only at startup: `running` jobs of this host that nothing works on any more - left behind by a restart mid-job - handed to
   * `fail`. Within one process the only running job of this host is `current()`, so any other is a leftover. (Sweeping on every
   * pass instead raced with a job finishing between the read and the sweep.)
   */
  failLeftRunning: (fail: (job: AsyncJob) => Promise<void>) => Promise<void>
}

export function createJobClaimLoop(deps: JobClaimLoopDeps): JobClaimLoop {
  const now = deps.now ?? Date.now
  let current: string | null = null

  return {
    current: () => current,

    async tick() {
      if (current !== null || !(deps.serving?.() ?? true)) return false
      const peers = await deps.hasPeers()
      const checkCanDo = deps.canDo && (peers || !deps.takeAllWhenAlone)
      const next = pickNextClaimable(await deps.jobs(), {
        hostId: deps.hostId,
        ...(deps.needsOf ? { needsOf: deps.needsOf } : {}),
        ...(checkCanDo ? { canDo: deps.canDo } : {}),
      })
      // Re-checked after the awaits: two passes (a change and a timer) can overlap.
      if (!next || current !== null) return false
      current = next.id
      try {
        const claimed = {
          ...next,
          status: 'running',
          progress: 0,
          runner: hostRunner(deps.hostId),
          updatedAt: now(),
        } as AsyncJob
        try {
          await deps.claim(claimed)
        } catch (err) {
          // The claim could not be written: the job stays as it was for the next pass.
          deps.log?.error('Could not claim the async job', {
            jobId: next.id,
            error: String(err),
          })
          return false
        }
        if (peers) {
          await new Promise((resolve) => setTimeout(resolve, deps.settleMs ?? 2000))
          const after = await deps.read(next.id).catch(() => undefined)
          if (!stillMine(after, deps.hostId)) {
            deps.log?.info('Another host took the job', {
              jobId: next.id,
              runner: after?.runner,
            })
            return false
          }
        }
        await deps.run(claimed).catch((err) =>
          deps.log?.error('Async job runner threw', {
            jobId: next.id,
            error: String(err),
          }),
        )
        return true
      } finally {
        current = null
      }
    },

    async failLeftRunning(fail) {
      for (const stuck of stuckJobsOfHost(await deps.jobs(), deps.hostId, current, deps.needsOf)) await fail(stuck)
    },
  }
}
