import type { BandSettings } from 'shared-types'
import { createWorkspaceCollection } from './workspaceCollection'

/** The band-wide settings document (one, id "band") - replicates like setlists; admins only (server rule). */
const bandSettings = createWorkspaceCollection<BandSettings>('band-settings')

export const switchBandSettingsWorkspace = bandSettings.switchWorkspace
export const getAllBandSettings = bandSettings.getAll
export const putBandSettings = bandSettings.put
export const bandSettingsChanges = bandSettings.changes
