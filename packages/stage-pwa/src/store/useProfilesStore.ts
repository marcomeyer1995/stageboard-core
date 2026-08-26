import { create } from 'zustand'
import { randomId } from '../lib/id'
import type { Profile } from 'shared-types'
import {
  getAllProfiles,
  getProfilesDb,
  putProfile,
  removeProfile,
  switchProfilesWorkspace,
  type ProfileDoc,
} from '../lib/profilesDb'

function toProfile(doc: ProfileDoc): Profile {
  return { id: doc.id, name: doc.name, role: doc.role }
}

interface ProfilesState {
  profiles: Profile[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  create: (name: string, role: string) => Promise<Profile>
  update: (id: string, name: string, role: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<Profile> | null = null

async function refresh(set: (partial: Partial<ProfilesState>) => void) {
  const docs = await getAllProfiles()
  set({ profiles: docs.map(toProfile) })
}

/** The band's roster - who's in it, and what they play. See profilesDb.ts/profile.ts. */
export const useProfilesStore = create<ProfilesState>((set, get) => ({
  profiles: [],
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchProfilesWorkspace(workspaceId)
    set({ profiles: [], loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = getProfilesDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  create: async (name, role) => {
    const profile: Profile = { id: randomId(), name, role }
    await putProfile(profile)
    return profile
  },
  update: async (id, name, role) => {
    const existing = get().profiles.find((profile) => profile.id === id)
    if (!existing) return
    await putProfile({ ...existing, name, role })
  },
  remove: async (id) => {
    await removeProfile(id)
  },
}))
