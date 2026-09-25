import { create } from 'zustand'
import { AsyncJobSchema, type AsyncJob } from 'shared-types'
import { getAllAsyncJobs, switchAsyncJobsWorkspace, asyncJobsChanges, type AsyncJobDoc } from '../lib/asyncJobsDb'

// safeParse, not parse - same "one malformed replicated doc must not crash the whole app"
// reasoning as useShowLogStore.ts's toShowLogEvent.
function toAsyncJob(doc: AsyncJobDoc): AsyncJob | null {
  const parsed = AsyncJobSchema.safeParse(doc)
  if (parsed.success) return parsed.data
  console.error('Dropping malformed AsyncJob', doc, parsed.error)
  return null
}

interface AsyncJobsState {
  jobs: AsyncJob[]
  init: (workspaceId: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<AsyncJob> | null = null

async function refresh(set: (partial: Partial<AsyncJobsState>) => void) {
  const docs = await getAllAsyncJobs()
  set({ jobs: docs.map(toAsyncJob).filter((job): job is AsyncJob => job !== null) })
}

/**
 * Every `AsyncJob` replicated into this workspace (#5) - the reactive counterpart to
 * `asyncJobWatcher.ts` on the server. `TrackManagerField.tsx` filters this to the current
 * variant to show "YouTube-Extraktion läuft: 42 %"; a job's own resulting track shows up
 * separately, once, through the normal SongVariant sync (the watcher appends it there itself).
 */
export const useAsyncJobsStore = create<AsyncJobsState>((set) => ({
  jobs: [],
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchAsyncJobsWorkspace(workspaceId)
    set({ jobs: [] })

    await refresh(set)

    changesHandle = asyncJobsChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
}))
