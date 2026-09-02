import { create } from 'zustand'
import type { WorkspaceRoster, WorkspaceSummary } from 'shared-types'
import { randomId } from '../lib/id'
import { getStageServerUrl } from '../lib/stageServer'
import { persist } from 'zustand/middleware'
import { useDialogStore } from './useDialogStore'

export interface Workspace {
  id: string
  name: string
  /** CouchDB password for this workspace's sync user (see #12). Undefined until either
   * `addWorkspace` provisions it (new workspace) or `joinWithPassword`/`joinAsMember` records
   * one entered for an already-existing workspace (join flow). */
  couchPassword?: string
  /** This device's own personal CouchDB username (per-person-accounts follow-up) - no longer
   * derivable from a fixed formula the way `workspaceUsername()` used to be, since every
   * roster member now has their own account. Always set alongside `couchPassword`. */
  username?: string
  /** The roster `Profile.id` this device's account corresponds to (the founder's own first
   * profile reuses it - see `RosterSetupView.tsx`/`useProfilesStore.ts`'s `create`). Lets the
   * app know which roster entry "is" this device without any real login/identity system. */
  ownProfileId?: string
  /** Whether this device's account holds the admin role. CouchDB enforces the real
   * consequences of this itself (`_design/roster`'s validator checks `userCtx.roles`, not this
   * flag) - `isAdmin` here only decides what the UI *offers*; a wrong value here can't grant
   * unearned access, only mis-show/hide controls that would fail server-side anyway. */
  isAdmin?: boolean
}

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string
  setActiveWorkspace: (id: string) => void
  /** Local-only, no network call: keeps `Workspace.isAdmin` (this device's own admin-UI gate)
   * in sync with the roster whenever *this device's own* profile's admin bit changes -
   * useProfilesStore.ts's `updateStageRoles` calls this right after a successful
   * setMemberAdmin, so a device that just demoted itself loses its admin controls
   * immediately instead of continuing to offer actions that would now 403. */
  setLocalAdminFlag: (workspaceId: string, isAdmin: boolean) => void
  addWorkspace: (name: string) => Promise<Workspace | null>
  /** Provisions this already-locally-founded workspace's founder account against a real
   * Stage-Server for the first time (see the Tier-A local-only-founding follow-up) - the
   * workspace/founder ids were already decided locally at founding time, so this just calls the
   * same `POST /workspaces` route `addWorkspace` calls for a brand-new one, only later. Does
   * NOT touch any other roster member's account - useProfilesStore.ts's `connectToServer`
   * calls this first, then provisions everyone else via `createMember`. */
  connectWorkspace: (workspaceId: string, serverUrl: string) => Promise<boolean>
  deleteWorkspace: (id: string) => Promise<boolean>
  joinWithPassword: (id: string, username: string, password: string, isAdmin: boolean) => void
  createMember: (
    workspaceId: string,
    options: { profileId: string; password?: string; isAdmin?: boolean },
  ) => Promise<{ username: string; password: string } | null>
  setMemberAdmin: (workspaceId: string, profileId: string, isAdmin: boolean) => Promise<boolean>
  removeMember: (workspaceId: string, profileId: string) => Promise<boolean>
  /** Resets *another* admin's PIN to a fresh, human-relayable 4-digit one (2026-08-31, the
   * "another admin's session is available" escape hatch for a locked-out admin). 2026-09-02
   * second follow-up: only meaningful for an admin target now - a non-admin has no PIN at all
   * (`RosterMemberSchema`'s doc comment in shared-types), server-side rejects a non-admin
   * target. `null` on failure (not this workspace's admin, target not an admin, or
   * unreachable). */
  resetMemberPassword: (workspaceId: string, profileId: string) => Promise<{ username: string; password: string } | null>
  /** Self-assigns or changes *this device's own* 4-digit admin PIN (2026-09-02 second
   * follow-up, at Marco's explicit request: "Bei Admins ... [ein] 4 stelliger Code, der selbst
   * vergeben werden kann"). Strictly self-service - only works while this device is already
   * authenticated as the exact admin profile being changed (uses its own current
   * `couchPassword` as proof); to set someone *else's* PIN, use `resetMemberPassword` instead.
   * `null` on failure (not currently this profile, wrong current PIN, or unreachable). */
  setOwnPin: (workspaceId: string, profileId: string, newPin: string) => Promise<{ username: string; password: string } | null>
  /** Fetches a workspace's *current* standing access code (2026-09-01 WiFi-style redesign, at
   * Marco's explicit request after losing every device's cached admin credential at once with
   * no way back in) - admin-only, does NOT change the code, just displays/re-displays it
   * (`InviteBandView.tsx`). Unlike the old per-person invite this replaces, the code never
   * expires on its own and isn't tied to any one person - see `RosterMemberSchema`'s doc
   * comment in shared-types for the full design. */
  getAccessCode: (workspaceId: string) => Promise<{ code: string } | null>
  /** Rotates a workspace's standing access code to a fresh one (e.g. "the code leaked") -
   * admin-only, immediately invalidates the old code for anyone who only knew that one. */
  rotateAccessCode: (workspaceId: string) => Promise<{ code: string } | null>
  /** Every band the currently-configured Stage-Server hosts, with no code needed at all - the
   * WiFi "which networks are in range" step, `JoinBandView.tsx`'s first screen. */
  listWorkspaces: () => Promise<WorkspaceSummary[] | null>
  /** Second step of the self-service join (2026-09-01 redesign) - resolves one workspace's
   * roster (names/roles only, no credentials) using its standing code, for JoinBandView.tsx to
   * render a "who are you" picker. `isAdmin` per member (2026-09-02 second follow-up) tells the
   * picker whether tapping that name needs a code prompt at all - a non-admin entry has no
   * password concept whatsoever anymore, see `RosterMemberSchema`'s doc comment in shared-types. */
  fetchRoster: (workspaceId: string, code: string) => Promise<WorkspaceRoster | null>
  /** Third and final step - the device has picked which roster entry is theirs. For a non-admin
   * target, `code` is ignored entirely and this always succeeds, silently (re)issuing a working
   * account. For an admin target, `code` must be either that admin's own self-assigned 4-digit
   * PIN or the universal recovery code (the workspace access code's own last 4 digits, which
   * always works for any admin here) - see `RosterMemberSchema`'s doc comment for the full
   * reasoning. Adds or updates the workspace locally and activates it on success. */
  joinAsMember: (
    workspaceId: string,
    workspaceName: string,
    code: string,
    profileId: string,
    password?: string,
  ) => Promise<Workspace | null>
  /** Re-authenticates this already-connected device as a *different* roster member within the
   * *same* already-joined workspace (2026-09-02 follow-up, at Marco's explicit request -
   * replaces the removed `ProfileSwitcher.tsx`, which let any device silently display as anyone
   * with zero credential check; switching bands/profiles now lives in BandManagementView.tsx's
   * "Band" tab). Proves the calling device already holds some valid account for this workspace
   * (its own current credentials) rather than the workspace's shared code - same trust level,
   * same outcomes as `joinAsMember` (non-admin: always succeeds, `password` ignored; admin:
   * own PIN or the universal recovery code). Updates this workspace's stored
   * credentials/isAdmin on success; the caller is responsible for updating
   * `useActiveProfileStore`'s own "who am I displaying as" pointer afterward. */
  activateProfile: (workspaceId: string, profileId: string, password?: string) => Promise<Workspace | null>
}

