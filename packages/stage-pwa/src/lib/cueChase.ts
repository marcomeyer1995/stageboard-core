import type { CapabilityId, ShowCue } from 'shared-types'
import { commandsFor } from './deviceCommands'

/** Which state a cue sets on its device (`device|key`), or null for a one-off event. */
function stateSlot(cue: ShowCue, capabilityOf: (cue: ShowCue) => CapabilityId | undefined): string | null {
  const capability = capabilityOf(cue)
  const command = capability ? commandsFor(capability).find((c) => c.type === cue.type) : undefined
  const key = command?.stateKey?.(cue.payload ?? {})
  return key === undefined ? null : `${cue.targetLogicalDeviceId}|${key}`
}

/** Per state slot, the last cue strictly before `ms`. */
function stateBefore(cues: readonly ShowCue[], ms: number, slotOf: (cue: ShowCue) => string | null): Map<string, ShowCue> {
  const last = new Map<string, ShowCue>()
  for (const cue of [...cues].sort((a, b) => a.timeMs - b.timeMs)) {
    if (cue.timeMs >= ms) break
    const slot = slotOf(cue)
    if (slot) last.set(slot, cue)
  }
  return last
}

/**
 * The state cues to send again at a section jump (#479, Marco 2026-10-17: "chase", like a DAW):
 * for every state a device holds (its rig, patch, a fader), the last cue before the target - when
 * it differs from the state the song stood in at the jump. Repeating the chorus with the same rig
 * sends nothing (a needless rig change on a Kemper is an audible gap). One-off events are never
 * repeated, and a state the target sets itself right on its first moment is left to that cue.
 */
export function chaseCues(cues: readonly ShowCue[], boundaryMs: number, targetMs: number, capabilityOf: (cue: ShowCue) => CapabilityId | undefined): ShowCue[] {
  const slotOf = (cue: ShowCue) => stateSlot(cue, capabilityOf)
  const atJump = stateBefore(cues, boundaryMs, slotOf)
  const atTarget = stateBefore(cues, targetMs, slotOf)
  const setOnTarget = new Set(cues.filter((cue) => cue.timeMs === targetMs).map(slotOf))
  const chased: ShowCue[] = []
  for (const [slot, cue] of atTarget) {
    if (setOnTarget.has(slot)) continue
    const now = atJump.get(slot)
    if (now && now.type === cue.type && JSON.stringify(now.payload ?? {}) === JSON.stringify(cue.payload ?? {})) continue
    chased.push(cue)
  }
  return chased
}
