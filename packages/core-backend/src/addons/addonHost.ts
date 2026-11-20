import { fileURLToPath } from 'node:url'
import { createCapabilities } from './capabilities.js'
import { helperRunnerFor } from './helpers.js'
import { startNodeSandbox, type NodeSandbox, type NodeSandboxOptions } from './nodeSandbox.js'

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
  /** What the add-on gets in `init` (a test points the look-up at a local server). */
  settings?: Record<string, unknown>
}

const addonFile = (name: string) => fileURLToPath(new URL(`../../scripts/addons/${name}.js`, import.meta.url))

export const BUILTIN_ADDONS = {
  youtubeDownload: { id: 'youtube-download', file: addonFile('youtube-download'), helpers: ['yt-dlp'], permissions: ['helper:yt-dlp'] },
  speechSynthesis: { id: 'piper-speech', file: addonFile('speech-synthesis'), helpers: ['piper'], permissions: ['helper:piper'] },
  metadataLookup: { id: 'metadata-lookup', file: addonFile('musicbrainz-lookup'), helpers: [], permissions: ['http:https://musicbrainz.org'] },
  ultimateGuitarLookup: { id: 'ultimate-guitar-scraper', file: addonFile('ultimate-guitar-lookup'), helpers: ['ug-page'], permissions: ['helper:ug-page'] },
  oscSend: { id: 'osc', file: addonFile('osc-send'), helpers: ['udp-send'], permissions: ['helper:udp-send'] },
  stemSeparation: { id: 'stem-separation', file: addonFile('stem-separation'), helpers: ['stems'], permissions: ['helper:stems'] },
} as const satisfies Record<string, AddonManifest>

export type Log = { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }

/** The running sandbox of an add-on - started on first use, started again when it died. */
export function createAddonHost(manifest: AddonManifest, log?: Log, runHelper: NodeSandboxOptions['runHelper'] = helperRunnerFor(manifest.helpers)): () => Promise<NodeSandbox> {
  let sandbox: NodeSandbox | null = null
  let starting: Promise<NodeSandbox> | null = null
  return async () => {
    if (sandbox?.alive()) return sandbox
    starting ??= startNodeSandbox({
      addonFile: manifest.file,
      name: manifest.id,
      helpers: manifest.helpers,
      permissions: [...manifest.permissions],
      ...(manifest.settings ? { settings: manifest.settings } : {}),
      language: 'de',
      runHelper,
      capabilities: createCapabilities({ permissions: manifest.permissions, helpers: runHelper ?? helperRunnerFor(manifest.helpers) }),
      ...(log ? { log } : {}),
    }).finally(() => (starting = null))
    sandbox = await starting
    return sandbox
  }
}
