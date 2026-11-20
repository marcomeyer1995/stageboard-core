import { existsSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { createJobRunners, type DeviceDescription, type JobRunner, type JobRunners } from 'sync-host'
import { PIPER_SPEECH_PLUGIN_ID, serverSpeech } from './plugins/piperSpeechPlugin.js'
import { STEM_SEPARATION_PLUGIN_ID } from './plugins/stemSeparationPlugin.js'
import { ULTIMATE_GUITAR_PLUGIN_ID, YOUTUBE_DOWNLOAD_PLUGIN_ID } from './plugins/importAddons.js'
import { resolveChromeExecutable } from './addons/browserHelper.js'
import { stemsAvailable } from './stems/stemSeparation.js'
import { resolveYtDlpExecutable } from './ytDlp.js'

/**
 * The runners a Node host ships with (#964, step 3): each is one capability with a manifest (sync-host's `JobRunner`) - what it lacks on
 * this machine, and the background job it works on. This replaces the three tables `hostCapabilities.ts` used to keep (`JOB_CHECKS`,
 * `PLUGIN_CHECKS`, the plugin catalog's ids): `GET /host/capabilities` and the job queue's needs are derived from this list. A tool is
 * found by asking for it; nothing is assumed. The execution of the background jobs still lives in `asyncJobWatcher.ts` - moving it
 * behind the same manifests, and loading runners from installed add-ons (#17), is what is left of step 3.
 */

/** Whether `find` locates its tool - the resolvers throw when there is none. */
const found = (find: () => string, mustExist = false): boolean => {
  try {
    const path = find()
    return !mustExist || existsSync(path)
  } catch {
    return false
  }
}

const needs = (ok: boolean, tool: string) => (ok ? null : tool)
// A configured YT_DLP_PATH is returned unchecked - so the file must exist too.
const ytDlpMissing = () => needs(found(resolveYtDlpExecutable, true), 'yt-dlp')

export const BUILTIN_RUNNERS: readonly JobRunner[] = [
  // What a Node machine does without any extra tool.
  ...['backup', 'measure-inputs', 'calibration', 'lookup', 'plugin-runtime', 'hardware', 'osc-in', 'host-lookup'].map((id): JobRunner => ({ id, kind: 'job' })),
  { id: 'speech', kind: 'job', missing: () => needs(serverSpeech.available(), 'piper') },
  // The heavy plugins and the tools they need.
  { id: STEM_SEPARATION_PLUGIN_ID, kind: 'plugin', missing: () => needs(stemsAvailable(), 'demucs'), asyncJobType: 'stem-separation' },
  { id: PIPER_SPEECH_PLUGIN_ID, kind: 'plugin', missing: () => needs(serverSpeech.available(), 'piper') },
  { id: ULTIMATE_GUITAR_PLUGIN_ID, kind: 'plugin', missing: () => needs(found(resolveChromeExecutable), 'chrome') },
  { id: YOUTUBE_DOWNLOAD_PLUGIN_ID, kind: 'plugin', missing: ytDlpMissing },
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
