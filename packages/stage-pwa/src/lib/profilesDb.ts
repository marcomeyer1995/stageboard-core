import type { Profile } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type ProfileDoc = Doc<Profile>

const profiles = createWorkspaceCollection<Profile>('profiles')

export const getProfilesDb = profiles.getDb
export const switchProfilesWorkspace = profiles.switchWorkspace
export const getAllProfiles = profiles.getAll
export const putProfile = profiles.put
export const removeProfile = profiles.remove
export const startProfilesSync = profiles.startSync
