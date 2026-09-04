import { useCallback, useState } from 'react'
import { AppMenu } from './components/AppMenu'
import { Dashboard } from './components/Dashboard'
import { DialogHost } from './components/DialogHost'
import { JoinBandView } from './components/JoinBandView'
import { LibraryView } from './components/LibraryView'
import { ProfileRolePickerView } from './components/ProfileRolePickerView'
import { RosterSetupView } from './components/RosterSetupView'
import { SystemView } from './components/SystemView'
import { MODE_LABEL, type Mode } from './lib/modes'
import { type TrackedSync } from './lib/trackedSync'
import { useAudioSyncReconciler } from './lib/useAudioSyncReconciler'
import { useClockSync } from './lib/useClockSync'
import { useFullscreenOnLaunch } from './lib/useFullscreen'
import { usePresenceReporter } from './lib/usePresenceReporter'
import { useShowLogTracker } from './lib/useShowLogTracker'
import { useWakeLock } from './lib/useWakeLock'
import { useWorkspaceResource } from './lib/useWorkspaceResource'
import { startWorkspaceSync } from './lib/workspaceDb'
import { useActiveProfileStore } from './store/useActiveProfileStore'
import { useDashboardsStore } from './store/useDashboardsStore'
import { useDeviceTriggerListenerStore } from './store/useDeviceTriggerListenerStore'
import { useDevicesStore } from './store/useDevicesStore'
import { useEditModeStore } from './store/useEditModeStore'
import { usePluginsStore } from './store/usePluginsStore'
import { usePresenceStore } from './store/usePresenceStore'
import { useProfilesStore } from './store/useProfilesStore'
import { useRosterSetupStore } from './store/useRosterSetupStore'
import { useSetlistsStore } from './store/useSetlistsStore'
import { useShowLogStore } from './store/useShowLogStore'
import { useShowStateStore } from './store/useShowStateStore'
import { useSongsStore } from './store/useSongsStore'
import { useSongVariantsStore } from './store/useSongVariantsStore'
import { deriveSyncStatus, useSyncStore } from './store/useSyncStore'
import { useWorkspaceStore } from './store/useWorkspaceStore'

// Stable references, not inline lambdas - useWorkspaceResource's effect depends on these by
// identity, so a fresh arrow function on every render would re-run it on every render too,
// not just on a real workspace change.
async function noopInit() {}
function noopStart(): TrackedSync | null {
  return null
}

