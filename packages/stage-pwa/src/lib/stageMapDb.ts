import type { StageEquipment, StageSetup } from 'shared-types'
import { createWorkspaceCollection } from './workspaceCollection'

/** The stage map (docs/31 §7): the band's equipment, one document each, and its setups - cables,
 * patch and positions per setup. Two collections so moving a tablet in one setup never conflicts
 * with the admin renaming the mixer. */
const equipment = createWorkspaceCollection<StageEquipment>('stage-equipment')
const setups = createWorkspaceCollection<StageSetup>('stage-setups')

export const stageEquipmentDb = equipment
export const stageSetupsDb = setups
