import type { HardwareSetup } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type HardwareSetupDoc = Doc<HardwareSetup>

/** HardwareSetup profiles replicate per workspace, same as Logical Devices (logicalDevicesDb.ts) -
 * defining a profile on one tablet is visible to the whole band, not just the device that
 * defined it (whichever tablet holds Master then picks the *active* one - see
 * ShowState.activeHardwareSetupId). */
const hardwareSetups = createWorkspaceCollection<HardwareSetup>('hardware-setups')

export const getHardwareSetupsDb = hardwareSetups.getDb
export const switchHardwareSetupsWorkspace = hardwareSetups.switchWorkspace
export const getAllHardwareSetups = hardwareSetups.getAll
export const putHardwareSetup = hardwareSetups.put
export const removeHardwareSetup = hardwareSetups.remove
export const hardwareSetupsChanges = hardwareSetups.changes
