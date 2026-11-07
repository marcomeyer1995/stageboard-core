import { existsSync } from 'node:fs'
import type { HostCapabilities } from 'shared-types'
import { PLUGIN_CATALOG } from './plugins/catalog.js'
import { serverSpeech, PIPER_SPEECH_PLUGIN_ID } from './plugins/piperSpeechPlugin.js'
import { STEM_SEPARATION_PLUGIN_ID } from './plugins/stemSeparationPlugin.js'
import { ULTIMATE_GUITAR_PLUGIN_ID, YOUTUBE_DOWNLOAD_PLUGIN_ID } from './plugins/importAddons.js'
import { resolveChromeExecutable } from './plugins/ultimateGuitarPlugin.js'
import { stemsAvailable } from './stems/stemSeparation.js'
import { resolveYtDlpExecutable } from './ytDlp.js'

/** What a server plugin needs on this machine - null when it can run. */
export type PluginCheck = () => string | null

/** Whether `find` locates its tool - the resolvers throw when there is none. */
const found = (find: () => string, mustExist = false): boolean => {
  try {
    const path = find()
    return !mustExist || existsSync(path)
  } catch {
    return false
  }
}

/** The tools the heavy plugins need on the host; a plugin without an entry needs nothing. */
export const PLUGIN_CHECKS: Record<string, PluginCheck> = {
  [STEM_SEPARATION_PLUGIN_ID]: () => (stemsAvailable() ? null : 'demucs'),
  [PIPER_SPEECH_PLUGIN_ID]: () => (serverSpeech.available() ? null : 'piper'),
  [ULTIMATE_GUITAR_PLUGIN_ID]: () => (found(resolveChromeExecutable) ? null : 'chrome'),
  // A configured YT_DLP_PATH is returned unchecked - so the file must exist too.
  [YOUTUBE_DOWNLOAD_PLUGIN_ID]: () => (found(resolveYtDlpExecutable, true) ? null : 'yt-dlp'),
}

/**
 * This Stage-Server's capabilities (docs/25 §6, 2026-11-07): platform, database, and per server
 * plugin of this build whether it can run here and what it lacks. Test plugins are left out.
 */
export function hostCapabilities(checks: Record<string, PluginCheck> = PLUGIN_CHECKS, catalog: readonly string[] = Object.keys(PLUGIN_CATALOG)): HostCapabilities {
  return {
    kind: 'stage-server',
    platform: process.platform,
    arch: process.arch,
    database: process.env.STAGEBOARD_DB === 'builtin' ? 'builtin' : 'couchdb',
    plugins: catalog
      .filter((id) => !id.startsWith('mock-'))
      .map((id) => {
        const needs = checks[id]?.() ?? null
        return { id, available: needs === null, needs }
      }),
  }
}