function App() {
  const [mode, setMode] = useState<Mode>('live')
  const [menuOpen, setMenuOpen] = useState(false)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const hasAnyWorkspace = useWorkspaceStore((state) => state.workspaces.length > 0)
  const activeWorkspacePassword = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.couchPassword,
  )
  const activeWorkspaceIsAdmin = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false,
  )
  const activeWorkspaceUsername = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.username,
  )
  // undefined: never decided yet (show ProfileRolePickerView below) - distinct from '',
  // "explicitly chose no profile" (see useActiveProfileStore.ts).
  const activeProfileId = useActiveProfileStore((state) => state.byWorkspace[activeWorkspaceId])
  const rosterSetupDone = useRosterSetupStore((state) => state.completedFor[activeWorkspaceId] ?? false)
  // Set only by addWorkspace (the founding device), never by joinAsMember/activateProfile/
  // joinWithPassword - see needsRosterSetup's doc comment below.
  const foundedHere = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.ownProfileId !== undefined,
  )
  const isEditingDashboard = useEditModeStore((state) => state.isEditing)
  const syncStatus = useSyncStore((state) => deriveSyncStatus(state.streams))
  useFullscreenOnLaunch()
  useWakeLock()
  useShowLogTracker()

  // The one and only live CouchDB sync for the whole app (see workspaceDb.ts) - every store
  // below still runs its own init (loading + a local, filtered change listener for just its
  // own document kind), but none of them starts an independent remote sync anymore. No
  // credentials stored yet (JoinBandView below hasn't been completed) just means no sync
  // starts - joining re-triggers this.
  const startSync = useCallback(
    (workspaceId: string): TrackedSync | null => {
      if (!activeWorkspacePassword || !activeWorkspaceUsername) return null
      // Per-person-accounts follow-up: the username is whatever this device's own personal
      // account turned out to be (stored per-Workspace, no longer a fixed derivable formula -
      // see useWorkspaceStore.ts's doc comment on `Workspace.username`).
      return startWorkspaceSync(workspaceId, {
        username: activeWorkspaceUsername,
        password: activeWorkspacePassword,
      })
    },
    [activeWorkspacePassword, activeWorkspaceUsername],
  )
  useWorkspaceResource(noopInit, startSync, activeWorkspaceId)

  useWorkspaceResource(useSongsStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useSongVariantsStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useSetlistsStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useShowStateStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(usePluginsStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useDevicesStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useDashboardsStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useProfilesStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useWorkspaceStore((state) => state.initNameSync), noopStart, activeWorkspaceId)
  useWorkspaceResource(useShowLogStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(usePresenceStore((state) => state.init), noopStart, activeWorkspaceId)
  useWorkspaceResource(useDeviceTriggerListenerStore((state) => state.init), noopStart, activeWorkspaceId)
  useAudioSyncReconciler(activeWorkspaceId)
  useClockSync()
  // BandManagementView.tsx's presence indicators (see #21 ninth follow-up, at Marco's explicit
  // request) - reports only while a *real* profile is active, matching activeProfileId's own
  // '' vs undefined distinction (useActiveProfileStore.ts's doc comment) - neither "never
  // decided yet" nor "explicitly no profile" should show this device as anyone in particular.
  usePresenceReporter(activeWorkspaceId, activeProfileId || undefined)

  // Three full-screen gates before the normal mode tabs (see #21, and the #21 follow-up that
  // added needsRosterSetup): join/found the band first (no band at all yet), then - only for a
  // founding admin whose roster is still empty - build the roster, then pick a profile
  // (activeProfileId was never decided). The founding admin's real first task is populating the
  // roster, not landing on a picker whose only guidance for an empty list is "go do this in the
  // menu instead" - a plain member joining an already-populated band skips straight from
  // needsJoin to needsProfile, unaffected. All three stay reachable again later
  // (BandManagementView.tsx's "Band" tab - band/profile switching plus every roster control,
  // 2026-09-02 follow-up), this only covers the very first time.
  //
  // needsJoin deliberately checks "no band at all" (`workspaces.length === 0`), not "no
  // credentials yet" (`!activeWorkspacePassword`) - see the Tier-A local-only-founding
  // follow-up: a solo-founded band has no credentials for a long time on purpose (never
  // connected to a server), and that's a legitimate steady state, not an interrupted join.
  //
  // 2026-09-02 fifth follow-up, at Marco's explicit request, after this destroyed his real
  // S.O.A.T. workspace: `foundedHere` added here alongside `rosterSetupDone`, replacing an
  // earlier `profileCount === 0` attempt at the same fix (reverted - it broke the sixth
  // follow-up's multi-step founding wizard below, which deliberately keeps this screen open
  // *while* `profiles.length` grows past 0). `rosterSetupDone` is local, per-*device* state
  // (useRosterSetupStore's own doc comment: "not derived from profiles.length > 0" -
  // deliberately, so an admin adding several members in one founding sitting doesn't get
  // bumped ahead after just the first one). That's fine for the device that actually founded
  // the band, but the universal admin-recovery code (RosterMemberSchema's doc comment in
  // shared-types) means an admin can now land on a *device that never personally founded this
  // workspace at all* - which read `rosterSetupDone` as false and sent an admin of an
  // already-populated, already-real band back into "build your roster from scratch". Its "Neu
  // anfangen" escape hatch deletes the *entire remote workspace* (RosterSetupView.tsx's own doc
  // comment: only ever meant for "typo in the band name, nobody's been added yet") - reached
  // here for a real, populated band, that's how S.O.A.T. was actually destroyed. `foundedHere`
  // (`Workspace.ownProfileId` is set only by `addWorkspace`, never by
  // joinAsMember/activateProfile/joinWithPassword - useWorkspaceStore.ts's doc comment) is a
  // timing-independent fix, unlike the reverted `profileCount === 0` attempt: a recovering
  // admin never sees this screen at all, regardless of how far local sync has gotten.
  // RosterSetupView.tsx's own fix (only offering "Neu anfangen" while `profiles.length === 0`)
  // remains the actual backstop against the delete itself, for anyone who somehow still lands
  // here for a populated workspace (e.g. `rosterSetupDone` cleared on the founder's own device).
  const needsJoin = !hasAnyWorkspace
  const needsRosterSetup = !needsJoin && activeWorkspaceIsAdmin && !rosterSetupDone && foundedHere
  const needsProfile = !needsJoin && !needsRosterSetup && activeProfileId === undefined
  const inOnboarding = needsJoin || needsRosterSetup || needsProfile

  return (
    <div className="relative h-dvh">
      {needsJoin && <JoinBandView />}
      {needsRosterSetup && <RosterSetupView />}
      {needsProfile && <ProfileRolePickerView />}
      {!inOnboarding && (
        <>
          {mode === 'live' && <Dashboard />}
          {mode === 'library' && <LibraryView />}
          {mode === 'system' && <SystemView />}
        </>
      )}

      {/* Band, Theme, Fullscreen, Edit-Lock and screen navigation live behind one menu
          button, not as permanently visible controls: none of them is touched often, and
          at a real touch-target size they don't fit along one edge anyway. Hidden entirely
          while the dashboard is unlocked for editing - it used to sit exactly where a
          bottom-of-grid widget's resize handle needed to be, and the edit toolbar's own
          "Fertig" button is already the way back out. Also hidden during all three onboarding
          gates above: each one is already fully self-sufficient (join, create-a-band, and the
          password fallback on JoinBandView; adding members on RosterSetupView; picking a
          profile on ProfileRolePickerView), and the menu's Band/Profil/Sync sections either
          have nothing real to show yet or just duplicate whichever gate is already the entire
          screen - only confusing, not-yet-functional controls during onboarding. */}
      {!isEditingDashboard && !inOnboarding && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="relative flex h-12 items-center gap-2 rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
          >
            <span className="text-xl leading-none">☰</span>
            {MODE_LABEL[mode]}
            {/* Discreet at-a-glance sync status (see #33) - a dot here, not a full label,
                since this button is always on screen; the detailed SyncIndicator with its
                text/percentage lives in SystemView's Einstellungen tab for when someone
                actually wants it. */}
            <span
              title={{ idle: 'Synchronisiert', syncing: 'Synchronisiere…', offline: 'Offline', error: 'Fehler' }[syncStatus]}
              className={`absolute right-1 top-1 h-2 w-2 rounded-full ${
                {
                  idle: 'bg-green-500',
                  syncing: 'bg-blue-500 animate-pulse',
                  offline: 'bg-gray-400',
                  error: 'bg-red-500',
                }[syncStatus]
              }`}
            />
          </button>
        </div>
      )}

      {menuOpen && !inOnboarding && (
        <AppMenu mode={mode} onSelectMode={setMode} onClose={() => setMenuOpen(false)} />
      )}

      <DialogHost />
    </div>
  )
}

export default App
