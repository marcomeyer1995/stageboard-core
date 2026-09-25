import type { AsyncJob } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type AsyncJobDoc = Doc<AsyncJob>

/** Same shared-workspace-db, prefix-scoped collection every other document kind uses (#49
 * follow-up) - the Stage-Server watches this exact collection's `async-jobs:` prefix
 * (`asyncJobWatcher.ts`) the same way it watches `plugins:` installs. */
const asyncJobs = createWorkspaceCollection<AsyncJob>('async-jobs')

export const getAsyncJobsDb = asyncJobs.getDb
export const switchAsyncJobsWorkspace = asyncJobs.switchWorkspace
export const getAllAsyncJobs = asyncJobs.getAll
export const putAsyncJob = asyncJobs.put
export const removeAsyncJob = asyncJobs.remove
export const asyncJobsChanges = asyncJobs.changes
