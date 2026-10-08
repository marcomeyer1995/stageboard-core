import type { LogicalDevice, PluginInstallation, ShowCue } from 'shared-types'
import { pluginProviding } from './capabilities'
import { getTranslator, supportsLocalExecution } from './clientTranslator'
import { resolveHardwareBindingById, resolveHardwareEngine } from './hardwareRouting'
import { triggerShowControl } from './showControlClient'

export interface FireContext {
  deviceId: string
  logicalDevices: LogicalDevice[]
  installed: PluginInstallation[]
  /** Whether this device sends cues that go to a Stage-Server plugin. Every tablet runs the
   * scheduler, and each one used to send them - a light cue arrived once per tablet (a toggle
   * undid itself). Only the master does now (2026-10-08). */
  sendsServerCues: boolean
}

/** What happened with a cue on this device - null when another device (or the master) sends it. */
export interface CueOutcome {
  target: string
  ok: boolean
  message?: string
}

/**
 * Fires (or silently skips) one cue on this device - #102's cue scheduler and, later, any
 * ad-hoc-by-LogicalDeviceId trigger share this same decision. 'local-mine' calls the Translator
 * directly, 'plugin' forwards to the Stage-Server, and 'local-other'/'none' do nothing at all:
 * per docs/00 §6's "Dual Execution Contexts", the *other* device bound to this Logical Device
 * runs its own scheduler instance off the same synced clock and fires it independently - zero
 * network traffic for the predefined-timeline case, unlike ad-hoc events.
 *
 * Kept free of any store import (unlike useCueScheduler.ts) so it stays unit-testable without
 * workspaceDb.ts's top-level `new PouchDB(...)` - same reasoning hardwareRouting.ts's own doc
 * comment already gives.
 */
export async function fireCue(cue: ShowCue, ctx: FireContext): Promise<CueOutcome | null> {
  const logicalDevice = resolveHardwareBindingById(ctx.logicalDevices, cue.targetLogicalDeviceId)
  // A cue for a device that no longer exists is a missed cue - reported by the master only.
  if (!logicalDevice) return ctx.sendsServerCues ? { target: cue.targetLogicalDeviceId, ok: false, message: 'Gerät nicht gefunden (gelöscht?)' } : null

  const pluginId = logicalDevice.pluginId ?? pluginProviding(ctx.installed, logicalDevice.capability)
  const engine = resolveHardwareEngine(
    logicalDevice,
    ctx.deviceId,
    pluginId,
    supportsLocalExecution(ctx.installed, logicalDevice.capability),
  )

  const target = logicalDevice.name
  const outcome = (result: { status: string; message?: string } | undefined): CueOutcome =>
    !result ? { target, ok: false, message: 'Kein Treiber für dieses Gerät' } : { target, ok: result.status === 'ok', ...(result.status === 'ok' || !result.message ? {} : { message: result.message }) }
  try {
    if (engine === 'local-mine') {
      return outcome(await getTranslator(logicalDevice.capability)?.({ type: cue.type, payload: cue.payload, logicalDeviceId: logicalDevice.id }))
    }
    if (engine === 'plugin' && pluginId) {
      if (!ctx.sendsServerCues) return null
      return outcome(await triggerShowControl(pluginId, { type: cue.type, payload: cue.payload, logicalDeviceId: logicalDevice.id }))
    }
  } catch (err) {
    return { target, ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  // Nothing anywhere can send it (no plugin installed, nothing bound) - missed, said by the master.
  if (engine === 'none') return ctx.sendsServerCues ? { target, ok: false, message: 'Kein Plugin oder Gerät führt diesen Cue aus' } : null
  return null
}
