import { useEffect, useState } from 'react'
import type { WorkspaceRoster } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

type Step = 'checking' | 'code' | 'roster' | 'pin'

/**
 * Resolves "which admin, proven how" for a workspace into real, working CouchDB credentials -
 * WorkspaceHardwareSettings.tsx's replacement for a hand-typed username/password, used once for
 * the workspace being opened and once (when needed) for the one being closed. Mirrors
 * JoinBandView.tsx's existing code -> roster -> PIN sequence (same components: `fetchRoster`,
 * `RosterMember.isAdmin`, a 4-digit PIN or the universal recovery code), but as its own smaller
 * dialog rather than that whole view, because this needs two different final steps depending on
 * whether this device already knows the workspace:
 *
 * - Already a locally-cached admin of `workspaceId` → skip the code entirely, fetch it silently
 *   via the existing `getAccessCode()` (already admin-gated on this device's own stored
 *   credentials), then `activateProfile()` to resolve the PIN - refreshes this device's own
 *   cached credentials, touches nothing else.
 * - No local history with `workspaceId` at all → ask for the access code like joining, then
 *   `resolveMemberCredentials()` (deliberately not `joinAsMember()`, which would also switch
 *   what this device displays - see that action's own doc comment).
 *
 * Either path ends the same way: real `{ username, password, profileId }` handed back via
 * `onResolved` (`profileId` is which admin was picked - the caller may want to display as them
 * afterward), or `null` on cancel.
 */
export function ResolveWorkspaceAdminDialog({
  workspaceId,
  workspaceName,
  onResolved,
}: {
  workspaceId: string
  workspaceName: string
  onResolved: (credentials: { username: string; password: string; profileId: string } | null) => void
}) {
  const getAccessCode = useWorkspaceStore((state) => state.getAccessCode)
  const fetchRoster = useWorkspaceStore((state) => state.fetchRoster)
  const activateProfile = useWorkspaceStore((state) => state.activateProfile)
  const resolveMemberCredentials = useWorkspaceStore((state) => state.resolveMemberCredentials)

  const [step, setStep] = useState<Step>('checking')
  const [hasLocalCredentials, setHasLocalCredentials] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [roster, setRoster] = useState<WorkspaceRoster | null>(null)
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function checkLocalCredentials() {
      const local = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
      if (local?.isAdmin && local.couchPassword && local.username) {
        const accessCode = await getAccessCode(workspaceId)
        const fetchedRoster = accessCode ? await fetchRoster(workspaceId, accessCode.code) : null
        if (accessCode && fetchedRoster) {
          setHasLocalCredentials(true)
          setCode(accessCode.code)
          setRoster(fetchedRoster)
          setStep('roster')
          return
        }
      }
      setStep('code')
    }
    void checkLocalCredentials()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  async function submitCode() {
    if (!manualCode.trim() || busy) return
    setBusy(true)
    const result = await fetchRoster(workspaceId, manualCode.trim())
    setBusy(false)
    if (result) {
      setCode(manualCode.trim())
      setRoster(result)
      setStep('roster')
    }
  }

  function pickAdmin(profileId: string) {
    setPickedProfileId(profileId)
    setPinInput('')
    setStep('pin')
  }

  async function submitPin() {
    if (pinInput.length !== 4 || !pickedProfileId || !code || busy) return
    setBusy(true)
    const result = hasLocalCredentials
      ? await activateProfile(workspaceId, pickedProfileId, pinInput)
      : await resolveMemberCredentials(workspaceId, workspaceName, code, pickedProfileId, pinInput)
    setBusy(false)
    if (result?.username && result.couchPassword) {
      onResolved({ username: result.username, password: result.couchPassword, profileId: pickedProfileId })
      return
    }
    setPinInput('')
  }

  const admins = roster?.members.filter((m) => m.isAdmin) ?? []

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-sb border border-line bg-surface p-6 text-ink">
        <div>
          <h2 className="text-xl font-bold">Admin von „{workspaceName}“</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {step === 'checking' && 'Prüfe…'}
            {step === 'code' && 'Code der Band eingeben.'}
            {step === 'roster' && 'Wer bist du?'}
            {step === 'pin' && 'PIN eingeben.'}
          </p>
        </div>

        {step === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitCode()
            }}
            className="flex gap-2"
          >
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="12345678"
              inputMode="numeric"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-center text-lg tracking-widest text-ink-soft"
            />
            <button
              type="submit"
              disabled={busy || manualCode.trim().length === 0}
              className="flex-shrink-0 rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
            >
              {busy ? '…' : 'Weiter'}
            </button>
          </form>
        )}

        {step === 'roster' && (
          <>
            {admins.length === 0 && <p className="text-sm text-ink-muted">Keine Admins in dieser Band gefunden.</p>}
            <ul className="space-y-2">
              {admins.map((member) => (
                <li key={member.profileId}>
                  <button
                    type="button"
                    onClick={() => pickAdmin(member.profileId)}
                    className="w-full rounded-sb border border-line bg-control px-4 py-3 text-left font-semibold hover:bg-control-hover"
                  >
                    {member.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 'pin' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submitPin()
            }}
            className="flex gap-2"
          >
            <input
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-stelliger PIN"
              inputMode="numeric"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-center text-lg tracking-widest text-ink-soft"
            />
            <button
              type="submit"
              disabled={busy || pinInput.length !== 4}
              className="flex-shrink-0 rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
            >
              {busy ? '…' : 'Bestätigen'}
            </button>
          </form>
        )}

        <button type="button" onClick={() => onResolved(null)} className="w-full text-center text-xs text-ink-faint underline">
          Abbrechen
        </button>
      </div>
    </div>
  )
}
