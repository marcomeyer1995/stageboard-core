import { useState } from 'react'
import { STAGE_ROLES, type StageRole } from 'shared-types'
import { InviteBandView } from './InviteBandView'
import { STAGE_ROLE_LABELS } from '../lib/stageRoleLabels'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useDialogStore } from '../store/useDialogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * SystemView.tsx's "Band" tab (see 2026-08-30 menu-decluttering follow-up) - every band/roster
 * *management* action lives here now: create a band (open to everyone, matches
 * `addWorkspace`'s existing rules), delete a band, invite people to it, and
 * create/rename/reassign-role/adjust-stage-roles/delete a roster member (all admin-only,
 * enforced server-side already by #56's CouchDB validation - the `isAdmin` checks here are just
 * the UI not offering a control that would fail). WorkspaceSwitcher.tsx/ProfileSwitcher.tsx in
 * the main menu are now pure *selection* - which band, which profile - nothing that mutates
 * anything lives there anymore.
 *
 * No band *rename* here - it existed briefly, then was pulled back out (see the still-open
 * follow-up issue) because it was local-only: a workspace's name was never synced anywhere, so
 * a rename never reached devices that had already joined.
 *
 * Rename, instrument/function change, and stage-roles are three separate actions on a member,
 * not one combined "edit" form - matches how they were asked for, and fits #21's still-deferred
 * "different role per session" idea better than a merged dialog would. "Instrument/Funktion
 * ändern" and "Stage-Rollen anpassen" are deliberately worded apart (#57 follow-up): the former
 * edits `profile.role`, free text purely for display; the latter edits `profile.stageRoles`,
 * the closed multi-value field that gates widget/dashboard visibility. Assigned stage roles are
 * also shown directly on the roster row (badges), not only inside the dialog.
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
 * 2026-09-01 redesign, at Marco's request: onboarding is now one *workspace-level* "Einladen"
 * button next to each band's name (not a per-roster-row or per-new-member action) - it mints one
 * short-lived, reusable code (`InviteBandView.tsx`, `useWorkspaceStore.ts`'s `createInvite`) that
 * covers *anyone* joining that band, admin or not, new or already-provisioned. The joining device
 * looks up the roster with that code and self-service-picks who it is (JoinBandView.tsx), typing
 * a password only if that specific person's account already exists - so this component itself
 * never sees or handles a member's password at all anymore. "+ Neues Mitglied" only creates the
 * roster entry now (with an optional admin-chosen PIN, provisioning the account with it right
 * away so self-service join can check it later); it doesn't show its own invite screen anymore
 * since the one workspace-level code already covers every new member too - immediately, or
 * lazily the first time someone actually picks that name (self-service join auto-provisions an
 * account on the spot when none exists yet, see core-backend's `POST /invites/:code/join/:id`).
 *
 * Tier-A local-only-founding follow-up (2026-08-30): a band with no Stage-Server configured
 * founds and builds its roster entirely locally - `activeWorkspace.username` unset is that
 * state, not an error. The "Diese Band läuft nur lokal" banner below is the one way out of it:
 * "Verbinden" provisions just the founder's own account (`useProfilesStore.ts`'s
 * `connectToServer`) - every other already-typed-in roster member stays unprovisioned, exactly
 * like a brand-new one, ready for the same lazy self-service auto-provisioning above. The PIN
 * field on "+ Neues Mitglied" only makes sense once there's an account to attach it to, so it's
 * omitted while local-only.
 */
export function BandManagementView() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace)
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace)
  const profiles = useProfilesStore((state) => state.profiles)
  const createProfile = useProfilesStore((state) => state.create)
  const updateProfile = useProfilesStore((state) => state.update)
  const updateStageRoles = useProfilesStore((state) => state.updateStageRoles)
  const removeProfile = useProfilesStore((state) => state.remove)
  const connectToServer = useProfilesStore((state) => state.connectToServer)
  const setStageServerUrl = useStageServerStore((state) => state.setUrl)
  const activeProfileId = useActiveProfileStore((state) => state.byWorkspace[activeWorkspaceId])
  const setActiveProfile = useActiveProfileStore((state) => state.setActive)
  const promptText = useDialogStore((state) => state.promptText)
  const promptFields = useDialogStore((state) => state.promptFields)
  const confirm = useDialogStore((state) => state.confirm)

  const [inviteWorkspaceId, setInviteWorkspaceId] = useState<string | null>(null)

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const adminCount = profiles.filter((profile) => profile.stageRoles.includes('admin')).length
  const isLastAdmin = (profile: (typeof profiles)[number]) => profile.stageRoles.includes('admin') && adminCount <= 1

  return (
    <div className="flex h-dvh flex-col gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <h1 className="text-2xl font-bold">Bands verwalten</h1>

      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Bands</h2>
        {workspaces.map((workspace) => (
          <div
            key={workspace.id}
            className="flex items-center justify-between gap-2 rounded-sb border border-line bg-surface px-4 py-3"
          >
            <span className="font-semibold">
              {workspace.name}
              {workspace.id === activeWorkspaceId && <span className="ml-2 text-xs text-ink-faint">(aktiv)</span>}
            </span>
            {workspace.isAdmin && (
              <div className="flex flex-shrink-0 items-center gap-3 text-xs">
                {/* Only once this band has a real Stage-Server account to invite anyone
                    to - a local-only band (Tier-A follow-up) has nothing to hand out yet. */}
                {!!workspace.username && (
                  <button
                    type="button"
                    onClick={() => setInviteWorkspaceId(workspace.id)}
                    className="underline hover:text-ink-soft"
                  >
                    Einladen
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const confirmed = await confirm(
                      `"${workspace.name}" endgültig löschen? Alle Daten (Songs, Setlisten, Roster, ...) gehen unwiderruflich verloren, für jedes Gerät, das dieser Band beigetreten ist.`,
                      { confirmLabel: 'Endgültig löschen', danger: true },
                    )
                    if (confirmed) void deleteWorkspace(workspace.id)
                  }}
                  className="text-red-400 underline hover:text-red-300"
                >
                  Löschen
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={async () => {
            const name = await promptText('Neue Band', { label: 'Name der neuen Band' })
            if (name?.trim()) void addWorkspace(name.trim())
          }}
          className="w-full rounded-sb border border-line bg-surface px-4 py-2 font-semibold hover:bg-control-hover"
        >
          + Neue Band
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
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sb border border-line bg-surface px-4 py-3"
            >
              <div>
                <span>
                  {profile.name} <span className="text-sm text-ink-muted">({profile.role})</span>
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
              </div>
              {activeWorkspace.isAdmin && (
                <div className="flex flex-shrink-0 flex-wrap justify-end gap-3 text-xs">
                  <button
                    type="button"
                    onClick={async () => {
                      const name = await promptText('Mitglied umbenennen', {
                        label: 'Neuer Name',
                        defaultValue: profile.name,
                      })
                      if (name?.trim()) void updateProfile(profile.id, name.trim(), profile.role)
                    }}
                    className="underline hover:text-ink-soft"
                  >
                    Umbenennen
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const role = await promptText('Instrument/Funktion ändern', {
                        label: 'Instrument/Funktion',
                        defaultValue: profile.role,
                      })
                      if (role?.trim()) void updateProfile(profile.id, profile.name, role.trim())
                    }}
                    className="underline hover:text-ink-soft"
                  >
                    Instrument/Funktion ändern
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
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
                    className="underline hover:text-ink-soft"
                  >
                    Stage-Rollen anpassen
                  </button>
                  <button
                    type="button"
                    disabled={isLastAdmin(profile)}
                    title={isLastAdmin(profile) ? 'Mindestens ein Admin muss bestehen bleiben.' : undefined}
                    onClick={async () => {
                      if (await confirm(`"${profile.name}" aus der Band entfernen?`, { confirmLabel: 'Entfernen', danger: true })) {
                        const removed = await removeProfile(profile.id)
                        // Only clear the active-profile choice if this device happened to be
                        // showing the member just deleted - deleting someone else's roster
                        // entry shouldn't reset who *this* device is signed in as.
                        if (removed && profile.id === activeProfileId) setActiveProfile(activeWorkspaceId, null)
                      }
                    }}
                    className="underline hover:text-ink-soft disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline disabled:hover:text-ink-faint"
                  >
                    Löschen
                  </button>
                </div>
              )}
            </div>
          ))}
          {activeWorkspace.isAdmin && (
            <button
              type="button"
              onClick={async () => {
                const isConnected = !!activeWorkspace.username
                const result = await promptFields('Neues Mitglied', [
                  { key: 'name', label: 'Name' },
                  { key: 'role', label: 'Instrument/Funktion (z.B. Vocalist, Gitarre, Licht)' },
                  ...(isConnected
                    ? [{ key: 'pin', label: 'Kurzer PIN statt Zugangscode (optional, z.B. 4711)' }]
                    : []),
                ])
                if (!result?.name?.trim() || !result?.role?.trim()) return
                const pin = isConnected ? result.pin?.trim() : undefined
                await createProfile(result.name.trim(), result.role.trim(), pin ? { password: pin } : undefined)
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
    </div>
  )
}
