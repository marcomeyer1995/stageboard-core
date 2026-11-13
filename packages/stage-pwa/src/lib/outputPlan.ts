import { create } from 'zustand'
import { CAPABILITIES, equipmentOffered, mapOutputs, outputFeeds, type AudioRoute, type CapabilityId, type StageEquipment, type StageMap, type StageSetup } from 'shared-types'
import { MIX_SOURCES, PLAIN_PLAN, type MixSource, type OutputPlan } from './audioMix'
import type { SessionMode } from '../store/useAppModeStore'

const CAPABILITY: Record<MixSource, CapabilityId> = { track: CAPABILITIES.audioPlayback, click: CAPABILITIES.clickTrack, voice: CAPABILITIES.sectionAnnouncements }

const PRACTICE_KEY = 'sb:audio:practiceSetup'

function loadPracticeSetup(): string | null {
  try {
    return localStorage.getItem(PRACTICE_KEY)
  } catch {
    return null
  }
}

interface PracticeOutputState {
  /** The setup this device practises by, null: everything on both ears (docs/31 §0d). */
  setupId: string | null
  setSetupId: (setupId: string | null) => void
}

/** What this device practises by (Solo practice, Timeline, song editor) - per device. */
export const usePracticeOutputStore = create<PracticeOutputState>((set) => ({
  setupId: loadPracticeSetup(),
  setSetupId: (setupId) => {
    try {
      if (setupId === null) localStorage.removeItem(PRACTICE_KEY)
      else localStorage.setItem(PRACTICE_KEY, setupId)
    } catch {
      // Blocked storage: applies until the app is reloaded.
    }
    set({ setupId })
  },
}))

/** The stage-map store's lists: the band's, and everything somebody owns (#799). */
export interface MapLists {
  equipment: readonly StageEquipment[]
  setups: readonly StageSetup[]
  ownEquipment: readonly StageEquipment[]
  ownSetups: readonly StageSetup[]
}

/** The map a person practises by (#799): the band's, plus their own equipment and setups. */
export function practiceMap(lists: MapLists, profileId: string): StageMap {
  const mine = profileId === '' ? [] : lists.ownSetups.filter((s) => s.owner === profileId)
  return { equipment: [...lists.equipment, ...equipmentOffered(lists.ownEquipment, { owner: profileId || undefined })], setups: [...lists.setups, ...mine] }
}

/**
 * The setup plugin devices go by while practising (#799 step 4): the one chosen under "Ausgang
 * beim Üben", in the map of this person. Null: no setup chosen, or it is gone - cues stay at home
 * then, as before.
 */
export function practiceRoute(lists: MapLists, profileId: string, setupId: string | null): { map: StageMap; setupId: string } | null {
  if (setupId === null) return null
  const map = practiceMap(lists, profileId)
  return map.setups.some((s) => s.id === setupId) ? { map, setupId } : null
}

/**
 * The setup plugin devices go by right now - set while this device practises by one, null in the
 * Gig and while practising without a setup. Kept by useOutputPlan (always mounted); a store of its
 * own so a Translator looking up its MIDI port reads it without pulling in the workspace stores.
 */
export const usePracticeRouteStore = create<{ route: { map: StageMap; setupId: string } | null }>(() => ({ route: null }))

export interface PlanInput {
  mode: SessionMode
  map: StageMap | null
  deviceId: string
  front: Readonly<Record<string, string>>
  route: AudioRoute
  practiceSetupId: string | null
}

/**
 * The output plan of this device (docs/31 §0d, #742).
 *
 * Gig: every source this device plays sits where its matrix in the active setup puts it; a source
 * whose output is not the one Android plays on is silent, the others keep playing. Without a map
 * everything is on both sides, as before.
 *
 * Practice: everything on both ears, or a setup - then the sides come from this device's matrix
 * there. When that cannot apply (setup gone, device not placed, an output missing), back to both
 * ears (`fellBack`): at home nobody but the player hears it. A source the setup routes nowhere
 * stays on both ears - who plays is a matter of the Gig, the volume one of Mein Mix.
 */
export function outputPlan(input: PlanInput): { plan: OutputPlan; fellBack: boolean } {
  const plain = { plan: PLAIN_PLAN, fellBack: false }
  if (!input.map) return plain
  const practice = input.mode === 'practice'
  if (practice && input.practiceSetupId === null) return plain
  if (practice && !input.map.setups.some((s) => s.id === input.practiceSetupId)) return { plan: PLAIN_PLAN, fellBack: true }
  const plan: OutputPlan = { ...PLAIN_PLAN }
  let routed = false
  for (const source of MIX_SOURCES) {
    const outputs = mapOutputs(input.map, input.deviceId, CAPABILITY[source], practice ? {} : input.front, practice ? (input.practiceSetupId ?? undefined) : undefined)
    // Routed nowhere: this device does not play the source in the Gig (mapPlays) - nothing to place.
    if (!outputs || outputs.length === 0) continue
    routed = true
    // Only the track has two sides; click and announcements are one signal.
    plan[source] = outputFeeds(outputs, input.route, source === 'track')
  }
  if (practice && (!routed || MIX_SOURCES.some((s) => plan[s] === null))) return { plan: PLAIN_PLAN, fellBack: true }
  return { plan, fellBack: false }
}

/** The sources the plan keeps silent because their output is missing. */
export function silencedSources(plan: OutputPlan): MixSource[] {
  return MIX_SOURCES.filter((s) => plan[s] === null)
}
