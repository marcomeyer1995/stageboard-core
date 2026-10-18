import type { MidiControllerRulesDoc } from './midiControllerRules'
import { createWorkspaceCollection } from './workspaceCollection'

/** A MIDI controller's button rules (#547), band-wide like the controller device itself. */
const rules = createWorkspaceCollection<MidiControllerRulesDoc>('midi-controller-rules')

export const switchMidiControllerRulesWorkspace = rules.switchWorkspace
export const getAllMidiControllerRules = rules.getAll
export const putMidiControllerRules = rules.put
export const removeMidiControllerRules = rules.remove
export const midiControllerRulesChanges = rules.changes
