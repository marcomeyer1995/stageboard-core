import { useState } from 'react'
import type { AdminPinProof, WorkspaceSummary } from 'shared-types'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { VerifyWorkspaceAdmin, type VerifiedAdmin } from './VerifyWorkspaceAdmin'

type Step = 'closing' | 'pick-band' | 'target' | 'committing'

/**
 * Switches which band's hardware this Stage-Server serves, as one wizard - every step can be
 * aborted, and nothing changes on the server until the very last one:
 *
 * 1. (started by WorkspaceHardwareSettings.tsx's button)
 * 2. Only when some band is currently active: confirm the PIN of its admin. The name is never
 *    asked - it's this device's own current profile in that band (only an admin has one that
 *    passes) - and a wrong PIN ends the wizard's progress right here. A device with no admin
 *    session in that band picks one of that band's admins instead, listed by the server itself
 *    with no band code - it's the band this box is already running.
 * 3. Pick the target from every band the server hosts.
 * 4. The target's band code - only when this device has no cached admin session for it.
 * 5. The target's admins, 6. the chosen admin's PIN (own, or the universal recovery code).
 * 7. Only then is the switch committed, with both proofs verified by the server again.
 *
 * Afterwards this device follows the switch (shows the new band as the admin it just proved
 * itself as): a band it has cached via `activateProfile`, one it never saw via `joinAsMember`
 * (which needs the code from step 4 - why the target step hands it back).
 */
export function SwitchServerBandWizard({
  bands,
  activeWorkspaceId,
  onClose,
}: {
  bands: WorkspaceSummary[]
  activeWorkspaceId: string | null
  onClose: (switched: boolean) => void
}) {
  const activateWorkspaceHardware = useWorkspaceStore((state) => state.activateWorkspaceHardware)
  const activateProfile = useWorkspaceStore((state) => state.activateProfile)
  const joinAsMember = useWorkspaceStore((state) => state.joinAsMember)
  const fetchActiveWorkspaceAdmins = useWorkspaceStore((state) => state.fetchActiveWorkspaceAdmins)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const setActiveProfile = useActiveProfileStore((state) => state.setActive)

  const [step, setStep] = useState<Step>(activeWorkspaceId ? 'closing' : 'pick-band')
  const [closing, setClosing] = useState<AdminPinProof | null>(null)
  const [target, setTarget] = useState<WorkspaceSummary | null>(null)

  const closingBand = activeWorkspaceId
    ? (bands.find((b) => b.workspaceId === activeWorkspaceId) ?? { workspaceId: activeWorkspaceId, workspaceName: activeWorkspaceId })
    : null

  // "The current user of the band": this device's own profile in the active band, but only if
  // this device actually holds an admin session there.
  function closingKnownProfileId(): string | undefined {
    if (!activeWorkspaceId) return undefined
    const local = useWorkspaceStore.getState().workspaces.find((w) => w.id === activeWorkspaceId)
    const ownProfileId = useActiveProfileStore.getState().byWorkspace[activeWorkspaceId]
    return local?.isAdmin && ownProfileId ? ownProfileId : undefined
  }

  async function commit(targetBand: WorkspaceSummary, admin: VerifiedAdmin) {
    setStep('committing')
    const ok = await activateWorkspaceHardware(targetBand.workspaceId, { profileId: admin.profileId, pin: admin.pin }, closing ?? undefined)
    if (!ok) {
      setStep('pick-band')
      return
    }

    const cached = useWorkspaceStore.getState().workspaces.find((w) => w.id === targetBand.workspaceId)
    if (cached?.username && cached.couchPassword) {
      await activateProfile(targetBand.workspaceId, admin.profileId, admin.pin)
      setActiveWorkspace(targetBand.workspaceId)
    } else if (admin.code) {
      await joinAsMember(targetBand.workspaceId, targetBand.workspaceName, admin.code, admin.profileId, admin.pin)
    }
    setActiveProfile(targetBand.workspaceId, admin.profileId)
    onClose(true)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-sb border border-line bg-surface p-6 text-ink">
        {step === 'closing' && closingBand && (
          <VerifyWorkspaceAdmin
            key={`closing-${closingBand.workspaceId}`}
            workspaceId={closingBand.workspaceId}
            workspaceName={closingBand.workspaceName}
            knownProfileId={closingKnownProfileId()}
            loadAdmins={fetchActiveWorkspaceAdmins}
            onVerified={(admin) => {
              setClosing({ profileId: admin.profileId, pin: admin.pin })
              setStep('pick-band')
            }}
            onCancel={() => onClose(false)}
          />
        )}

        {step === 'pick-band' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">Zu welcher Band wechseln?</h2>
              <p className="mt-1 text-sm text-ink-muted">Alle Bands auf diesem Stage-Server.</p>
            </div>
            <ul className="space-y-2">
              {bands.map((band) => {
                const isActive = band.workspaceId === activeWorkspaceId
                return (
                  <li key={band.workspaceId}>
                    <button
                      type="button"
                      disabled={isActive}
                      onClick={() => {
                        setTarget(band)
                        setStep('target')
                      }}
                      className="flex w-full items-center justify-between rounded-sb border border-line bg-control px-4 py-3 text-left font-semibold hover:bg-control-hover disabled:opacity-50"
                    >
                      <span>{band.workspaceName}</span>
                      {isActive && <span className="text-xs font-normal text-ink-faint">Aktiv</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            <button type="button" onClick={() => onClose(false)} className="w-full text-center text-xs text-ink-faint underline">
              Abbrechen
            </button>
          </div>
        )}

        {step === 'target' && target && (
          <VerifyWorkspaceAdmin
            key={`target-${target.workspaceId}`}
            workspaceId={target.workspaceId}
            workspaceName={target.workspaceName}
            onVerified={(admin) => void commit(target, admin)}
            onCancel={() => onClose(false)}
          />
        )}

        {step === 'committing' && <p className="text-center text-sm text-ink-muted">Wechsle Band…</p>}
      </div>
    </div>
  )
}
