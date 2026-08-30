import { useState } from 'react'
import { useDialogStore } from '../store/useDialogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useRosterSetupStore } from '../store/useRosterSetupStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { BackToWorkingBandLink } from './BackToWorkingBandLink'
import { InviteBandView } from './InviteBandView'

/**
 * Shown by App.tsx right after a device founds a new band (see #21 follow-up, 2026-08-30) -
 * the real first step for a founding admin is building the roster, not being dropped into
 * the normal profile picker with an empty list and a "go do this in the menu instead"
 * message. Only ever shown to the workspace's admin (a plain member joining a band with an
 * empty roster can't add to it anyway - #56 - and just sees ProfileRolePickerView's empty
 * state as before).
 *
 * Gated in App.tsx on `useRosterSetupStore`, not on `profiles.length === 0`: an admin adding
 * several members in one sitting (the whole point of this screen) shouldn't get bumped to the
 * next screen the moment the first one exists. "Weiter" is the only way past it.
 *
 * Per-person-accounts follow-up: the very first member added here is this device's own
 * already-provisioned account (see `useProfilesStore.ts`'s `create` - "founder" special case),
 * nothing more to do. Every member after that gets a brand-new personal CouchDB account, same
 * as "+ Neues Mitglied" in BandManagementView.tsx - an optional PIN becomes their password
 * directly, or a generated one is handed over via the same invite/QR screen.
 *
 * Tier-A local-only-founding follow-up: this screen works exactly the same with no Stage-Server
 * configured at all (`useProfilesStore.ts`'s `create` degrades to a plain local write for every
 * member, not just the founder's own, whenever `activeWorkspace.username` is unset) - the PIN
 * field is omitted in that case since there's no account yet to attach one to. Connecting a
 * solo-founded band to a server later is a separate, deliberate step in BandManagementView.tsx,
 * not something offered here.
 */
export function RosterSetupView() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const workspaceName = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.name,
  )
  const isConnected = useWorkspaceStore(
    (state) => !!state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.username,
  )
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace)
  const profiles = useProfilesStore((state) => state.profiles)
  const create = useProfilesStore((state) => state.create)
  const remove = useProfilesStore((state) => state.remove)
  const complete = useRosterSetupStore((state) => state.complete)
  const confirm = useDialogStore((state) => state.confirm)
  const alert = useDialogStore((state) => state.alert)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [pin, setPin] = useState('')
  const [newMemberInvite, setNewMemberInvite] = useState<{ username: string; password: string } | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !role.trim()) return
    const trimmedPin = isConnected ? pin.trim() : ''

    const created = await create(name.trim(), role.trim(), trimmedPin ? { password: trimmedPin } : undefined)
    setName('')
    setRole('')
    setPin('')
    // No credentials to show: this was the founder's own account (nothing new provisioned) or
    // provisioning failed (useWorkspaceStore.createMember already alerted).
    if (!created?.credentials) return

    if (trimmedPin) {
      void alert(`Zugangsdaten für ${created.profile.name}:\nBenutzername: ${created.credentials.username}\nPIN: ${trimmedPin}`)
    } else {
      setNewMemberInvite(created.credentials)
    }
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <div className="w-full max-w-sm space-y-4 py-4">
        <BackToWorkingBandLink />

        <div>
          <h1 className="text-2xl font-bold">Wer ist alles bei {workspaceName} dabei?</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Trag die Band-Mitglieder mit ihrem Instrument/ihrer Rolle ein - beliebig viele, nacheinander. Später
            jederzeit im Menü änderbar.
          </p>
        </div>

        {profiles.length > 0 && (
          <ul className="space-y-2">
            {profiles.map((profile) => (
              <li
                key={profile.id}
                className="flex items-center justify-between rounded-sb border border-line bg-surface px-4 py-2"
              >
                <span>
                  <span className="font-semibold">{profile.name}</span>{' '}
                  <span className="text-sm text-ink-muted">({profile.role})</span>
                </span>
                <button
                  type="button"
                  onClick={() => void remove(profile.id)}
                  className="text-xs text-ink-faint underline"
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="h-12 min-w-0 rounded-sb bg-control px-3 text-ink-soft"
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Instrument/Rolle (z.B. Gitarre, Licht & Tech)"
            className="h-12 min-w-0 rounded-sb bg-control px-3 text-ink-soft"
          />
          <div className="flex gap-2">
            {isConnected && (
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Kurzer PIN statt Zugangscode (optional, z.B. 4711)"
                className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-ink-soft"
              />
            )}
            <button
              type="submit"
              disabled={!name.trim() || !role.trim()}
              className="flex-shrink-0 rounded-sb border border-line bg-surface px-4 py-2 font-semibold disabled:opacity-50"
            >
              Hinzufügen
            </button>
          </div>
        </form>

        <button
          type="button"
          onClick={() => complete(workspaceId)}
          className="w-full rounded-sb bg-accent px-4 py-3 font-semibold text-accent-ink"
        >
          Weiter
        </button>

        {/* No band rename (#58) means a typo in the name typed on the previous screen is
            otherwise permanent once landed here - this is the only way back for the device
            that just founded the band (found live via user feedback, 2026-08-30). Deleting
            drops activeWorkspaceId to '', which correctly falls through to JoinBandView so
            "Neue Band gründen" can be tried again. */}
        <button
          type="button"
          onClick={async () => {
            const confirmed = await confirm(`"${workspaceName}" verwerfen und neu anfangen (z.B. bei einem Tippfehler)?`, {
              confirmLabel: 'Verwerfen',
              danger: true,
            })
            if (confirmed) void deleteWorkspace(workspaceId)
          }}
          className="w-full text-center text-xs text-ink-faint underline"
        >
          Bandnamen falsch eingegeben? Neu anfangen
        </button>
      </div>

      {newMemberInvite && (
        <InviteBandView workspaceId={workspaceId} member={newMemberInvite} onClose={() => setNewMemberInvite(null)} />
      )}
    </div>
  )
}
