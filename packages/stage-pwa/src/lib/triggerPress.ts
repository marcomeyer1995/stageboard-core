import type { Behavior } from './actions'
import { runAction, scheduleRelease, type Show } from './runAction'
import type { Switch } from './switches'
import { useSwitchesStore } from '../store/useSwitchesStore'

/** Rastende triggers and switches that are "on" right now (docs/23 §4a), by id - on this device. */
const latched = new Set<string>()
/** Timed releases waiting, by id - a new press starts its own. */
const pendingReleases = new Map<string, () => void>()
/** Per tastend switch, the triggers holding it down (docs/23 §11.10: the release action comes
 * when the last one lets go). */
const holders = new Map<string, Set<string>>()

const switchOf = (id: string): Switch | undefined => useSwitchesStore.getState().switches.find((s) => s.id === id)
const setSwitchState = (id: string, state: 'pressed' | 'on' | 'off') => useSwitchesStore.getState().setState(id, state)

/**
 * Pressing a trigger (docs/23 §4a) - a pedal key, a widget button, a MIDI controller's button: the
 * press action, a timed release, or the latch toggled. `id` names the trigger ("key:b",
 * "widget:…", "midi:…"). A trigger bound to a switch (§11) acts on the switch: one state for all
 * its triggers. Resolves with why nothing happened, or null.
 */
export function pressTrigger(id: string, behavior: Behavior, show: Show): Promise<string | null> {
  if (behavior.kind !== 'switch') return pressBehavior(id, behavior, show)
  const sw = switchOf(behavior.switchId)
  if (!sw || sw.behavior.kind === 'switch') return Promise.resolve('Schalter fehlt')
  const key = `switch:${sw.id}`
  if (sw.behavior.kind === 'latching') {
    const result = pressBehavior(key, sw.behavior, show)
    setSwitchState(sw.id, latched.has(key) ? 'on' : 'off')
    return result
  }
  const held = holders.get(key) ?? new Set<string>()
  const first = held.size === 0
  held.add(id)
  holders.set(key, held)
  setSwitchState(sw.id, 'pressed')
  if (sw.behavior.release.kind === 'after') return pressBehavior(key, sw.behavior, show, () => setSwitchState(sw.id, 'off'))
  // Held by another trigger already: the press has happened, this one only holds it longer.
  return first ? pressBehavior(key, sw.behavior, show) : Promise.resolve(null)
}

/** Letting go - a tastend trigger's release action; for a switch only when its last trigger lets go. */
export function releaseTrigger(id: string, behavior: Behavior, show: Show): Promise<string | null> | null {
  if (behavior.kind !== 'switch') return releaseBehavior(behavior, show)
  const sw = switchOf(behavior.switchId)
  if (!sw || sw.behavior.kind !== 'momentary') return null
  const key = `switch:${sw.id}`
  const held = holders.get(key)
  if (!held?.delete(id) || held.size > 0) return null
  holders.delete(key)
  // A timed switch stays lit until its second action.
  if (sw.behavior.release.kind === 'after') return null
  setSwitchState(sw.id, 'off')
  return releaseBehavior(sw.behavior, show)
}

/** Whether a rastend trigger is "on". */
export function isLatched(id: string): boolean {
  return latched.has(id)
}

function pressBehavior(id: string, behavior: Exclude<Behavior, { kind: 'switch' }>, show: Show, onTimedEnd?: () => void): Promise<string | null> {
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
    pendingReleases.set(id, scheduleRelease(release, show, onTimedEnd))
  }
  return result
}

function releaseBehavior(behavior: Exclude<Behavior, { kind: 'switch' }>, show: Show): Promise<string | null> | null {
  if (behavior.kind !== 'momentary' || behavior.release.kind !== 'on-release') return null
  return runAction(behavior.release.action, show)
}
