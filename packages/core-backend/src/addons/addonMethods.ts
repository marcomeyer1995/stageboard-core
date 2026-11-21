import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callMethod, type MethodResult, type MethodSandbox } from 'sync-host'
import { parseContributes, type AddonError, type AsyncJob, type Contributes, type StateField } from 'shared-types'
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
  /** The id the band's installation document carries when it differs from `id` (Ultimate Guitar: `ultimate-guitar-import`). */
  pluginId?: string
  /** The capabilities the add-on gives the band (`CAPABILITIES`) - what the host registers for an installed add-on. */
  provides?: string[]
  /** Legally risky (#546): not in a sale build. */
  legalRisk?: boolean
  /** The add-on answers `/lookup/<id>/...`; `requiresInstall`: only a band that installed it. */
  lookup?: { requiresInstall: boolean }
  /** The background job type this add-on is the worker of. */
  asyncJobType?: AsyncJob['type']
}

/** What the core needs to know about a built-in add-on without running it - read from its manifest, never from a table of ids kept in the core. */
export interface AddonInfo {
  id: string
  /** The id of the band's installation document. */
  pluginId: string
  name: string
  provides: string[]
  legalRisk: boolean
  lookup: { requiresInstall: boolean } | null
  asyncJobType: AsyncJob['type'] | null
  /** The helper programs it needs (`helper:` permissions). */
  helpers: string[]
}

/** The id of the installation that provides a capability on this build (the add-on's manifest says), or null. */
export const pluginIdProviding = (capability: string): string | null => loadAddonInfos().find((info) => info.provides.includes(capability))?.pluginId ?? null

/** The id of the installation that works a background job type, or null. */
export const pluginIdWorking = (jobType: AsyncJob['type']): string | null => loadAddonInfos().find((info) => info.asyncJobType === jobType)?.pluginId ?? null

/** The built-in add-ons' manifests (a read of files, no sandbox started). */
export function loadAddonInfos(root: string = defaultRoot, dirs: readonly string[] = ADDON_DIRS): AddonInfo[] {
  return dirs.map((dir) => {
    const manifest = JSON.parse(readFileSync(join(root, dir, 'manifest.json'), 'utf8')) as ManifestFile
    return {
      id: manifest.id,
      pluginId: manifest.pluginId ?? manifest.id,
      name: manifest.name ?? manifest.id,
      provides: manifest.provides ?? [],
      legalRisk: manifest.legalRisk === true,
      lookup: manifest.lookup ?? null,
      asyncJobType: manifest.asyncJobType ?? null,
      helpers: (manifest.permissions ?? []).filter((p) => p.startsWith('helper:')).map((p) => p.slice('helper:'.length)),
    }
  })
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
  /** The state fields the add-on's devices declared (docs/36 §5a), by key - what a published value is checked against. Empty for an add-on with no device. */
  declaredState(addonId: string): Record<string, StateField>
  /** Who hears the values an add-on's devices publish (`notify` topic `state`): which add-on and what it said, unchecked - the listener checks it against `declaredState`. */
  onState(listener: ((addonId: string, body: unknown) => void) | null): void
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
  let stateListener: ((addonId: string, body: unknown) => void) | null = null
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
        // Late-bound: the adapters create their sandboxes at import time, the host that listens exists later (`methods.onState(...)`).
        onState: (body: unknown) => stateListener?.(found.id, body),
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
    declaredState: (id) => Object.assign({}, ...(entry(id)?.contributes.devices ?? []).map((device) => device.state)) as Record<string, StateField>,
    onState: (listener) => void (stateListener = listener),
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
