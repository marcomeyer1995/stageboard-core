import { useState } from 'react'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useDialogStore } from '../store/useDialogStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useRosterSetupStore } from '../store/useRosterSetupStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { BackToWorkingBandLink } from './BackToWorkingBandLink'
import { InviteBandView } from './InviteBandView'

type Phase = 'founder' | 'members' | 'summary'

/**
 * Shown by App.tsx right after a device founds a new band (see #21 follow-up, 2026-08-30) -
 * the real first step for a founding admin is building the roster, not being dropped into
 * the normal profile picker with an empty list and a "go do this in the menu instead"
 * message. Only ever shown to the device that actually founded this workspace
 * (App.tsx's `needsRosterSetup`, `foundedHere`) - a plain member joining a band with an
 * already-real roster never reaches this at all.
 *
 * 2026-09-02 sixth follow-up, at Marco's explicit request, splits what used to be one
 * combined name+role+PIN form into three distinct phases:
 * 1. **'founder'** - just your own name and a mandatory 4-digit PIN. This is the account
 *    `addWorkspace` already provisioned with a random, never-shown password; submitting here
 *    calls `setOwnPin` to replace that with the PIN you actually chose (best-effort - if the
 *    request fails, e.g. a network hiccup, this still advances rather than stranding you here;
 *    "Meinen PIN setzen" in Band-management is always there to fix it after the fact). Local-
 *    only founding (Tier-A follow-up, no Stage-Server configured) still collects the PIN for
 *    a consistent flow, but has no account yet to set it on - `setOwnPin` is simply skipped.
 *    Also immediately marks this profile as this device's own active one
 *    (`useActiveProfileStore`'s `setActive`) - typing your own name here already answers "wer
 *    bist du?", so App.tsx's `needsProfile` gate (ProfileRolePickerView.tsx) never has to ask
 *    it again once this wizard finishes (found live, at Marco's explicit request - it used to).
 * 2. **'members'** - add everyone else, name only, nothing else. `role` (the old free-text
 *    instrument/function field) is gone entirely from the whole app now ("I don't see the
 *    necessity for it"), and a non-admin has no password concept at all to collect either
 *    (2026-09-02 second follow-up) - there is genuinely nothing left to ask beyond a name.
 * 3. **'summary'** - `InviteBandView.tsx` itself, `isFoundingSummary`, shown automatically
 *    (skipped entirely for a local-only founding - there's no access code to show yet). The
 *    whole point: the earlier lockouts this session were caused by nobody having saved this
 *    exact code anywhere - founding a band now ends on the one screen that fixes that, instead
 *    of relying on someone remembering to open "Einladen" later.
 *
 * `rosterSetupDone` (`useRosterSetupStore`) is deliberately only marked complete when phase
 * 'summary' is dismissed (or, local-only, when phase 'members' finishes) - marking it any
 * earlier would flip App.tsx's `needsRosterSetup` false immediately (profiles already exist by
 * then) and unmount this component out from under phases 'members'/'summary' before they ever
 * got to render.
 *
 * "Bandnamen falsch eingegeben? Neu anfangen" only appears during phase 'founder', while
 * `profiles.length` is still genuinely 0 - once the founder's own profile exists (phase
 * 'members' onward), deleting the whole workspace is never offered again (this destroyed a
 * real, populated workspace - S.O.A.T. - when reachable more broadly; see App.tsx's own doc
 * comment on `needsRosterSetup` for the full story).
 */
