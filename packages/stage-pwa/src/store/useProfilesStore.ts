import { create } from 'zustand'
import { randomId } from '../lib/id'
import type { Profile, StageRole } from 'shared-types'
import {
  getAllProfiles,
  profilesChanges,
  putProfile,
  removeProfile,
  switchProfilesWorkspace,
  type ProfileDoc,
} from '../lib/profilesDb'
import { useWorkspaceStore } from './useWorkspaceStore'

/** `stageRoles` defaults via Zod (see ProfileSchema), but `toProfile` builds the object
 * manually rather than going through `.parse()` - so a doc written before #57 (missing the
 * field entirely) needs the same `[]` fallback applied explicitly here. */
function toProfile(doc: ProfileDoc): Profile {
  return { id: doc.id, name: doc.name, role: doc.role, stageRoles: doc.stageRoles ?? [] }
}

/** What `create` hands back for a 2nd+ member (see per-person-accounts follow-up) - the caller
 * (BandManagementView.tsx/RosterSetupView.tsx) still needs the raw credentials once, to show
 * an invite code or a chosen PIN. `null` for the very first profile (reuses the founder's
 * already-known account - see `create` below - nothing new to show). */
export interface NewMemberCredentials {
  username: string
  password: string
}

interface ProfilesState {
  profiles: Profile[]
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  create: (
    name: string,
    role: string,
    options?: { password?: string; isAdmin?: boolean },
  ) => Promise<{ profile: Profile; credentials: NewMemberCredentials | null } | null>
  update: (id: string, name: string, role: string) => Promise<void>
  updateStageRoles: (id: string, stageRoles: StageRole[]) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  /** Provisions this workspace against a real Stage-Server for the first time (see the Tier-A
   * local-only-founding follow-up) - the founder's own account first (useWorkspaceStore.ts's
   * `connectWorkspace`), then every *other* already-existing local roster entry in one pass,
   * each keeping its existing profile id (no new roster docs written - they already exist
   * locally; this only attaches a real CouchDB account to each). `null` on failure to connect
   * at all; otherwise the freshly-provisioned credentials for each non-founder profile, for the
   * caller to show/invite from. */
  connectToServer: (serverUrl: string) => Promise<Array<{ profile: Profile; credentials: NewMemberCredentials }> | null>
}

let changesHandle: PouchDB.Core.Changes<Profile> | null = null

async function refresh(set: (partial: Partial<ProfilesState>) => void) {
  const docs = await getAllProfiles()
  set({ profiles: docs.map(toProfile) })
}

function activeWorkspace() {
  const state = useWorkspaceStore.getState()
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId)
}

/** Whether this workspace has ever been provisioned against a real Stage-Server - see the
 * Tier-A local-only-founding follow-up. Until then, every roster edit here (create, admin
 * toggle, remove) stays a plain local write: there's no CouchDB account or validator yet for
 * useWorkspaceStore.ts's backend calls to act on. */
