import { cpus, totalmem } from 'node:os'
import { createJobRunners, type DeviceDescription, type JobRunner, type JobRunners } from 'sync-host'
import { loadAddonInfos } from './addons/addonMethods.js'
import { addonMissingTool } from './addons/helpers.js'
import { appDir, readAppVersion } from './appDownload.js'
import { hostSpeech } from './speech/hostSpeech.js'

/**
 * The runners a Node host ships with (#964, step 3): each is one capability with a manifest (sync-host's `JobRunner`) - what it lacks on
 * this machine, and the background job it works on. This replaces the three tables `hostCapabilities.ts` used to keep (`JOB_CHECKS`,
 * `PLUGIN_CHECKS`, the plugin catalog's ids): `GET /host/capabilities` and the job queue's needs are derived from this list. A tool is
 * found by asking for it; nothing is assumed. The execution of the background jobs still lives in `asyncJobWatcher.ts` - moving it
 * behind the same manifests, and loading runners from installed add-ons (#17), is what is left of step 3.
 */

const needs = (ok: boolean, tool: string) => (ok ? null : tool)

export const BUILTIN_RUNNERS: readonly JobRunner[] = [
  // What a Node machine does without any extra tool.
  ...['backup', 'measure-inputs', 'calibration', 'lookup', 'plugin-runtime', 'hardware', 'osc-in', 'host-lookup'].map((id): JobRunner => ({ id, kind: 'job' })),
  { id: 'speech', kind: 'job', missing: () => needs(hostSpeech.available(), 'piper') },
  // It hands out the app only once one is built (scripts/build-android-app.sh writes the APK and version.json).
  { id: 'app-distribution', kind: 'job', missing: () => needs(readAppVersion(appDir()) !== null, 'an app build (scripts/build-android-app.sh)') },
  // Every add-on that gives the band a capability, and the programs its helpers need - read from its manifest (`addons/addonMethods.ts`), so a new add-on
  // adds a runner without a line here.
  ...loadAddonInfos()
    .filter((info) => info.provides.length > 0)
    .map((info): JobRunner => ({ id: info.pluginId, kind: 'plugin', missing: () => addonMissingTool(info.helpers), ...(info.asyncJobType ? { asyncJobType: info.asyncJobType } : {}) })),
]

export const builtinRunners = (): JobRunners => createJobRunners(BUILTIN_RUNNERS)

/** This machine as a host describes itself: what it is, and the power it can tell (never invented). */
export const thisMachine = (): DeviceDescription => ({
  kind: 'desktop',
  platform: process.platform,
  arch: process.arch,
  cpuCores: Math.max(1, cpus().length),
  memoryMb: Math.max(1, Math.round(totalmem() / 1024 / 1024)),
})