export function RosterSetupView() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const workspaceName = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.name,
  )
  const isConnected = useWorkspaceStore(
    (state) => !!state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.username,
  )
  const founderId = useWorkspaceStore(
    (state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.ownProfileId,
  )
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace)
  const setOwnPin = useWorkspaceStore((state) => state.setOwnPin)
  const profiles = useProfilesStore((state) => state.profiles)
  const create = useProfilesStore((state) => state.create)
  const remove = useProfilesStore((state) => state.remove)
  const complete = useRosterSetupStore((state) => state.complete)
  const setActiveProfile = useActiveProfileStore((state) => state.setActive)
  const confirm = useDialogStore((state) => state.confirm)

  const [phase, setPhase] = useState<Phase>('founder')
  const [founderName, setFounderName] = useState('')
  const [founderPin, setFounderPin] = useState('')
  const [memberName, setMemberName] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleFounderSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!founderName.trim() || founderPin.length !== 4) return
    setBusy(true)
    await create(founderName.trim())
    // Typing your own name here *is* answering "wer bist du?" - immediately set as this
    // device's active profile so ProfileRolePickerView.tsx never asks again once this wizard
    // finishes (found live, at Marco's explicit request: it used to ask a second time,
    // pointlessly, right after founding).
    if (founderId) setActiveProfile(workspaceId, founderId)
    if (isConnected && founderId) {
      // Best-effort: a failure here already alerted why (setOwnPin), but stranding the founder
      // mid-setup over a network hiccup is worse than letting them fix their PIN afterward via
      // "Meinen PIN setzen" - so this advances either way.
      await setOwnPin(workspaceId, founderId, founderPin)
    }
    setBusy(false)
    setPhase('members')
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!memberName.trim()) return
    await create(memberName.trim())
    setMemberName('')
  }

  function handleMembersDone() {
    if (isConnected) {
      setPhase('summary')
    } else {
      complete(workspaceId)
    }
  }

  if (phase === 'summary') {
    return <InviteBandView workspaceId={workspaceId} onClose={() => complete(workspaceId)} isFoundingSummary />
  }

  if (phase === 'members') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
        <div className="w-full max-w-sm space-y-4 py-4">
          <BackToWorkingBandLink />

          <div>
            <h1 className="text-2xl font-bold">Wer ist alles bei {workspaceName} dabei?</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Trag die Namen der übrigen Bandmitglieder ein - beliebig viele, nacheinander. Instrument/Rolle und
              Admin-Rechte kannst du später jederzeit im Menü anpassen.
            </p>
          </div>

          {profiles.length > 0 && (
            <ul className="space-y-2">
              {profiles.map((profile) => (
                <li
                  key={profile.id}
                  className="flex items-center justify-between rounded-sb border border-line bg-surface px-4 py-2"
                >
                  <span className="font-semibold">
                    {profile.name}
                    {profile.id === founderId && <span className="ml-2 text-xs text-ink-faint">(du)</span>}
                  </span>
                  {profile.id !== founderId && (
                    <button
                      type="button"
                      onClick={() => void remove(profile.id)}
                      className="text-xs text-ink-faint underline"
                    >
                      Entfernen
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void handleAddMember(e)} className="flex gap-2">
            <input
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder="Name"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-ink-soft"
            />
            <button
              type="submit"
              disabled={!memberName.trim()}
              className="flex-shrink-0 rounded-sb border border-line bg-surface px-4 py-2 font-semibold disabled:opacity-50"
            >
              Hinzufügen
            </button>
          </form>

          <button
            type="button"
            onClick={handleMembersDone}
            className="w-full rounded-sb bg-accent px-4 py-3 font-semibold text-accent-ink"
          >
            Weiter
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <div className="w-full max-w-sm space-y-4 py-4">
        <BackToWorkingBandLink />

        <div>
          <h1 className="text-2xl font-bold">Wer bist du?</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Du gründest {workspaceName}. Dein Name und ein 4-stelliger PIN für dein Admin-Konto - den PIN kannst du
            später jederzeit in "Band" ändern.
          </p>
        </div>

        <form onSubmit={(e) => void handleFounderSubmit(e)} className="flex flex-col gap-2">
          <input
            value={founderName}
            onChange={(e) => setFounderName(e.target.value)}
            placeholder="Dein Name"
            autoFocus
            className="h-12 min-w-0 rounded-sb bg-control px-3 text-ink-soft"
          />
          <input
            value={founderPin}
            onChange={(e) => setFounderPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4-stelliger PIN"
            inputMode="numeric"
            className="h-12 min-w-0 rounded-sb bg-control px-3 text-center text-lg tracking-widest text-ink-soft"
          />
          <button
            type="submit"
            disabled={busy || !founderName.trim() || founderPin.length !== 4}
            className="w-full rounded-sb bg-accent px-4 py-3 font-semibold text-accent-ink disabled:opacity-50"
          >
            {busy ? '…' : 'Weiter'}
          </button>
        </form>

        {/* No band rename (#58) means a typo in the name typed on the previous screen is
            otherwise permanent once landed here - this is the only way back for the device
            that just founded the band (found live via user feedback, 2026-08-30). Deleting
            drops activeWorkspaceId to '', which correctly falls through to JoinBandView so
            "Neue Band gründen" can be tried again. Only offered during this phase - nothing
            real to lose yet (see this file's doc comment for why that matters). */}
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
    </div>
  )
}
