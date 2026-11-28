import { callMethod, type MethodResult } from 'sync-host'
import { BUILTIN_ADDONS } from '../addonUi/builtinAddons'
import type { AppHelper } from './appHelpers'
import { startWorkHost, type WorkHost, type WorkMidi, type WorkWorkerFactory } from './workHost'

/**
 * The add-ons whose methods this device answers itself (docs/36 §2, #964): their work script in a Worker of the app, the device's own helpers behind
 * it. A device does this when no host of the band can - a tablet with no laptop around. The boundary is the one every host uses (`callMethod`, in
 * sync-host): input and answer are checked against what the manifest declared, so the add-on behaves the same wherever it runs.
 */
export interface LocalAddonMethods {
  /** Whether this device has every helper the add-on needs. */
  canRun(addonId: string): Promise<boolean>
  /** `midi`: the device this call is for (a device add-on's `event`) - the add-on may send to it while it answers, nowhere else. */
  call(addonId: string, method: string, body: unknown, options?: { onProgress?: (fraction: number) => void; midi?: WorkMidi }): Promise<MethodResult>
}

export interface LocalAddonMethodsDeps {
  /** The helpers this device has for an add-on, by the name it asks for; `null` when it has none (not on Android, no helper installed, not trusted). */
  helpersFor(addonId: string): Promise<Record<string, AppHelper> | null>
  language(): string
  createWorker?: WorkWorkerFactory
}

export function createLocalAddonMethods(deps: LocalAddonMethodsDeps): LocalAddonMethods {
  const hosts = new Map<string, WorkHost>()
  const entry = (id: string) => BUILTIN_ADDONS.find((addon) => addon.id === id)
  const needed = (permissions: readonly string[]) => permissions.filter((p) => p.startsWith('helper:')).map((p) => p.slice('helper:'.length))

  const hasHelpers = async (id: string): Promise<Record<string, AppHelper> | null> => {
    const addon = entry(id)
    if (!addon?.workScript) return null
    // An add-on that needs no helper (a MIDI device's) runs on any device.
    if (needed(addon.permissions).length === 0) return {}
    const helpers = await deps.helpersFor(id)
    return helpers && needed(addon.permissions).every((name) => Object.prototype.hasOwnProperty.call(helpers, name)) ? helpers : null
  }

  return {
    canRun: async (id) => (await hasHelpers(id)) !== null,
    async call(id, method, body, options) {
      const addon = entry(id)
      if (!addon?.workScript) return { ok: false, error: { code: 'addon.unknown', message: `No add-on "${id}" on this device`, params: { addon: id } } }
      const helpers = await hasHelpers(id)
      if (!helpers) return { ok: false, error: { code: 'helper.missing', message: `This device has no helper for the add-on "${id}"`, params: { addon: id } } }
      let host = hosts.get(id)
      if (!host) {
        host = startWorkHost({ code: addon.workScript, name: id, permissions: addon.permissions, language: deps.language(), helpers, ...(deps.createWorker ? { createWorker: deps.createWorker } : {}) })
        hosts.set(id, host)
      }
      const running = host
      const midi = options?.midi
      const methodOptions = options?.onProgress ? { onProgress: options.onProgress } : {}
      return callMethod({ request: (m, b, timeoutMs, onProgress) => running.request(m, b, { timeoutMs, ...(onProgress ? { onProgress } : {}), ...(midi ? { midi } : {}) }) }, addon.contributes, method, body, methodOptions)
    },
  }
}
