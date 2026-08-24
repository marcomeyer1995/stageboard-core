import type { Setlist } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type SetlistDoc = Doc<Setlist>

const setlists = createWorkspaceCollection<Setlist>('setlists')

export const getSetlistsDb = setlists.getDb
export const switchSetlistsWorkspace = setlists.switchWorkspace
export const getAllSetlists = setlists.getAll
export const putSetlist = setlists.put
export const startSetlistsSync = setlists.startSync
