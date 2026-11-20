import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callMethod, type MethodResult, type MethodSandbox } from 'sync-host'
import { parseContributes, type AddonError, type Contributes } from 'shared-types'
import { createCapabilities } from './capabilities.js'
import { helperRunnerFor } from './helpers.js'
import { startNodeSandbox, type NodeSandbox } from './nodeSandbox.js'

/** What runs a helper for an add-on: this device's own programs (`helpers.ts`), or a test's stand-in. */
export type HelperRunFn = ReturnType<typeof helperRunnerFor>

/**
 * The add-ons this device can answer method calls for (docs/36 §3, #964): each one a work script in a sandbox of its own, with the methods its
 * manifest declared and the permissions the band confirmed. Everything about an add-on is its directory under `scripts/addons/` - `manifest.json` and
 * `work.js` - so a device that installs one from a repository (#17) registers the same two files. The device runs a method only if it has what the
 * add-on needs (its helpers); otherwise the answer says so and the caller can go to another device.
 */
export type Log = { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }

/** The add-ons that ship with a device, by directory. */
const ADDON_DIRS = ['youtube', 'metadata-lookup', 'ultimate-guitar', 'osc', 'piper-speech', 'stem-separation'] as const

interface ManifestFile {
  id: string
  name?: string
  workFile?: string
  permissions?: string[]
  contributes?: unknown
}

interface Entry {
  id: string
  workFile: string
  permissions: string[]
  helpers: string[]
  contributes: Contributes
}

const defaultRoot = fileURLToPath(new URL('../../scripts/addons/', import.meta.url))

function loadEntries(root: string, dirs: readonly string[]): Map<string, Entry> {
  const scriptsDir = (dir: string, file: string) => join(root, dir, file)
  const entries = new Map<string, Entry>()
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(scriptsDir(dir, 'manifest.json'), 'utf8')) as ManifestFile
    const permissions = manifest.permissions ?? []
    entries.set(manifest.id, {
      id: manifest.id,
      workFile: scriptsDir(dir, manifest.workFile ?? 'work.js'),
      permissions,
      helpers: permissions.filter((p) => p.startsWith('helper:')).map((p) => p.slice('helper:'.length)),
      contributes: parseContributes(manifest.contributes).contributes,
    })
  }
  return entries
}

/** `callMethod`'s view of a Node sandbox: the contract's request with a timeout and progress. */
export function asMethodSandbox(sandbox: NodeSandbox): MethodSandbox {
  return { request: (method, body, timeoutMs, onProgress, grants) => sandbox.request(method, body, { timeoutMs, ...(onProgress ? { onProgress } : {}), ...(grants ? { grants } : {}) }) }
}

export interface AddonMethods {
  /** Whether this device has an add-on with that id (it may still lack the helper it needs - the call says so). */
  has(addonId: string): boolean
  /** What the add-on declared, for the slot and the checks around it. */
  contributes(addonId: string): Contributes | null
  /** `grants`: permissions for this one call only, StageBoard's own (a device's own target) - never the add-on's choice. */
  call(addonId: string, method: string, body: unknown, options?: { onProgress?: (fraction: number) => void; grants?: readonly string[] }): Promise<MethodResult>
}

export interface AddonMethodsOptions {
  log?: Log
  /** The helpers an add-on gets instead of this device's own (a test stands in for Chrome, yt-dlp, Piper ...). */
  runHelper?: (addonId: string) => HelperRunFn | undefined
  /** Permissions on top of the manifest's, per add-on (a test points a look-up at a local server: that origin is declared like any other). */
  extraPermissions?: Record<string, string[]>
  /** What an add-on gets in `init`, per add-on. */
  settings?: Record<string, Record<string, unknown>>
  /** Where the add-on directories are, and which (a test brings its own add-ons; default: the ones that ship with the device). */
  root?: string
  dirs?: readonly string[]
}

export function createAddonMethods(options: AddonMethodsOptions = {}): AddonMethods {
  const entries = loadEntries(options.root ?? defaultRoot, options.dirs ?? ADDON_DIRS)
  const sandboxes = new Map<string, Promise<NodeSandbox>>()
  const entry = (id: string): Entry | undefined => entries.get(id)

  const sandboxOf = (found: Entry): Promise<NodeSandbox> => {
    const running = sandboxes.get(found.id)
    const start = async (): Promise<NodeSandbox> => {
      const permissions = [...found.permissions, ...(options.extraPermissions?.[found.id] ?? [])]
      const runHelper = options.runHelper?.(found.id) ?? helperRunnerFor(found.helpers)
      return startNodeSandbox({
        addonFile: found.workFile,
        name: found.id,
        permissions,
        language: 'de',
        capabilities: createCapabilities({ permissions, helpers: runHelper }),
        ...(options.settings?.[found.id] ? { settings: options.settings[found.id]! } : {}),
        ...(options.log ? { log: options.log } : {}),
      })
    }
    // A sandbox that died is started again with the next call. A start that FAILED must not be remembered: the failed promise would answer every later
    // call with the same error for ever, even after the cause (a broken file, a missing helper) is gone.
    const attempt: Promise<NodeSandbox> = (running ? running.then((sandbox) => (sandbox.alive() ? sandbox : start())) : start()).catch((err: unknown) => {
      if (sandboxes.get(found.id) === attempt) sandboxes.delete(found.id)
      throw err
    })
    sandboxes.set(found.id, attempt)
    return attempt
  }

  return {
    has: (id) => entry(id) !== undefined,
    contributes: (id) => entry(id)?.contributes ?? null,
    async call(id, method, body, callOptions) {
      const found = entry(id)
      if (!found) return { ok: false, error: { code: 'addon.unknown', message: `No add-on "${id}" on this device`, params: { addon: id } } satisfies AddonError }
      return callMethod(asMethodSandbox(await sandboxOf(found)), found.contributes, method, body, callOptions)
    },
  }
}

let shared: AddonMethods | null = null
/**
 * The one set of add-on sandboxes of this process: every adapter (look-ups, OSC, speech, stems) and the job watcher call through it, so an add-on runs
 * once. The first caller may bring the logger.
 */
export function sharedAddonMethods(log?: Log): AddonMethods {
  shared ??= createAddonMethods(log ? { log } : {})
  return shared
}
