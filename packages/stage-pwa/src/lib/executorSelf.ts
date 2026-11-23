import type { Load, Self } from './executorChoice'
import { BUILTIN_ADDONS } from './addonUi/builtinAddons'
import { localAddonMethods } from './addonWork'
import { isNativeApp } from './native'

/** How heavy an add-on's method is, as its manifest says (light when it says nothing or the app does not know the add-on). */
export const loadOf = (addonId: string, method: string): Load => BUILTIN_ADDONS.find((a) => a.id === addonId)?.contributes.methods[method]?.load ?? 'light'

/** This device as an executor: whether it can run the add-on, and a coarse power (its cores; a laptop browser counts above a phone). */
export async function selfFor(addonId: string): Promise<Self> {
  const cores = typeof navigator === 'undefined' ? 0 : navigator.hardwareConcurrency || 0
  return { canRun: await localAddonMethods.canRun(addonId), power: Math.max(1, cores) * (isNativeApp() ? 1 : 4) }
}
