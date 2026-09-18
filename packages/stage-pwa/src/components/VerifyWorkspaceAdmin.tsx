import { useEffect, useState } from 'react'
import type { WorkspaceRoster } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

type Step = 'checking' | 'code' | 'roster' | 'pin'

export interface VerifiedAdmin {
  profileId: string
  pin: string
  /** The band's access code, when this step had to obtain it (silently or typed) - the wizard
   * needs it afterwards to let this device join a band it has never cached. `null` when the
   * profile was already known and no code was ever involved. */
  code: string | null
}

/**
 * One step of SwitchServerBandWizard.tsx: proves "an admin of this workspace" - which admin, and
 * their PIN (their own, or the universal recovery code) - verified by the Stage-Server itself
 * (`verifyAdminPin`), so a wrong PIN is rejected right here instead of at the final commit.
 *
 * - `knownProfileId` given (the closing band's current user on this device): only the PIN is asked,
 *   the name never - "Anderer Admin wählen" falls back to the picker below.
 * - Otherwise: mirrors JoinBandView.tsx's code -> roster -> PIN sequence. The code is only asked
 *   when this device has no cached admin session for the workspace; with one, it's fetched
 *   silently (`getAccessCode`, admin-gated on this device's own stored credentials). Only roster
 *   admins are listed.
 *
 * Content only - the wizard owns the modal frame, and mounts one instance per step (`key`), so
 * nothing here can inherit another band's leftover state.
 */
export function VerifyWorkspaceAdmin({
  workspaceId,
  workspaceName,
  knownProfileId,
  onVerified,
  onCancel,
}: {
  workspaceId: string
  workspaceName: string
  knownProfileId?: string
  onVerified: (admin: VerifiedAdmin) => void
  onCancel: () => void
}) {
  const getAccessCode = useWorkspaceStore((state) => state.getAccessCode)
  const fetchRoster = useWorkspaceStore((state) => state.fetchRoster)
  const verifyAdminPin = useWorkspaceStore((state) => state.verifyAdminPin)

  const [useKnownProfile, setUseKnownProfile] = useState(!!knownProfileId)
  const [step, setStep] = useState<Step>(knownProfileId ? 'pin' : 'checking')
  const [manualCode, setManualCode] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [roster, setRoster] = useState<WorkspaceRoster | null>(null)
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(knownProfileId ?? null)
  const [pinInput, setPinInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (useKnownProfile) return
    async function identify() {
      const local = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
      if (local?.isAdmin && local.couchPassword && local.username) {
        const accessCode = await getAccessCode(workspaceId)
        const fetchedRoster = accessCode ? await fetchRoster(workspaceId, accessCode.code) : null
        if (accessCode && fetchedRoster) {
          setCode(accessCode.code)
          setRoster(fetchedRoster)
          setStep('roster')
          return
        }
      }
      setStep('code')
    }
    setStep('checking')
    void identify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, useKnownProfile])

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

  async function submitPin() {
    if (pinInput.length !== 4 || !pickedProfileId || busy) return
    setBusy(true)
    const ok = await verifyAdminPin(workspaceId, pickedProfileId, pinInput)
    setBusy(false)
    if (ok) {
      onVerified({ profileId: pickedProfileId, pin: pinInput, code })
      return
    }
    setPinInput('')
  }

  const admins = roster?.members.filter((m) => m.isAdmin) ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Admin von „{workspaceName}“</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {step === 'checking' && 'Prüfe…'}
          {step === 'code' && 'Code der Band eingeben.'}
          {step === 'roster' && 'Wer bist du?'}
          {step === 'pin' && (useKnownProfile ? 'PIN des angemeldeten Admins eingeben.' : 'PIN eingeben.')}
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
                  onClick={() => {
                    setPickedProfileId(member.profileId)
                    setPinInput('')
                    setStep('pin')
                  }}
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

      {step === 'pin' && useKnownProfile && (
        <button
          type="button"
          onClick={() => {
            setUseKnownProfile(false)
            setPickedProfileId(null)
            setPinInput('')
          }}
          className="w-full text-center text-xs text-ink-faint underline"
        >
          Anderer Admin wählen
        </button>
      )}

      <button type="button" onClick={onCancel} className="w-full text-center text-xs text-ink-faint underline">
        Abbrechen
      </button>
    </div>
  )
}