/**
 * Which workspace (band) is active on this device. Data isolation itself lives in
 * workspaceDb.ts (separate PouchDB/CouchDB databases per workspace) - this store only tracks
 * the selection and credentials, persisted so each tablet remembers its last-used band and
 * doesn't have to be told its password again.
 *
 * Per-person-accounts follow-up: every roster member has their own CouchDB account now, not a
 * shared one - `Workspace.username`/`ownProfileId` track *this device's* specific account.
 * `isAdmin` decides which UI is offered; CouchDB itself is what actually enforces admin-only
 * writes (`_design/roster`'s role-based validator, core-backend's `verifyAdmin`).
 *
 * Starts with zero known workspaces (see #21's onboarding rework) - a brand-new device out of
 * the box, or fresh from a Stage-Server it's never talked to, genuinely knows nothing yet;
 * `JoinBandView.tsx` is what it sees first, offering both "join" and "start a new band" equally.
 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: '',
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setLocalAdminFlag: (workspaceId, isAdmin) => {
        set({ workspaces: get().workspaces.map((w) => (w.id === workspaceId ? { ...w, isAdmin } : w)) })
      },
      // See the Tier-A local-only-founding follow-up: `docs/02`'s Stufe 1 promises this works
      // with zero hardware, so when no Stage-Server is configured at all, this founds the band
      // entirely locally instead of refusing - same Workspace shape, `username`/`couchPassword`
      // just stay unset (App.tsx's startSync guard already no-ops correctly on that). The
      // workspace/founder ids are decided right here either way, so `connectWorkspace` below can
      // provision this exact workspace against a real server later without anything changing.
      // A server that *is* configured but unreachable still fails loudly, on purpose - silently
      // downgrading to local-only there would hide a real connectivity problem.
      addWorkspace: async (name) => {
        const id = randomId()
        const founderId = randomId()
        const base = getStageServerUrl()

        if (!base) {
          const workspace: Workspace = { id, name, ownProfileId: founderId, isAdmin: true }
          set({ workspaces: [...get().workspaces, workspace], activeWorkspaceId: workspace.id })
          return workspace
        }

        let credentials: { username: string; password: string }
        try {
          const response = await fetch(`${base}/workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId: id, founderId, workspaceName: name }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          credentials = (await response.json()) as { username: string; password: string }
        } catch (err) {
          console.error('Failed to provision workspace', err)
          void useDialogStore.getState().alert('Stage-Server nicht erreichbar - Workspace konnte nicht angelegt werden.')
          return null
        }

        // The creating device becomes this workspace's first admin (see #56) with its own
        // personal account - `ownProfileId` is the same id RosterSetupView.tsx's first-ever
        // profile reuses, so that roster doc and this account line up without a round trip.
        const workspace: Workspace = {
          id,
          name,
          couchPassword: credentials.password,
          username: credentials.username,
          ownProfileId: founderId,
          isAdmin: true,
        }
        set({ workspaces: [...get().workspaces, workspace], activeWorkspaceId: workspace.id })
        return workspace
      },
      connectWorkspace: async (workspaceId, serverUrl) => {
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!workspace || !workspace.ownProfileId) return false

        try {
          const response = await fetch(`${serverUrl}/workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, founderId: workspace.ownProfileId, workspaceName: workspace.name }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const credentials = (await response.json()) as { username: string; password: string }

          set({
            workspaces: get().workspaces.map((w) =>
              w.id === workspaceId ? { ...w, couchPassword: credentials.password, username: credentials.username } : w,
            ),
          })
          return true
        } catch (err) {
          console.error('Failed to connect workspace to server', err)
          void useDialogStore.getState().alert('Verbindung zum Stage-Server fehlgeschlagen.')
          return false
        }
      },
      // Admin-only in the UI (BandManagementView.tsx checks isAdmin before offering this) and
      // admin-verified server-side too (core-backend's DELETE /workspaces/:id). Irreversible:
      // the Stage-Server destroys the workspace's CouchDB database and every member's personal
      // account (workspaceProvisioning.ts's deprovisionWorkspace) - any other device that
      // already joined only discovers it's gone the next time its own sync fails, there's no
      // mechanism to notify them. A local-only workspace (Tier-A follow-up) has no server-side
      // counterpart to tear down yet, so this just drops it locally - this is what
      // RosterSetupView.tsx's "Neu anfangen" escape hatch relies on for a solo-founded band.
      deleteWorkspace: async (id) => {
        const workspace = get().workspaces.find((w) => w.id === id)
        if (!workspace?.isAdmin) return false

        if (workspace.username) {
          const base = getStageServerUrl()
          if (!base || !workspace.couchPassword) return false

          try {
            const response = await fetch(`${base}/workspaces/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword }),
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
          } catch (err) {
            console.error('Failed to delete workspace', err)
            void useDialogStore.getState().alert('Band konnte nicht gelöscht werden - Stage-Server nicht erreichbar oder Fehler beim Löschen.')
            return false
          }
        }

        const remainingWorkspaces = get().workspaces.filter((w) => w.id !== id)
        set({
          workspaces: remainingWorkspaces,
          activeWorkspaceId: get().activeWorkspaceId === id ? (remainingWorkspaces[0]?.id ?? '') : get().activeWorkspaceId,
        })
        return true
      },
      // The "Passwort direkt eingeben" fallback in JoinBandView.tsx - for a workspace this
      // device doesn't know about locally yet, so unlike a plain update this has to be able to
      // add a brand-new entry too. Needs a username now (per-person-accounts follow-up - there's
      // no longer one fixed, derivable username per workspace) and a self-declared `isAdmin`
      // (nothing here verifies it - a wrong guess only mis-shows UI, CouchDB enforces the real
      // thing). `name` falls back to the raw id since there's nowhere to look up a real display
      // name for this path (unlike listWorkspaces/joinAsMember, which get one from the server).
      joinWithPassword: (id, username, password, isAdmin) => {
        const existing = get().workspaces.find((w) => w.id === id)
        const workspace: Workspace = existing
          ? { ...existing, couchPassword: password, username, isAdmin }
          : { id, name: id, couchPassword: password, username, isAdmin }
        set({
          workspaces: existing
            ? get().workspaces.map((w) => (w.id === id ? workspace : w))
            : [...get().workspaces, workspace],
          activeWorkspaceId: id,
        })
      },
      // Provisions one new roster member's personal CouchDB account (see per-person-accounts
      // follow-up). Does NOT write the `profiles:<profileId>` roster doc itself - the caller
      // (BandManagementView.tsx) does that via its own already-admin sync connection right
      // after this resolves, same as any other roster edit.
      createMember: async (workspaceId, options) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
          return null
        }

        try {
          const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adminUsername: workspace.username,
              adminPassword: workspace.couchPassword,
              profileId: options.profileId,
              password: options.password,
              isAdmin: options.isAdmin,
            }),
          })
          if (!response.ok) {
            if (response.status === 403) {
              void useDialogStore.getState().alert('Dieses Gerät ist kein Admin mehr - Aktion nicht möglich.')
            } else {
              throw new Error(`HTTP ${response.status}`)
            }
            return null
          }
          return (await response.json()) as { username: string; password: string }
        } catch (err) {
          console.error('Failed to create member', err)
          void useDialogStore.getState().alert('Mitglied konnte nicht angelegt werden - Stage-Server nicht erreichbar.')
          return null
        }
      },
      // Grants or revokes admin for an already-provisioned member. The server rejects a revoke
      // that would leave zero admins (see core-backend's countOtherAdmins) - that specific
      // failure gets its own message, everything else falls back to a generic one.
      setMemberAdmin: async (workspaceId, profileId, isAdmin) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
          return false
        }

        try {
          const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(profileId)}/admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword, isAdmin }),
          })
          if (!response.ok) {
            if (response.status === 400) {
              void useDialogStore.getState().alert('Mindestens ein Admin muss bestehen bleiben.')
            } else if (response.status === 403) {
              void useDialogStore.getState().alert('Dieses Gerät ist kein Admin mehr - Aktion nicht möglich.')
            } else {
              throw new Error(`HTTP ${response.status}`)
            }
            return false
          }
          return true
        } catch (err) {
          console.error('Failed to change admin status', err)
          void useDialogStore.getState().alert('Adminstatus konnte nicht geändert werden - Stage-Server nicht erreichbar.')
          return false
        }
      },
      // Deprovisions one member's personal CouchDB account. Same last-admin rejection as
      // setMemberAdmin above. The roster doc itself is removed separately by the caller.
      removeMember: async (workspaceId, profileId) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
          return false
        }

        try {
          const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(profileId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword }),
          })
          if (!response.ok) {
            if (response.status === 400) {
              void useDialogStore.getState().alert('Mindestens ein Admin muss bestehen bleiben.')
            } else if (response.status === 403) {
              void useDialogStore.getState().alert('Dieses Gerät ist kein Admin mehr - Aktion nicht möglich.')
            } else {
              throw new Error(`HTTP ${response.status}`)
            }
            return false
          }
          return true
        } catch (err) {
          console.error('Failed to remove member', err)
          void useDialogStore.getState().alert('Mitglied konnte nicht entfernt werden - Stage-Server nicht erreichbar.')
          return false
        }
      },
      resetMemberPassword: async (workspaceId, profileId) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
          return null
        }

        try {
          const response = await fetch(
            `${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(profileId)}/reset-password`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword }),
            },
          )
          if (!response.ok) {
            if (response.status === 403) {
              void useDialogStore.getState().alert('Dieses Gerät ist kein Admin mehr - Aktion nicht möglich.')
            } else if (response.status === 400) {
              void useDialogStore.getState().alert('Nur Admin-Konten haben einen Code zum Zurücksetzen.')
            } else {
              throw new Error(`HTTP ${response.status}`)
            }
            return null
          }
          return (await response.json()) as { username: string; password: string }
        } catch (err) {
          console.error('Failed to reset member password', err)
          void useDialogStore.getState().alert('Passwort konnte nicht zurückgesetzt werden - Stage-Server nicht erreichbar.')
          return null
        }
      },
      setOwnPin: async (workspaceId, profileId, newPin) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.couchPassword || !workspace.username) {
          return null
        }

        let response: Response
        try {
          response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(profileId)}/set-pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callerUsername: workspace.username, callerPassword: workspace.couchPassword, newPin }),
          })
        } catch (err) {
          console.error('Failed to reach Stage-Server to set PIN', err)
          void useDialogStore
            .getState()
            .alert('Stage-Server nicht erreichbar - Netzwerkverbindung und Stage-Server-Adresse prüfen, dann erneut versuchen.')
          return null
        }

        if (!response.ok) {
          if (response.status === 403) {
            void useDialogStore.getState().alert('Aktuelles Passwort falsch, oder dieses Gerät ist kein Admin mehr.')
          } else if (response.status === 400) {
            void useDialogStore.getState().alert('PIN muss genau 4 Ziffern haben.')
          } else {
            console.error('Failed to set PIN', new Error(`HTTP ${response.status}`))
            void useDialogStore.getState().alert('PIN konnte nicht gesetzt werden (Serverfehler) - bitte erneut versuchen.')
          }
          return null
        }

        try {
          const resolved = (await response.json()) as { username: string; password: string; isAdmin: boolean }
          const updated: Workspace = { ...workspace, couchPassword: resolved.password, username: resolved.username, isAdmin: resolved.isAdmin }
          set({ workspaces: get().workspaces.map((w) => (w.id === workspaceId ? updated : w)) })
          return { username: resolved.username, password: resolved.password }
        } catch (err) {
          console.error('Failed to parse set-pin response', err)
          void useDialogStore.getState().alert('PIN konnte nicht gesetzt werden (unerwartete Server-Antwort) - bitte erneut versuchen.')
          return null
        }
      },
      getAccessCode: async (workspaceId) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
          return null
        }

        try {
          const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/access-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return (await response.json()) as { code: string }
        } catch (err) {
          console.error('Failed to fetch access code', err)
          return null
        }
      },
      rotateAccessCode: async (workspaceId) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.isAdmin || !workspace.couchPassword || !workspace.username) {
          return null
        }

        try {
          const response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/access-code/rotate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminUsername: workspace.username, adminPassword: workspace.couchPassword }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return (await response.json()) as { code: string }
        } catch (err) {
          console.error('Failed to rotate access code', err)
          void useDialogStore.getState().alert('Code konnte nicht erneuert werden - Stage-Server nicht erreichbar.')
          return null
        }
      },
      // Public, no auth (2026-09-01 WiFi-style redesign) - the "which networks are in range"
      // step. Doesn't touch local state at all; JoinBandView.tsx just renders the result.
      listWorkspaces: async () => {
        const base = getStageServerUrl()
        if (!base) {
          void useDialogStore.getState().alert('Stage-Server nicht konfiguriert - Beitritt nicht möglich.')
          return null
        }

        let response: Response
        try {
          response = await fetch(`${base}/workspaces`)
        } catch (err) {
          console.error('Failed to reach Stage-Server for workspace list', err)
          void useDialogStore
            .getState()
            .alert('Stage-Server nicht erreichbar - Netzwerkverbindung und Stage-Server-Adresse prüfen, dann erneut versuchen.')
          return null
        }

        if (!response.ok) {
          console.error('Failed to list workspaces', new Error(`HTTP ${response.status}`))
          void useDialogStore.getState().alert('Bands konnten nicht geladen werden (Serverfehler) - bitte erneut versuchen.')
          return null
        }

        try {
          return (await response.json()) as WorkspaceSummary[]
        } catch (err) {
          console.error('Failed to parse workspace list', err)
          void useDialogStore.getState().alert('Bands konnten nicht geladen werden (unerwartete Server-Antwort).')
          return null
        }
      },
      fetchRoster: async (workspaceId, code) => {
        const base = getStageServerUrl()
        if (!base) {
          void useDialogStore.getState().alert('Stage-Server nicht konfiguriert - Beitritt nicht möglich.')
          return null
        }

        // Split from the HTTP-status branch below on purpose (see the 2026-08-31 tablet
        // debugging session): a thrown fetch (network down, cert not trusted on this device,
        // CORS block, ...) and a real wrong-code response from the server are different
        // problems with different fixes - collapsing them into one message sent a real network
        // issue down a completely wrong debugging path.
        let response: Response
        try {
          response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/roster`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          })
        } catch (err) {
          console.error('Failed to reach Stage-Server for roster', err)
          void useDialogStore
            .getState()
            .alert('Stage-Server nicht erreichbar - Netzwerkverbindung und Stage-Server-Adresse prüfen, dann erneut versuchen.')
          return null
        }

        if (!response.ok) {
          if (response.status === 403) {
            void useDialogStore.getState().alert('Falscher Code.')
          } else {
            console.error('Failed to fetch roster', new Error(`HTTP ${response.status}`))
            void useDialogStore.getState().alert('Beitritt fehlgeschlagen (Serverfehler) - bitte erneut versuchen.')
          }
          return null
        }

        try {
          return (await response.json()) as WorkspaceRoster
        } catch (err) {
          console.error('Failed to parse roster response', err)
          void useDialogStore.getState().alert('Beitritt fehlgeschlagen (unerwartete Server-Antwort) - bitte erneut versuchen.')
          return null
        }
      },
      joinAsMember: async (workspaceId, workspaceName, code, profileId, password) => {
        const base = getStageServerUrl()
        if (!base) {
          void useDialogStore.getState().alert('Stage-Server nicht konfiguriert - Beitritt nicht möglich.')
          return null
        }

        let response: Response
        try {
          response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/join/${encodeURIComponent(profileId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, password }),
          })
        } catch (err) {
          console.error('Failed to reach Stage-Server to join', err)
          void useDialogStore
            .getState()
            .alert('Stage-Server nicht erreichbar - Netzwerkverbindung und Stage-Server-Adresse prüfen, dann erneut versuchen.')
          return null
        }

        if (!response.ok) {
          if (response.status === 403) {
            void useDialogStore.getState().alert('Falscher Code oder falsches Passwort.')
          } else if (response.status === 404) {
            void useDialogStore.getState().alert('Unbekanntes Mitglied.')
          } else {
            console.error('Failed to join as member', new Error(`HTTP ${response.status}`))
            void useDialogStore.getState().alert('Beitritt fehlgeschlagen (Serverfehler) - bitte erneut versuchen.')
          }
          return null
        }

        try {
          const resolved = (await response.json()) as { username: string; password: string; isAdmin: boolean }

          const existing = get().workspaces.find((w) => w.id === workspaceId)
          const workspace: Workspace = existing
            ? { ...existing, couchPassword: resolved.password, username: resolved.username, isAdmin: resolved.isAdmin }
            : {
                id: workspaceId,
                name: workspaceName,
                couchPassword: resolved.password,
                username: resolved.username,
                isAdmin: resolved.isAdmin,
              }
          set({
            workspaces: existing
              ? get().workspaces.map((w) => (w.id === workspaceId ? workspace : w))
              : [...get().workspaces, workspace],
            activeWorkspaceId: workspaceId,
          })
          return workspace
        } catch (err) {
          console.error('Failed to parse join response', err)
          void useDialogStore.getState().alert('Beitritt fehlgeschlagen (unerwartete Server-Antwort) - bitte erneut versuchen.')
          return null
        }
      },
      activateProfile: async (workspaceId, profileId, password) => {
        const base = getStageServerUrl()
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        if (!base || !workspace?.username || !workspace.couchPassword) {
          return null
        }

        let response: Response
        try {
          response = await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(profileId)}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callerUsername: workspace.username, callerPassword: workspace.couchPassword, password }),
          })
        } catch (err) {
          console.error('Failed to reach Stage-Server to activate profile', err)
          void useDialogStore
            .getState()
            .alert('Stage-Server nicht erreichbar - Netzwerkverbindung und Stage-Server-Adresse prüfen, dann erneut versuchen.')
          return null
        }

        if (!response.ok) {
          if (response.status === 403) {
            void useDialogStore.getState().alert('Falsches Passwort.')
          } else if (response.status === 404) {
            void useDialogStore.getState().alert('Unbekanntes Mitglied.')
          } else {
            console.error('Failed to activate profile', new Error(`HTTP ${response.status}`))
            void useDialogStore.getState().alert('Wechsel fehlgeschlagen (Serverfehler) - bitte erneut versuchen.')
          }
          return null
        }

        try {
          const resolved = (await response.json()) as { username: string; password: string; isAdmin: boolean }
          const updated: Workspace = {
            ...workspace,
            couchPassword: resolved.password,
            username: resolved.username,
            isAdmin: resolved.isAdmin,
          }
          set({ workspaces: get().workspaces.map((w) => (w.id === workspaceId ? updated : w)) })
          return updated
        } catch (err) {
          console.error('Failed to parse activate-profile response', err)
          void useDialogStore.getState().alert('Wechsel fehlgeschlagen (unerwartete Server-Antwort) - bitte erneut versuchen.')
          return null
        }
      },
    }),
    { name: 'stageboard-workspaces' },
  ),
)
