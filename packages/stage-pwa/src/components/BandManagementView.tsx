import { useState } from 'react'
import { STAGE_ROLES, type Profile, type StageRole } from 'shared-types'
import { InviteBandView } from './InviteBandView'
import { STAGE_ROLE_LABELS } from '../lib/stageRoleLabels'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useDialogStore } from '../store/useDialogStore'
import { useProfilesStore, type NewMemberCredentials } from '../store/useProfilesStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * SystemView.tsx's "Band" tab (see 2026-08-30 menu-decluttering follow-up) - every band/roster
 * *management* action lives here now: create a band (open to everyone, matches
 * `addWorkspace`'s existing rules), delete a band, and create/rename/reassign-role/
 * adjust-stage-roles/delete a roster member (all admin-only, enforced server-side already by
 * #56's CouchDB validation - the `isAdmin` checks here are just the UI not offering a control
 * that would fail). WorkspaceSwitcher.tsx/ProfileSwitcher.tsx in the main menu are now pure
 * *selection* - which band, which profile - nothing that mutates anything lives there anymore.
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
 * `_design/roster`'s validator really checks. "+ Neues Mitglied" is where that account gets
 * created: an optional PIN becomes the account's password directly (told to the person
 * verbally); left blank, a long random password is generated and handed over via the same
 * invite/QR code as everything else here (`InviteBandView.tsx`, generalized to carry any one
 * specific person's account). The very first profile a band ever gets is special - it reuses
 * the founding device's own already-provisioned account (`Workspace.ownProfileId`,
 * `useProfilesStore.ts`'s `create`), auto-admin, no invite needed since that device is already
 * on it. "Löschen" is disabled for the sole remaining admin (client-side, for instant feedback -
 * same pattern DashboardManager.tsx uses for the last public dashboard); the actual, unbypassable
 * enforcement is server-side (core-backend rejects removing/demoting the last admin outright).
 *
 * Tier-A local-only-founding follow-up (2026-08-30): a band with no Stage-Server configured
 * founds and builds its roster entirely locally - `activeWorkspace.username` unset is that
 * state, not an error. The "Diese Band läuft nur lokal" banner below is the one way out of it:
 * "Verbinden" provisions the founder's own account plus every already-typed-in roster member's
 * account in one pass (`useProfilesStore.ts`'s `connectToServer`), then shows each of them ready
 * to invite via the *same* `InviteBandView` "+ Neues Mitglied" already uses - nothing new there.
 * The PIN field on "+ Neues Mitglied" only makes sense once there's an account to attach it to,
 * so it's omitted while local-only.
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
  const alert = useDialogStore((state) => state.alert)

  const [newMemberInvite, setNewMemberInvite] = useState<{
    workspaceId: string
    member: { username: string; password: string }
  } | null>(null)
  const [connectResults, setConnectResults] = useState<Array<{ profile: Profile; credentials: NewMemberCredentials }> | null>(
    null,
  )

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
              <button
                type="button"
                onClick={async () => {
                  const confirmed = await confirm(
                    `"${workspace.name}" endgültig löschen? Alle Daten (Songs, Setlisten, Roster, ...) gehen unwiderruflich verloren, für jedes Gerät, das dieser Band beigetreten ist.`,
                    { confirmLabel: 'Endgültig löschen', danger: true },
                  )
                  if (confirmed) void deleteWorkspace(workspace.id)
                }}
                className="flex-shrink-0 text-xs text-red-400 underline hover:text-red-300"
              >
                Löschen
              </button>
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
          {activeWorkspace.isAdmin && !activeWorkspace.username && !connectResults && (
            <div className="space-y-2 rounded-sb border border-line bg-surface p-4">
              <p className="text-sm text-ink-soft">
                Diese Band läuft bisher nur lokal auf diesem Gerät. Sobald ein Stage-Server bereitsteht (z.B. beim
                nächsten Bandtreffen), verbindet "Verbinden" diese Band damit und richtet die Zugänge für alle
                bereits eingetragenen Mitglieder in einem Rutsch ein.
              </p>
              <button
                type="button"
                onClick={async () => {
                  const serverUrl = await promptText('Mit Stage-Server verbinden', {
                    label: 'Server-Adresse (z.B. https://192.168.1.50:3001)',
                  })
                  if (!serverUrl?.trim()) return
                  setStageServerUrl(serverUrl.trim())
                  const results = await connectToServer(serverUrl.trim())
                  if (results) setConnectResults(results)
                }}
                className="rounded-sb border border-line bg-control px-4 py-2 font-semibold hover:bg-control-hover"
              >
                Verbinden
              </button>
            </div>
          )}
          {connectResults && (
            <div className="space-y-2 rounded-sb border border-line bg-surface p-4">
              <p className="text-sm text-ink-soft">
                Verbunden. Jetzt die restlichen Mitglieder auf ihre Geräte einladen:
              </p>
              {connectResults.map(({ profile, credentials }) => (
                <div key={profile.id} className="flex items-center justify-between gap-2">
                  <span>{profile.name}</span>
                  <button
                    type="button"
                    onClick={() => setNewMemberInvite({ workspaceId: activeWorkspaceId, member: credentials })}
                    className="text-xs underline hover:text-ink-soft"
                  >
                    Einladen
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setConnectResults(null)}
                className="w-full rounded-sb border border-line bg-control px-4 py-2 font-semibold hover:bg-control-hover"
              >
                Fertig
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

                const created = await createProfile(result.name.trim(), result.role.trim(), pin ? { password: pin } : undefined)
                // No credentials to show: either this was the band's very first profile (this
                // device's own already-provisioned account, nothing new to hand over) or the
                // account failed to provision (useWorkspaceStore.createMember already alerted).
                if (!created?.credentials) return

                if (pin) {
                  void alert(
                    `Zugangsdaten für ${result.name.trim()}:\nBenutzername: ${created.credentials.username}\nPIN: ${pin}`,
                  )
                } else {
                  setNewMemberInvite({ workspaceId: activeWorkspaceId, member: created.credentials })
                }
              }}
              className="w-full rounded-sb border border-line bg-surface px-4 py-2 font-semibold hover:bg-control-hover"
            >
              + Neues Mitglied
            </button>
          )}
        </section>
      )}

      {newMemberInvite && (
        <InviteBandView
          workspaceId={newMemberInvite.workspaceId}
          member={newMemberInvite.member}
          onClose={() => setNewMemberInvite(null)}
        />
      )}
    </div>
  )
}
