import { fileURLToPath } from 'node:url'
import { helperRunnerFor } from './helpers.js'
import { startNodeSandbox, type NodeSandbox } from './nodeSandbox.js'

/**
 * The add-ons that ship with a Node device (#964): the one place that says which add-on file runs, with which helpers and permissions. Until
 * a device can install an add-on from a repository (the next step) these are the add-ons it has; the files are the same kind of classic
 * Worker script a tablet would run. A sandbox is started when an add-on is first used and again if it died.
 */
export interface AddonManifest {
  id: string
  /** Absolute path of the add-on's JavaScript file. */
  file: string
  helpers: readonly string[]
  permissions: readonly string[]
}

const addonFile = (name: string) => fileURLToPath(new URL(`../../scripts/addons/${name}.js`, import.meta.url))

export const BUILTIN_ADDONS = {
  youtubeDownload: { id: 'youtube-download', file: addonFile('youtube-download'), helpers: ['yt-dlp'], permissions: ['helper:yt-dlp'] },
  speechSynthesis: { id: 'piper-speech', file: addonFile('speech-synthesis'), helpers: ['piper'], permissions: ['helper:piper'] },
  stemSeparation: { id: 'stem-separation', file: addonFile('stem-separation'), helpers: ['stems'], permissions: ['helper:stems'] },
} as const satisfies Record<string, AddonManifest>

export type Log = { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }

/** The running sandbox of an add-on - started on first use, started again when it died. */
export function createAddonHost(manifest: AddonManifest, log?: Log): () => Promise<NodeSandbox> {
  let sandbox: NodeSandbox | null = null
  let starting: Promise<NodeSandbox> | null = null
  return async () => {
    if (sandbox?.alive()) return sandbox
    starting ??= startNodeSandbox({
      addonFile: manifest.file,
      name: manifest.id,
      helpers: manifest.helpers,
      permissions: [...manifest.permissions],
      runHelper: helperRunnerFor(manifest.helpers),
      ...(log ? { log } : {}),
    }).finally(() => (starting = null))
    sandbox = await starting
    return sandbox
  }
}
