import { create } from 'zustand'
import { CAPABILITIES, mapOutputs, outputSide, type AudioRoute, type CapabilityId, type StageMap } from 'shared-types'
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
    plan[source] = outputSide(outputs, input.route)
  }
  if (practice && (!routed || MIX_SOURCES.some((s) => plan[s] === null))) return { plan: PLAIN_PLAN, fellBack: true }
  return { plan, fellBack: false }
}

/** The sources the plan keeps silent because their output is missing. */
export function silencedSources(plan: OutputPlan): MixSource[] {
  return MIX_SOURCES.filter((s) => plan[s] === null)
}
