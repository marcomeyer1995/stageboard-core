import type { LatencyProfileDoc } from 'shared-types'
import { createWorkspaceCollection } from './workspaceCollection'

/** Stored latency per output path (docs/21 §3, #491) - band-wide, so the Geräte tab shows every
 * device's values; the device that drives an output reads its own. */
const profiles = createWorkspaceCollection<LatencyProfileDoc>('latency-profile')

export const switchLatencyProfileWorkspace = profiles.switchWorkspace
export const getAllLatencyProfiles = profiles.getAll
export const putLatencyProfile = profiles.put
export const removeLatencyProfile = profiles.remove
export const latencyProfileChanges = profiles.changes
