import { mapRoute } from 'shared-types'
import { getDeviceId } from './deviceId'
import { getMidiOutputById, getMidiOutputByName } from './webMidiOutput'
import { useStageMapStore } from '../store/useStageMapStore'

/** The MIDI port name the stage map gives a plugin device on this app - from the cable it is routed
 * onto (docs/31 §6 step 2, part 2) - or null. */
export function mapMidiName(logicalDeviceId: string): string | null {
  const map = useStageMapStore.getState()
  if (!map.loaded) return null
  const route = mapRoute(map, logicalDeviceId, map.front)
  return route && route.app === getDeviceId() ? route.midiName : null
}

/**
 * The output a plugin device sends to on this app (2026-11-07): the port named on its cable in the
 * stage map, else the one set up on this device before the map (`storedId`).
 */
export async function midiOutputFor(logicalDeviceId: string, storedId: string | undefined, sendAt?: number): Promise<MIDIOutput | null> {
  const name = mapMidiName(logicalDeviceId)
  if (name) return getMidiOutputByName(name, sendAt)
  return storedId ? getMidiOutputById(storedId, sendAt) : null
}
