import type { AsyncJob } from 'shared-types'

/**
 * What every background job a device runs itself shares (asyncJob.ts `runner`): the runner name this device writes into the job - the hosts leave a job
 * with a `runner` alone - and the jobs this app session is running right now, so a `running` job of this device that is not among them is a leftover
 * from before the app stopped, which nothing will finish.
 */
export const deviceRunner = (deviceId: string): string => `device:${deviceId}`

/** Jobs this device runs right now (this app session). */
export const activeDeviceJobs = new Set<string>()

/** Jobs this device was running when the app stopped (killed, crashed): nothing will finish them. `active`: ids running now. */
export function leftoverDeviceJobs(jobs: readonly AsyncJob[], deviceId: string, active: ReadonlySet<string>): AsyncJob[] {
  const runner = deviceRunner(deviceId)
  return jobs.filter((j) => j.runner === runner && j.status === 'running' && !active.has(j.id))
}
