import { useMemo, useState } from 'react'
import { PRESENCE_TIMEOUT_MS, STAGE_ROLES, type Profile, type StageRole } from 'shared-types'
import { InviteBandView } from './InviteBandView'
import { JoinBandView } from './JoinBandView'
import { RowActionButton, RowActionsMenu, RowMenuButton } from './RowActionsMenu'
import { STAGE_ROLE_LABELS } from '../lib/stageRoleLabels'
import { useNow } from '../lib/useNow'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useDialogStore } from '../store/useDialogStore'
import { usePresenceStore } from '../store/usePresenceStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * SystemView.tsx's "Band" tab (see 2026-08-30 menu-decluttering follow-up) - every band/roster
 * *management* action lives here now: create a band (open to everyone, matches
 * `addWorkspace`'s existing rules), delete a band, invite people to it, and
 * create/rename/adjust-stage-roles/delete a roster member (all admin-only, enforced
 * server-side already by #56's CouchDB validation - the `isAdmin` checks here are just the UI
 * not offering a control that would fail).
 *
 * 2026-09-02 follow-up, at Marco's explicit request: this is now also where switching *which*
 * band and *which* roster member this device is showing as happens - `AppMenu.tsx`'s old "Wer
 * bin ich" section (`WorkspaceSwitcher.tsx`/`ProfileSwitcher.tsx`, both deleted) let any device
 * silently switch to displaying as anyone with zero credential check, which stopped making
 * sense once real per-person accounts existed. Clicking a band's name here (`setActiveWorkspace`)
 * makes it active; clicking "Auswählen" on a roster row either switches immediately (a local-only
 * band, Tier-A follow-up, has no account to check at all) or activates it via `activateProfile`.
 *
 * 2026-09-02 *second* follow-up, at Marco's explicit request (after getting locked out testing
 * the first follow-up's design, twice in one day): only admin accounts have any password
 * concept at all now. Picking a non-admin profile here always just works, immediately, no form
 * at all - `handlePickProfile` below skips straight to `performActivate`. Picking an admin
 * profile opens the inline 4-digit code prompt: either that admin's own self-assigned PIN, or
 * the *universal* recovery code that always works for any admin in this workspace - the last 4
 * digits of the band's own standing access code (shown in "Einladen" above). "Meinen PIN
 * setzen" is the self-service counterpart, for the currently-active admin profile to choose its
 * own memorable PIN instead of always relying on the universal code.
 *
 * No band *rename* here - it existed briefly, then was pulled back out (see the still-open
 * follow-up issue) because it was local-only: a workspace's name was never synced anywhere, so
 * a rename never reached devices that had already joined.
 *
 * Rename and stage-roles are two separate actions on a member, not one combined "edit" form -
 * matches how they were asked for. "Stage-Rollen anpassen" (#57 follow-up) edits
 * `profile.stageRoles`, the closed multi-value field that gates widget/dashboard visibility -
 * also shown directly on the roster row (badges), not only inside the dialog.
 *
 * 2026-09-02 sixth follow-up, at Marco's explicit request ("I don't see the necessity for
 * it"): the free-text instrument/function field (`profile.role`, "Instrument/Funktion ändern")
 * is gone entirely - `stageRoles` is the only classification a profile carries now.
 *
 * Per-person-accounts follow-up (2026-08-30): "Admin" lives right in `stageRoles` alongside the
 * others, same checkbox dialog - but unlike the others it's not just a label. Every roster
 * member now has their own real CouchDB account (not a shared one - see useWorkspaceStore.ts's
 * doc comment on `Workspace.username`), and toggling 'admin' in `useProfilesStore.ts`'s
 * `updateStageRoles` actually changes that account's role server-side first, which is what
 * `_design/roster`'s validator really checks. "Löschen" is disabled for the sole remaining admin
 * (client-side, for instant feedback - same pattern DashboardManager.tsx uses for the last public
 * dashboard); the actual, unbypassable enforcement is server-side (core-backend rejects
 * removing/demoting the last admin outright).
 *
 * 2026-09-01 redesign, at Marco's request (after losing every device's cached admin credential
 * at once with no way back in): onboarding is now one *workspace-level* "Einladen" button next
 * to each band's name (not a per-roster-row or per-new-member action) - it shows this band's
 * standing, non-expiring access code (`InviteBandView.tsx`, `useWorkspaceStore.ts`'s
 * `getAccessCode`/`rotateAccessCode`), WiFi-QR-style, that covers *anyone* joining that band,
 * admin or not, new or already-provisioned, indefinitely (until an admin deliberately rotates
 * it). The joining device browses the Stage-Server's workspace list with no code at all
 * (JoinBandView.tsx's first step), then looks up that one band's roster with the code and
 * self-service-picks who it is - see the second follow-up above for what picking a non-admin vs.
 * an admin entry actually needs. "+ Neues Mitglied" only creates the roster entry now (no PIN
 * field anymore - a non-admin has no password concept at all, and an admin self-assigns their
 * own PIN later, nobody else ever sets one for them); it doesn't show its own invite screen
 * anymore since the one workspace-level code already covers every new member too - immediately,
 * or lazily the first time someone actually picks that name (self-service join auto-provisions
 * an account on the spot when none exists yet, see core-backend's `POST /workspaces/:id/join/:profileId`).
 *
 * "Passwort zurücksetzen" below is the *other*-admin's-help recovery path (only shown for an
 * admin target that isn't this device's own active profile, 2026-09-02 eleventh follow-up -
 * found live: Marco locked his own phone out using it on himself): another admin's already-
 * active session sets a fresh PIN and relays it out of band (in person, a message, ...) - the
 * one-time value is shown once, right after resetting, and never stored or shown again, and
 * critically never updates *this* device's own stored credentials either, unlike "Meinen PIN
 * setzen" - using it on your own row silently breaks your own session with no way to recover
 * the new value. For the "no other admin session exists at all" case, the universal recovery
 * code (above) is what actually solves it.
 *
 * Tier-A local-only-founding follow-up (2026-08-30): a band with no Stage-Server configured
 * founds and builds its roster entirely locally - `activeWorkspace.username` unset is that
 * state, not an error. The "Diese Band läuft nur lokal" banner below is the one way out of it:
 * "Verbinden" provisions just the founder's own account (`useProfilesStore.ts`'s
 * `connectToServer`) - every other already-typed-in roster member stays unprovisioned, exactly
 * like a brand-new one, ready for the same lazy self-service auto-provisioning above.
 *
 * 2026-09-02 ninth follow-up, at Marco's explicit request: a member row now carries two
 * independent signals, both visible to every device, not just this one. `isActiveProfile`
 * (accent border, "(du)") is purely local - which profile *this* device is signed in as. The
 * green dot plus `×N` count is band-wide presence (`usePresenceStore.ts`/`usePresenceReporter.ts`,
 * App.tsx) - how many devices anywhere currently have that profile active, e.g. "Marco" open on
 * two tablets at once. Deliberately two different visual treatments: "who am I" and "who's
 * online right now, from how many devices" are different questions with different answers - the
 * first only ever matches at most one row per device, the second can be true for several at
 * once. The same accent-border/background treatment (not the dot - a band has no presence
 * concept, just one is active) also marks the currently active *band* in the list above, for a
 * consistent "this one is the one currently selected" language across both lists.
 *
 * 2026-09-02 twelfth follow-up, at Marco's explicit request ("keep that basic MENU structure
 * idea consistent for all other pages as well we develop in the future"): the band list now
 * uses the exact same tap-to-select/"⋮"-for-everything-else split as the member list - a tap
 * on a band's own name selects it (already true beforehand), and "Einladen"/"Löschen" move
 * behind a `RowMenuButton`/`RowActionsMenu` popup (`RowActionsMenu.tsx`, extracted here so it's
 * one shared building block rather than two near-identical copies) instead of sitting as inline
 * links. Any future list of rows should reach for the same three pieces rather than growing its
 * own bespoke inline-links row that will eventually hit the same narrow-screen problem.
 *
 * 2026-09-02 thirteenth follow-up, at Marco's explicit request: the "(aktiv)"/"(du)" text
 * labels are gone from both lists - the accent border/background already says "this one is
 * selected" on its own, the text was redundant. Also added "Von diesem Gerät entfernen"
 * (`removeWorkspaceLocally`, useWorkspaceStore.ts) - previously "Löschen" was the *only* way to
 * stop a band showing up here, and it always deletes the workspace for everyone, server-side,
 * admin-only. The new action is purely local (drops it from this device's list, wipes its
 * local PouchDB data, never touches the server) and offered to every member of a server-
 * connected band, not just admins - a plain member previously had no way at all to remove a
 * band from their own device.
 */
function MemberRowLabel({ profile, onlineDeviceCount }: { profile: Profile; onlineDeviceCount: number }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {onlineDeviceCount > 0 && (
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500"
            title={`${onlineDeviceCount} Gerät${onlineDeviceCount === 1 ? '' : 'e'} gerade angemeldet`}
          />
        )}
        {profile.name}
        {onlineDeviceCount > 1 && <span className="text-xs text-ink-faint">×{onlineDeviceCount}</span>}
      </span>
      {profile.stageRoles.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {profile.stageRoles.map((role) => (
            <span
              key={role}
              className="rounded-sb-sm bg-control px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft"
            >
              {STAGE_ROLE_LABELS[role]}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

export function BandManagementView() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace)
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace)
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace)
  const removeWorkspaceLocally = useWorkspaceStore((state) => state.removeWorkspaceLocally)
  const resetMemberPassword = useWorkspaceStore((state) => state.resetMemberPassword)
  const activateProfile = useWorkspaceStore((state) => state.activateProfile)
  const setOwnPin = useWorkspaceStore((state) => state.setOwnPin)
  const profiles = useProfilesStore((state) => state.profiles)
  const createProfile = useProfilesStore((state) => state.create)
  const updateProfile = useProfilesStore((state) => state.update)
  const updateStageRoles = useProfilesStore((state) => state.updateStageRoles)
  const removeProfile = useProfilesStore((state) => state.remove)
  const connectToServer = useProfilesStore((state) => state.connectToServer)
  const setStageServerUrl = useStageServerStore((state) => state.setUrl)
  const activeProfileId = useActiveProfileStore((state) => state.byWorkspace[activeWorkspaceId])
  const setActiveProfile = useActiveProfileStore((state) => state.setActive)
  const presence = usePresenceStore((state) => state.presence)
  const promptText = useDialogStore((state) => state.promptText)
  const promptFields = useDialogStore((state) => state.promptFields)
  const confirm = useDialogStore((state) => state.confirm)
  const alert = useDialogStore((state) => state.alert)

  // Presence has no event for "went offline" (usePresenceReporter.ts's doc comment - a device
  // going stale is the only signal), so this needs re-deriving on a ticking clock, not just on
  // every stream push - useNow() is the same "ages instead of changing" fix PluginManager.tsx
  // already uses for the identical problem with plugin heartbeats.
  const now = useNow()
  const onlineDeviceCountByProfile = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const entry of Object.values(presence.devices)) {
      if (now - entry.lastSeenAt > PRESENCE_TIMEOUT_MS) continue
      counts[entry.profileId] = (counts[entry.profileId] ?? 0) + 1
    }
    return counts
  }, [presence, now])

  const [inviteWorkspaceId, setInviteWorkspaceId] = useState<string | null>(null)
  // #68: a device that already has at least one band had no way to join a second, different
  // one - App.tsx's JoinBandView gate only ever showed for a device with zero known bands.
  // One "+ Band" entry point (matching "+ Neue Band"'s old spot) opens a small choice first
  // (join existing vs. found new), rather than two separate always-visible buttons.
  const [showAddBandChoice, setShowAddBandChoice] = useState(false)
  const [showJoinAnotherBand, setShowJoinAnotherBand] = useState(false)
  // 2026-09-02 follow-up: which member's row currently shows the inline "become this profile"
  // password form (mirrors JoinBandView.tsx's step-3 roster picker, moved here since band/
  // profile switching no longer lives in the burger menu at all).
  const [activatingProfileId, setActivatingProfileId] = useState<string | null>(null)
  const [activatePasswordInput, setActivatePasswordInput] = useState('')
  const [activating, setActivating] = useState(false)
  // 2026-09-02 tenth follow-up, at Marco's explicit request after finding this live on a phone:
  // the previous row of inline text-link actions (Umbenennen, Stage-Rollen anpassen, ...) had
  // no bound on how many could pile up per row, and on a narrow screen they'd rather run out of
  // horizontal room than wrap onto a readable second line. Which member row's action popup is
  // currently open - one dedicated "⋮" button per row (RowActionsMenu.tsx), not a link among
  // the others, so it's always reachable regardless of row width.
  const [actionsMenuProfileId, setActionsMenuProfileId] = useState<string | null>(null)
  // 2026-09-02 twelfth follow-up, at Marco's explicit request ("keep that basic MENU structure
  // idea consistent for all other pages"): the exact same treatment for the band list above -
  // "Einladen"/"Löschen" move behind a "⋮" popup instead of sitting as inline links, and a tap
  // on the band's own name (already the case beforehand) selects it.
  const [actionsMenuWorkspaceId, setActionsMenuWorkspaceId] = useState<string | null>(null)

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const adminCount = profiles.filter((profile) => profile.stageRoles.includes('admin')).length
  const isLastAdmin = (profile: (typeof profiles)[number]) => profile.stageRoles.includes('admin') && adminCount <= 1

  async function performActivate(profileId: string, password: string | undefined) {
    setActivating(true)
    const workspace = await activateProfile(activeWorkspaceId, profileId, password)
    setActivating(false)
    if (!workspace) return
    setActiveProfile(activeWorkspaceId, profileId)
    setActivatingProfileId(null)
    setActivatePasswordInput('')
  }

  // A local-only band (Tier-A follow-up) has no Stage-Server account to authenticate against at
  // all - picking a profile there stays the old zero-credential-check behavior, same as the
  // removed ProfileSwitcher.tsx always was. Once connected: a non-admin profile has no password
  // concept at all anymore (2026-09-02 second follow-up), so picking one activates it right
  // away with no form at all; only an admin profile opens the inline 4-digit code prompt below.
  function handlePickProfile(profile: (typeof profiles)[number]) {
    if (!activeWorkspace?.username) {
      setActiveProfile(activeWorkspaceId, profile.id)
      return
    }
    if (!profile.stageRoles.includes('admin')) {
      void performActivate(profile.id, undefined)
      return
    }
    setActivatingProfileId(profile.id)
    setActivatePasswordInput('')
  }

  async function handleActivateSubmit(profileId: string) {
    await performActivate(profileId, activatePasswordInput)
  }

  return (
    <div className="flex h-dvh flex-col gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="text-2xl font-bold">Bands verwalten</h1>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Bands</h2>
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            className={`flex items-center justify-between gap-2 rounded-sb border px-4 py-3 ${
              workspace.id === activeWorkspaceId ? 'border-accent bg-accent/10' : 'border-line bg-surface'
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveWorkspace(workspace.id)}
              disabled={workspace.id === activeWorkspaceId}
              className="text-left font-semibold hover:underline disabled:hover:no-underline"
            >
              {workspace.name}
            </button>
            {(workspace.isAdmin || !!workspace.username) && (
              <RowMenuButton
                label={`Weitere Optionen für ${workspace.name}`}
                onClick={() => setActionsMenuWorkspaceId(workspace.id)}
              />
            )}
            {actionsMenuWorkspaceId === workspace.id && (
              <RowActionsMenu title={workspace.name} onClose={() => setActionsMenuWorkspaceId(null)}>
                {/* #58: renames a workspace. Server-connected bands go through
                    renameWorkspace's admin-verified backend call, which writes the workspace's
                    `workspace:access` doc - already replicated to every joined device via the
                    ordinary workspace-db sync, so this is what makes the new name actually
                    reach everyone (unlike the old client-only rename this replaces). */}
                {workspace.isAdmin && (
                  <RowActionButton
                    onClick={async () => {
                      setActionsMenuWorkspaceId(null)
                      const name = await promptText('Band umbenennen', { label: 'Neuer Name', defaultValue: workspace.name })
                      if (name?.trim() && name.trim() !== workspace.name) void renameWorkspace(workspace.id, name.trim())
                    }}
                  >
                    Umbenennen
                  </RowActionButton>
                )}
                {/* Only once this band has a real Stage-Server account to invite anyone
                    to - a local-only band (Tier-A follow-up) has nothing to hand out yet. Also
                    admin-only, unlike "Von diesem Gerät entfernen" below: inviting is a band-
                    management action, not something a plain member does. */}
                {workspace.isAdmin && !!workspace.username && (
                  <RowActionButton
                    onClick={() => {
                      setActionsMenuWorkspaceId(null)
                      setInviteWorkspaceId(workspace.id)
                    }}
                  >
                    Einladen
                  </RowActionButton>
                )}
                {/* 2026-09-02 thirteenth follow-up, at Marco's explicit request ("welche
                    Möglichkeit gibt es, gerade einen Band-Workspace von seinem Gerät zu
                    löschen, aber nicht den kompletten Workspace auf dem Server") - the
                    non-destructive counterpart to "Löschen" below: drops this band from just
                    this device (removeWorkspaceLocally also wipes its local PouchDB data) and
                    never touches the server, so it's offered to every server-connected band's
                    member, not only admins - a plain member previously had no way at all to
                    remove a band from their own device's list. Only for a server-connected
                    band: for a local-only one (no `username`), this and "Löschen" would be the
                    exact same operation, so just "Löschen" stays the one option there. */}
                {!!workspace.username && (
                  <RowActionButton
                    onClick={async () => {
                      setActionsMenuWorkspaceId(null)
                      const confirmed = await confirm(
                        `"${workspace.name}" von diesem Gerät entfernen? Die Band bleibt auf dem Server bestehen - andere Geräte sind nicht betroffen, und du kannst jederzeit wieder beitreten.`,
                        { confirmLabel: 'Entfernen' },
                      )
                      if (confirmed) await removeWorkspaceLocally(workspace.id)
                    }}
                  >
                    Von diesem Gerät entfernen
                  </RowActionButton>
                )}
                {workspace.isAdmin && (
                  <RowActionButton
                    danger
                    onClick={async () => {
                      setActionsMenuWorkspaceId(null)
                      const confirmed = await confirm(
                        `"${workspace.name}" endgültig löschen? Alle Daten (Songs, Setlisten, Roster, ...) gehen unwiderruflich verloren, für jedes Gerät, das dieser Band beigetreten ist.`,
                        { confirmLabel: 'Endgültig löschen', danger: true },
                      )
                      if (confirmed) void deleteWorkspace(workspace.id)
                    }}
                  >
                    Löschen
                  </RowActionButton>
                )}
              </RowActionsMenu>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setShowAddBandChoice(true)}
          className="w-full rounded-sb border border-line bg-surface px-4 py-2 font-semibold hover:bg-control-hover"
        >
          + Band
        </button>
      </section>

      {activeWorkspace && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">
            Mitglieder ({activeWorkspace.name})
          </h2>
          {!activeWorkspace.isAdmin && (
            <p className="text-sm text-ink-faint">Nur der Band-Admin kann Mitglieder verwalten.</p>
          )}
          {activeWorkspace.isAdmin && !activeWorkspace.username && (
            <div className="space-y-2 rounded-sb border border-line bg-surface p-4">
              <p className="text-sm text-ink-soft">
                Diese Band läuft bisher nur lokal auf diesem Gerät. Sobald ein Stage-Server bereitsteht (z.B. beim
                nächsten Bandtreffen), verbindet "Verbinden" diese Band damit - danach kann jedes Mitglied sich über
                den "Einladen"-Code oben selbst auf seinem Gerät anmelden.
              </p>
              <button
                type="button"
                onClick={async () => {
                  const serverUrl = await promptText('Mit Stage-Server verbinden', {
                    label: 'Server-Adresse (z.B. https://192.168.1.50:3001)',
                  })
                  if (!serverUrl?.trim()) return
                  setStageServerUrl(serverUrl.trim())
                  await connectToServer(serverUrl.trim())
                }}
                className="rounded-sb border border-line bg-control px-4 py-2 font-semibold hover:bg-control-hover"
              >
                Verbinden
              </button>
            </div>
          )}
          {profiles.map((profile) => {
            const isActiveProfile = profile.id === activeProfileId
            const isAdminProfile = profile.stageRoles.includes('admin')
            const onlineDeviceCount = onlineDeviceCountByProfile[profile.id] ?? 0
            return (
              <div
                key={profile.id}
                className={`flex flex-col gap-2 rounded-sb border px-4 py-3 ${
                  isActiveProfile ? 'border-accent bg-accent/10' : 'border-line bg-surface'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* A tap anywhere on name/roles selects this profile (2026-09-02 tenth
                      follow-up) - already-active has nothing to select, so it's a plain div
                      there instead of a disabled-looking button. */}
                  {isActiveProfile ? (
                    <div>
                      <MemberRowLabel profile={profile} onlineDeviceCount={onlineDeviceCount} />
                    </div>
                  ) : (
                    <button type="button" onClick={() => handlePickProfile(profile)} className="text-left hover:opacity-80">
                      <MemberRowLabel profile={profile} onlineDeviceCount={onlineDeviceCount} />
                    </button>
                  )}
                  {((isActiveProfile && isAdminProfile) || activeWorkspace.isAdmin) && (
                    <RowMenuButton
                      label={`Weitere Optionen für ${profile.name}`}
                      onClick={() => setActionsMenuProfileId(profile.id)}
                    />
                  )}
                </div>
                {actionsMenuProfileId === profile.id && (
                  <RowActionsMenu title={profile.name} onClose={() => setActionsMenuProfileId(null)}>
                    {isActiveProfile && isAdminProfile && (
                      <RowActionButton
                        onClick={async () => {
                          setActionsMenuProfileId(null)
                          const result = await promptFields('Eigenen PIN setzen', [
                            { key: 'pin', label: 'Neuer 4-stelliger PIN' },
                          ])
                          const pin = result?.pin?.trim()
                          if (!pin) return
                          if (!/^\d{4}$/.test(pin)) {
                            await alert('Der PIN muss genau 4 Ziffern haben.')
                            return
                          }
                          await setOwnPin(activeWorkspaceId, profile.id, pin)
                        }}
                      >
                        Meinen PIN setzen
                      </RowActionButton>
                    )}
                    {activeWorkspace.isAdmin && (
                      <>
                        <RowActionButton
                          onClick={async () => {
                            setActionsMenuProfileId(null)
                            const name = await promptText('Mitglied umbenennen', {
                              label: 'Neuer Name',
                              defaultValue: profile.name,
                            })
                            if (name?.trim()) void updateProfile(profile.id, name.trim())
                          }}
                        >
                          Umbenennen
                        </RowActionButton>
                        <RowActionButton
                          onClick={async () => {
                            setActionsMenuProfileId(null)
                            const result = await promptFields('Stage-Rollen anpassen', [
                              {
                                key: 'stageRoles',
                                label: 'Steuert sichtbare Widgets/Dashboards - "Admin" verwaltet die Band',
                                type: 'checkboxes',
                                options: STAGE_ROLES.map((role) => ({ value: role, label: STAGE_ROLE_LABELS[role] })),
                                defaultValue: profile.stageRoles.join(','),
                              },
                            ])
                            if (!result) return
                            const stageRoles = result.stageRoles.split(',').filter(Boolean) as StageRole[]
                            void updateStageRoles(profile.id, stageRoles)
                          }}
                        >
                          Stage-Rollen anpassen
                        </RowActionButton>
                        {/* Not for isActiveProfile (2026-09-02 eleventh follow-up, found live:
                            Marco locked his own phone out with this) - resetMemberPassword
                            only ever shows the fresh password once, for relaying to a
                            *different* device/person out of band; it never updates this
                            device's own stored credentials, unlike setOwnPin. Using it on your
                            own active row silently invalidates your own session with no way
                            to recover the new value - "Meinen PIN setzen" above is the only
                            safe self-service path, and stays the only one offered here now. */}
                        {isAdminProfile && !isActiveProfile && (
                          <RowActionButton
                            onClick={async () => {
                              setActionsMenuProfileId(null)
                              const confirmed = await confirm(
                                `Neuen PIN für "${profile.name}" setzen? Der alte hört sofort auf zu funktionieren.`,
                                { confirmLabel: 'Zurücksetzen', danger: true },
                              )
                              if (!confirmed) return
                              const credentials = await resetMemberPassword(activeWorkspaceId, profile.id)
                              if (!credentials) return
                              await alert(`Neuer PIN für "${profile.name}": ${credentials.password}`, {
                                title: 'PIN zurückgesetzt',
                              })
                            }}
                          >
                            Passwort zurücksetzen
                          </RowActionButton>
                        )}
                        <RowActionButton
                          danger
                          disabled={isLastAdmin(profile)}
                          title={isLastAdmin(profile) ? 'Mindestens ein Admin muss bestehen bleiben.' : undefined}
                          onClick={async () => {
                            setActionsMenuProfileId(null)
                            if (await confirm(`"${profile.name}" aus der Band entfernen?`, { confirmLabel: 'Entfernen', danger: true })) {
                              const removed = await removeProfile(profile.id)
                              // Only clear the active-profile choice if this device happened to be
                              // showing the member just deleted - deleting someone else's roster
                              // entry shouldn't reset who *this* device is signed in as.
                              if (removed && profile.id === activeProfileId) setActiveProfile(activeWorkspaceId, null)
                            }
                          }}
                        >
                          Löschen
                        </RowActionButton>
                      </>
                    )}
                  </RowActionsMenu>
                )}
                {activatingProfileId === profile.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (activatePasswordInput.length === 4) void handleActivateSubmit(profile.id)
                    }}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex gap-2">
                      <input
                        value={activatePasswordInput}
                        onChange={(e) => setActivatePasswordInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="4-stelliger Code"
                        inputMode="numeric"
                        autoFocus
                        className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-center text-lg tracking-widest text-ink-soft"
                      />
                      <button
                        type="submit"
                        disabled={activating || activatePasswordInput.length !== 4}
                        className="flex-shrink-0 rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
                      >
                        {activating ? '…' : 'Wechseln'}
                      </button>
                    </div>
                    {/* Only reached for an admin profile - non-admin picks activate immediately,
                        see handlePickProfile above. Deliberately no hint here about the
                        universal recovery code (2026-09-02 third follow-up, at Marco's explicit
                        request - see JoinBandView.tsx's matching form). */}
                    <button
                      type="button"
                      onClick={() => setActivatingProfileId(null)}
                      className="self-start text-xs text-ink-faint underline"
                    >
                      Abbrechen
                    </button>
                  </form>
                )}
              </div>
            )
          })}
          {activeWorkspace.isAdmin && (
            <button
              type="button"
              onClick={async () => {
                const name = await promptText('Neues Mitglied', { label: 'Name' })
                if (name?.trim()) await createProfile(name.trim())
              }}
              className="w-full rounded-sb border border-line bg-surface px-4 py-2 font-semibold hover:bg-control-hover"
            >
              + Neues Mitglied
            </button>
          )}
        </section>
      )}

      {inviteWorkspaceId && (
        <InviteBandView workspaceId={inviteWorkspaceId} onClose={() => setInviteWorkspaceId(null)} />
      )}
      {showJoinAnotherBand && <JoinBandView onClose={() => setShowJoinAnotherBand(false)} />}
      {showAddBandChoice && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-sb border border-line bg-surface p-6 text-ink">
            <h2 className="text-xl font-bold">Band hinzufügen</h2>
            <button
              type="button"
              onClick={() => {
                setShowAddBandChoice(false)
                setShowJoinAnotherBand(true)
              }}
              className="w-full rounded-sb border border-line bg-control px-4 py-3 text-left font-semibold hover:bg-control-hover"
            >
              Bestehender Band beitreten
            </button>
            <button
              type="button"
              onClick={async () => {
                setShowAddBandChoice(false)
                const name = await promptText('Neue Band', { label: 'Name der neuen Band' })
                if (name?.trim()) void addWorkspace(name.trim())
              }}
              className="w-full rounded-sb border border-line bg-control px-4 py-3 text-left font-semibold hover:bg-control-hover"
            >
              Neue Band gründen
            </button>
            <button
              type="button"
              onClick={() => setShowAddBandChoice(false)}
              className="w-full text-center text-xs text-ink-faint underline"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
