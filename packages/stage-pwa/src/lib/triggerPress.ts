import type { Behavior } from './actions'
import { runAction, scheduleRelease, type Show } from './runAction'

/** Rastende triggers that are "on" right now (docs/23 §4a), by trigger id - on this device. */
const latched = new Set<string>()
/** Timed releases waiting, by trigger id - a new press starts its own. */
const pendingReleases = new Map<string, () => void>()

/**
 * Pressing a trigger (docs/23 §4a) - a pedal key, a widget button, next a MIDI controller's
 * button: the press action, a timed release, or the latch toggled. `id` names the trigger
 * ("key:b", "widget:…"). Resolves with why nothing happened, or null.
 */
export function pressTrigger(id: string, behavior: Behavior, show: Show): Promise<string | null> {
  if (behavior.kind === 'latching') {
    const on = !latched.has(id)
    if (on) latched.add(id)
    else latched.delete(id)
    return runAction(on ? behavior.on : behavior.off, show)
  }
  const result = runAction(behavior.press, show)
  const { release } = behavior
  if (release.kind === 'after') {
    pendingReleases.get(id)?.()
    pendingReleases.set(id, scheduleRelease(release, show))
  }
  return result
}

/** Letting go - only a tastend trigger with an action on release does something. */
export function releaseTrigger(_id: string, behavior: Behavior, show: Show): Promise<string | null> | null {
  if (behavior.kind !== 'momentary' || behavior.release.kind !== 'on-release') return null
  return runAction(behavior.release.action, show)
}

/** Whether a rastend trigger is "on". */
export function isLatched(id: string): boolean {
  return latched.has(id)
}
