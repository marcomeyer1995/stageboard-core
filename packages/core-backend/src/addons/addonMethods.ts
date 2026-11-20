import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseContributes, type AddonError, type Contributes } from 'shared-types'
import { BUILTIN_ADDONS, createAddonHost, type AddonManifest, type Log } from './addonHost.js'
import { callMethod, type MethodResult, type MethodSandbox } from './methodBoundary.js'
import type { NodeSandbox } from './nodeSandbox.js'

/**
 * The add-ons this device can answer method calls for (docs/36 §3, #964): each one a work script in a sandbox of its own, with the methods its
 * manifest declared. The device runs a method only if it has what the add-on needs (its helpers) - otherwise the answer says so and the caller can
 * go to another device. Until installing from a repository exists these are the add-ons that ship with the device; the manifests are the same files
 * a repository add-on would bring.
 */
const manifestJson = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../scripts/addons/${name}/manifest.json`, import.meta.url)), 'utf8')) as { contributes?: unknown }

const METHOD_ADDONS: Record<string, { manifest: AddonManifest; manifestDir: string }> = {
  [BUILTIN_ADDONS.youtube.id]: { manifest: BUILTIN_ADDONS.youtube, manifestDir: 'youtube' },
}

/** `callMethod`'s view of a Node sandbox: the contract's request with a timeout and progress. */
export function asMethodSandbox(sandbox: NodeSandbox): MethodSandbox {
  return { request: (method, body, timeoutMs, onProgress) => sandbox.request(method, body, { timeoutMs, ...(onProgress ? { onProgress } : {}) }) }
}

export interface AddonMethods {
  /** Whether this device has an add-on with that id (it may still lack the helper it needs - the call says so). */
  has(addonId: string): boolean
  /** What the add-on declared, for the slot and the checks around it. */
  contributes(addonId: string): Contributes | null
  call(addonId: string, method: string, body: unknown, options?: { onProgress?: (fraction: number) => void }): Promise<MethodResult>
}

export function createAddonMethods(log?: Log): AddonMethods {
  const hosts = new Map<string, () => Promise<NodeSandbox>>()
  const declared = new Map<string, Contributes>()
  const entry = (id: string) => (Object.hasOwn(METHOD_ADDONS, id) ? METHOD_ADDONS[id] : undefined)
  const contributesOf = (id: string): Contributes | null => {
    const found = entry(id)
    if (!found) return null
    let contributes = declared.get(id)
    if (!contributes) {
      contributes = parseContributes(manifestJson(found.manifestDir).contributes).contributes
      declared.set(id, contributes)
    }
    return contributes
  }
  return {
    has: (id) => entry(id) !== undefined,
    contributes: contributesOf,
    async call(id, method, body, options) {
      const found = entry(id)
      const contributes = contributesOf(id)
      if (!found || !contributes) return { ok: false, error: { code: 'addon.unknown', message: `No add-on "${id}" on this device`, params: { addon: id } } satisfies AddonError }
      let host = hosts.get(id)
      if (!host) {
        host = createAddonHost(found.manifest, log)
        hosts.set(id, host)
      }
      return callMethod(asMethodSandbox(await host()), contributes, method, body, options)
    },
  }
}