function isServerConnected(workspace: ReturnType<typeof activeWorkspace>): boolean {
  return !!workspace?.username
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

    changesHandle = profilesChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  // Per-person-accounts follow-up: the very first profile a band ever gets reuses the
  // already-provisioned founder account (`Workspace.ownProfileId`/`addWorkspace`) - it's a
  // plain local write, nothing new to provision, auto-admin (so "at least one admin" holds
  // from the moment a band exists). Tier-A local-only-founding follow-up: every profile after
  // that stays a plain local write too, for as long as the workspace itself has never been
  // connected to a server (`isServerConnected`) - once it has, a brand-new personal CouchDB
  // account is provisioned first (`useWorkspaceStore`'s `createMember`), same as before.
  create: async (name, role, options = {}) => {
    const workspace = activeWorkspace()

    if (get().profiles.length === 0) {
      const profile: Profile = { id: workspace?.ownProfileId ?? randomId(), name, role, stageRoles: ['admin'] }
      await putProfile(profile)
      return { profile, credentials: null }
    }

    if (!isServerConnected(workspace)) {
      const profile: Profile = { id: randomId(), name, role, stageRoles: options.isAdmin ? ['admin'] : [] }
      await putProfile(profile)
      return { profile, credentials: null }
    }

    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
    const profileId = randomId()
    const credentials = await useWorkspaceStore.getState().createMember(workspaceId, {
      profileId,
      password: options.password,
      isAdmin: options.isAdmin,
    })
    if (!credentials) return null

    const profile: Profile = { id: profileId, name, role, stageRoles: options.isAdmin ? ['admin'] : [] }
    await putProfile(profile)
    return { profile, credentials }
  },
  update: async (id, name, role) => {
    const existing = get().profiles.find((profile) => profile.id === id)
    if (!existing) return
    await putProfile({ ...existing, name, role })
  },
  // If this change adds or removes 'admin', that's not just a label edit - it has to go
  // through core-backend first (see useWorkspaceStore.ts's setMemberAdmin) to actually change
  // that person's CouchDB account role, which is what the roster validator really checks. Only
  // writes the roster doc (with whatever the *rest* of the requested stageRoles are too, not
  // just the admin bit) once that backend call succeeds - the backend, not this store, is the
  // authority on "at least one admin must remain" (it can see the real current admin count;
  // this store only has whatever's synced to this device). No special-casing needed at the
  // call site (BandManagementView.tsx's "Stage-Rollen anpassen" stays a single call, same as
  // before admin existed) - the admin-transition detection lives here.
  updateStageRoles: async (id, stageRoles) => {
    const existing = get().profiles.find((profile) => profile.id === id)
    if (!existing) return false
    const wasAdmin = existing.stageRoles.includes('admin')
    const willBeAdmin = stageRoles.includes('admin')
    const workspace = activeWorkspace()
    // Local-only workspace (see the Tier-A follow-up): no CouchDB account or validator exists
    // yet for the backend call below to act on - this stays a plain local edit.
    if (wasAdmin !== willBeAdmin && isServerConnected(workspace)) {
      const ok = await useWorkspaceStore.getState().setMemberAdmin(workspace?.id ?? '', id, willBeAdmin)
      if (!ok) return false
      // This device's own admin-UI gate has to track its own profile's admin bit, or a device
      // that just demoted itself would keep offering admin controls that now 403 (see
      // useWorkspaceStore.ts's setLocalAdminFlag doc comment).
      if (workspace && id === workspace.ownProfileId) {
        useWorkspaceStore.getState().setLocalAdminFlag(workspace.id, willBeAdmin)
      }
    }
    await putProfile({ ...existing, stageRoles })
    return true
  },
  // Deprovisions the member's CouchDB account first (see useWorkspaceStore.ts's removeMember -
  // also where "at least one admin must remain" is actually enforced), only removing the
  // roster doc itself if that succeeds. Local-only workspace (Tier-A follow-up): no account
  // exists yet to deprovision, so this is just a local removal.
  remove: async (id) => {
    const workspace = activeWorkspace()
    if (isServerConnected(workspace)) {
      const ok = await useWorkspaceStore.getState().removeMember(workspace!.id, id)
      if (!ok) return false
    }
    await removeProfile(id)
    return true
  },
  connectToServer: async (serverUrl) => {
    const workspace = activeWorkspace()
    if (!workspace) return null

    const connected = await useWorkspaceStore.getState().connectWorkspace(workspace.id, serverUrl)
    if (!connected) return null

    const results: Array<{ profile: Profile; credentials: NewMemberCredentials }> = []
    for (const profile of get().profiles) {
      if (profile.id === workspace.ownProfileId) continue
      const credentials = await useWorkspaceStore.getState().createMember(workspace.id, {
        profileId: profile.id,
        isAdmin: profile.stageRoles.includes('admin'),
      })
      if (credentials) results.push({ profile, credentials })
    }
    return results
  },
}))
