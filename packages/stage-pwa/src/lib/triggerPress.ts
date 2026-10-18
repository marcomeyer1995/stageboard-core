import type { Behavior } from './actions'
import { runAction, scheduleRelease, type Show } from './runAction'
import type { Switch } from './switches'
import { useSwitchesStore } from '../store/useSwitchesStore'

/** Rastende triggers and switches that are "on" right now (docs/23 §4a), by id. A switch's entry
 * follows the band (§11.5): other tablets' on/off arrive through applyRemoteSwitchEvent. */
const latched = new Set<string>()
/** Timed releases waiting, by id - a new press starts its own. */
const pendingReleases = new Map<string, () => void>()
/** Per switch, the triggers holding it down on this tablet ("timer" while a zeitgesteuert one runs). */
const localHolders = new Map<string, Set<string>>()
/** Per switch, the other tablets holding it, with when they drop out without a heartbeat. */
const remoteHolders = new Map<string, Map<string, number>>()

/** A holder that sent nothing for this long has dropped out (docs/23 §11.10: 3 s). */
export const HOLD_TIMEOUT_MS = 3_000

/** Tells the other tablets (switchSync.ts) - a no-op until it is connected. */
type Publish = (switchId: string, kind: 'held' | 'released' | 'on' | 'off') => void
let publish: Publish = () => {}
export function setSwitchPublisher(next: Publish): void {
  publish = next
}

const switchOf = (id: string): Switch | undefined => useSwitchesStore.getState().switches.find((s) => s.id === id)
const latchKey = (switchId: string) => `switch:${switchId}`
const heldHere = (switchId: string) => (localHolders.get(switchId)?.size ?? 0) > 0
const heldAnywhere = (switchId: string) => heldHere(switchId) || (remoteHolders.get(switchId)?.size ?? 0) > 0

/** What every button bound to the switch shows. */
function refresh(sw: Switch): void {
  const state = sw.behavior.kind === 'latching' ? (latched.has(latchKey(sw.id)) ? 'on' : 'off') : heldAnywhere(sw.id) ? 'pressed' : 'off'
  useSwitchesStore.getState().setState(sw.id, state)
}

function hold(switchId: string, holder: string): void {
  const set = localHolders.get(switchId) ?? new Set<string>()
  set.add(holder)
  localHolders.set(switchId, set)
}

/** Removes a holder; true when this tablet no longer holds the switch at all. */
function letGo(switchId: string, holder: string): boolean {
  const set = localHolders.get(switchId)
  if (!set?.delete(holder)) return false
  if (set.size > 0) return false
  localHolders.delete(switchId)
  return true
}

/**
 * Pressing a trigger (docs/23 §4a) - a pedal key, a widget button, a MIDI controller's button: the
 * press action, a timed release, or the latch toggled. `id` names the trigger ("key:b",
 * "widget:…", "midi:…"). A trigger bound to a switch (§11) acts on the switch: one state for all
 * its triggers on every tablet. Resolves with why nothing happened, or null.
 */
export function pressTrigger(id: string, behavior: Behavior, show: Show): Promise<string | null> {
  if (behavior.kind !== 'switch') return pressBehavior(id, behavior, show)
  const sw = switchOf(behavior.switchId)
  if (!sw || sw.behavior.kind === 'switch') return Promise.resolve('Schalter fehlt')
  if (sw.behavior.kind === 'latching') {
    const result = pressBehavior(latchKey(sw.id), sw.behavior, show)
    publish(sw.id, latched.has(latchKey(sw.id)) ? 'on' : 'off')
    refresh(sw)
    return result
  }
  if (sw.behavior.release.kind === 'after') {
    // Lit until its second action; a new press starts the time again.
    hold(sw.id, 'timer')
    publish(sw.id, 'held')
    refresh(sw)
    return pressBehavior(latchKey(sw.id), sw.behavior, show, () => {
      if (letGo(sw.id, 'timer')) publish(sw.id, 'released')
      refresh(sw)
    })
  }
  const first = !heldAnywhere(sw.id)
  hold(sw.id, id)
  publish(sw.id, 'held')
  refresh(sw)
  // Held already (here or on another tablet): the press has happened, this one only holds it longer.
  return first ? pressBehavior(latchKey(sw.id), sw.behavior, show) : Promise.resolve(null)
}

/** Letting go - a tastend trigger's release action; for a switch only when the last trigger on
 * any tablet lets go. */
export function releaseTrigger(id: string, behavior: Behavior, show: Show): Promise<string | null> | null {
  if (behavior.kind !== 'switch') return releaseBehavior(behavior, show)
  const sw = switchOf(behavior.switchId)
  if (!sw || sw.behavior.kind !== 'momentary' || sw.behavior.release.kind === 'after') return null
  if (!letGo(sw.id, id)) return null
  publish(sw.id, 'released')
  refresh(sw)
  return heldAnywhere(sw.id) ? null : releaseBehavior(sw.behavior, show)
}

/** Whether a rastend trigger is "on". */
export function isLatched(id: string): boolean {
  return latched.has(id)
}

/** The switches this tablet holds right now - repeated as a heartbeat, so the others know it is
 * still there (§11.5). */
export function switchesHeldHere(): string[] {
  return [...localHolders.keys()]
}

/** Another tablet switched, held or let go (switchSync.ts). Its actions ran there. */
export function applyRemoteSwitchEvent(switchId: string, deviceId: string, kind: 'held' | 'released' | 'on' | 'off', now = Date.now()): void {
  if (kind === 'on') latched.add(latchKey(switchId))
  else if (kind === 'off') latched.delete(latchKey(switchId))
  else {
    const map = remoteHolders.get(switchId) ?? new Map<string, number>()
    if (kind === 'held') map.set(deviceId, now + HOLD_TIMEOUT_MS)
    else map.delete(deviceId)
    if (map.size > 0) remoteHolders.set(switchId, map)
    else remoteHolders.delete(switchId)
  }
  const sw = switchOf(switchId)
  if (sw) refresh(sw)
}

/**
 * Tablets that held a switch and went silent (battery, WLAN) count as released after 3 s, so no
 * blinder stays on forever (§11.5). When that leaves nobody holding it, `runsRelease` - one device
 * of the band, the one running the show - sends its release action.
 */
export function expireRemoteHolders(show: Show, runsRelease: boolean, now = Date.now()): void {
  for (const [switchId, map] of remoteHolders) {
    let dropped = false
    for (const [deviceId, expiresAt] of map) {
      if (expiresAt <= now) {
        map.delete(deviceId)
        dropped = true
      }
    }
    if (!dropped) continue
    if (map.size === 0) remoteHolders.delete(switchId)
    const sw = switchOf(switchId)
    if (!sw) continue
    refresh(sw)
    if (runsRelease && !heldAnywhere(switchId) && sw.behavior.kind === 'momentary') void releaseBehavior(sw.behavior, show)
  }
}

/** Forgets everything (another band, tests). */
export function resetTriggerState(): void {
  latched.clear()
  for (const cancel of pendingReleases.values()) cancel()
  pendingReleases.clear()
  localHolders.clear()
  remoteHolders.clear()
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
