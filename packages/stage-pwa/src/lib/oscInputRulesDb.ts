import type { OscInputRulesDoc } from './oscInput'
import { createWorkspaceCollection } from './workspaceCollection'

/** An OSC-Eingang device's button rules (#484), band-wide like the device itself. */
const rules = createWorkspaceCollection<OscInputRulesDoc>('osc-input-rules')

export const switchOscInputRulesWorkspace = rules.switchWorkspace
export const getAllOscInputRules = rules.getAll
export const putOscInputRules = rules.put
export const oscInputRulesChanges = rules.changes
