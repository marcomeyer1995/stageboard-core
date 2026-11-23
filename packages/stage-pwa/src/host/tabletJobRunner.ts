import { hostRunner, jobNeeds, pickNextClaimable, stillMine } from 'sync-host'
import type { AsyncJob } from 'shared-types'

/**
 * The tablet host works the background jobs it can do itself (#964, Marco: "first myself"): the same queue rules as the laptop's watcher (sync-host's
 * `pickNextClaimable` / `stillMine`) - it takes a queued job it can do by writing `runner: host:<its id>`, and when the band lists another host that might do the
 * same it waits for the claim to settle in replication and goes on only if the job still names it. One job at a time.
 *
 * What it can do is what the device says it can (`canDo`, from its own capabilities: the add-on's helper app is here). Everything else stays queued for a host
 * or device that can.
 */
export interface TabletJobRunnerDeps {
  hostId: string
  /** The band's jobs as the app has them. */
  jobs: () => readonly AsyncJob[]
  /** Whether this device can do what a job needs (`plugin:youtube-download`). */
  canDo: (needs: string) => boolean
  /** Whether this host serves the band right now (active, not a passive backup). */
  serving: () => boolean
  /** Whether the band lists another host that might claim the same job. */
  hasPeers: () => boolean | Promise<boolean>
  /** The job's document as stored now. */
  read: (id: string) => Promise<AsyncJob | undefined>
  write: (job: AsyncJob) => Promise<void>
  /** Does the work and writes its outcome into the job; never throws. */
  run: (job: AsyncJob) => Promise<void>
  /** How long a claim settles when there are peers (default 2 s). */
  settleMs?: number
}

export function createTabletJobRunner(deps: TabletJobRunnerDeps): { tick: () => Promise<void> } {
  let busy = false
  return {
    async tick() {
      if (busy || !deps.serving()) return
      const peers = await deps.hasPeers()
      const next = pickNextClaimable(deps.jobs(), { hostId: deps.hostId, needsOf: jobNeeds, canDo: deps.canDo })
      if (!next || busy) return
      busy = true
      try {
        const claimed = { ...next, status: 'running' as const, progress: 0, runner: hostRunner(deps.hostId), updatedAt: Date.now() } as AsyncJob
        await deps.write(claimed)
        if (peers) {
          await new Promise((resolve) => setTimeout(resolve, deps.settleMs ?? 2000))
          if (!stillMine(await deps.read(next.id), deps.hostId)) return
        }
        await deps.run(claimed)
      } catch {
        // The claim could not be written: the job stays as it was for the next tick.
      } finally {
        busy = false
      }
    },
  }
}
