import type { LogicalDevice, PluginInstallation, ShowCue } from 'shared-types'
import { pluginProviding } from './capabilities'
import { getTranslator, supportsLocalExecution, translatorHonoursScheduledAt } from './clientTranslator'
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
  /** Ahead-of-time dispatch (#477): the server-time moment the cue is due, and the synced clock to
   * compare it with. Absent: fire now (the old behaviour). */
  timing?: { scheduledAt: number; serverNow: () => number }
}

/** What happened with a cue on this device - null when another device (or the master) sends it. */
export interface CueOutcome {
  target: string
  ok: boolean
  message?: string
  /** The cue's MIDI was handed to WebMIDI for a future moment on this device - the only kind
   * `recallScheduledMidi` can take back. */
  scheduledLocally?: boolean
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
  const event = { type: cue.type, payload: cue.payload, logicalDeviceId: logicalDevice.id }
  const scheduledAt = ctx.timing ? Math.max(0, Math.round(ctx.timing.scheduledAt)) : undefined
  try {
    if (engine === 'local-mine') {
      const translator = getTranslator(logicalDevice.capability)
      if (ctx.timing && translatorHonoursScheduledAt(logicalDevice.capability)) {
        return { ...outcome(await translator?.({ ...event, scheduledAt })), scheduledLocally: true }
      }
      // A Translator that acts on receipt: wait for the moment here.
      if (ctx.timing) await waitUntil(ctx.timing.scheduledAt, ctx.timing.serverNow)
      return outcome(await translator?.(event))
    }
    if (engine === 'plugin' && pluginId) {
      if (!ctx.sendsServerCues) return null
      // The Stage-Server's gateway holds it until scheduledAt (core-backend index.ts) - server time
      // is what scheduledAt is in, so no conversion.
      return outcome(await triggerShowControl(pluginId, scheduledAt === undefined ? event : { ...event, scheduledAt }))
    }
  } catch (err) {
    return { target, ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  // Nothing anywhere can send it (no plugin installed, nothing bound) - missed, said by the master.
  if (engine === 'none') return ctx.sendsServerCues ? { target, ok: false, message: 'Kein Plugin oder Gerät führt diesen Cue aus' } : null
  return null
}

function waitUntil(serverTime: number, serverNow: () => number): Promise<void> {
  const delayMs = serverTime - serverNow()
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve()
}
