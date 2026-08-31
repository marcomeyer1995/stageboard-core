import { useEffect, useState } from 'react'
import { renderQrCode } from '../lib/qrCode'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * "Here's how to get onto your own device" screen (see #21), shown right after
 * BandManagementView.tsx's "+ Neues Mitglied" provisions a brand-new member's personal CouchDB
 * account with a server-generated (not PIN) password - per-person-accounts follow-up: every
 * invite is for one specific, already-provisioned person now, not "the" shared member secret,
 * so this always needs to be told exactly whose credential to wrap. Mints one short-lived code
 * via createInvite (useWorkspaceStore.ts) and shows it as both a QR code (JoinBandView.tsx's
 * camera scans this) and plain digits (its manual-entry fallback).
 */
export function InviteBandView({
  workspaceId,
  member,
  onClose,
}: {
  workspaceId: string
  member: { username: string; password: string; isAdmin?: boolean }
  onClose: () => void
}) {
  const createInvite = useWorkspaceStore((state) => state.createInvite)
  const { username, password, isAdmin } = member

  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)

  // Depends on `member`'s individual fields, not the object itself: `member` is a fresh object
  // each render at the one call site that mounts this (BandManagementView.tsx), so depending on
  // its identity would re-mint the invite on every unrelated re-render instead of once per
  // member.
  useEffect(() => {
    let cancelled = false
    void createInvite(workspaceId, { username, password, isAdmin }).then((invite) => {
      if (cancelled) return
      if (!invite) {
        setError('Einladung konnte nicht erstellt werden.')
        return
      }
      setCode(invite.code)
      setExpiresAt(invite.expiresAt)
      void renderQrCode(invite.code).then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId, username, password, isAdmin, createInvite])

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => setRemainingMs(Math.max(0, expiresAt - Date.now()))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const remainingMinutes = Math.floor(remainingMs / 60_000)
  const remainingSeconds = Math.floor((remainingMs % 60_000) / 1000)
  const expired = expiresAt !== null && remainingMs <= 0

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      {/* max-h-[90vh] + overflow-y-auto: a landscape phone/tablet viewport can be shorter
          than this card's content (QR image + code + copy) - without a scroll fallback the
          bottom (including the only way to close it) would be unreachable. */}
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-sb border border-line bg-surface p-6 text-ink">
        <h2 className="text-xl font-bold">Band einladen</h2>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {!error && !code && <p className="text-sm text-ink-muted">Erstelle Einladung…</p>}

        {code && (
          <>
            <p className="text-sm text-ink-muted">
              QR-Code scannen oder Code eingeben lassen - "Band beitreten" auf dem neuen Gerät.
            </p>
            {qrDataUrl && (
              <img src={qrDataUrl} alt={`QR-Code für Einladungscode ${code}`} className="mx-auto w-48" />
            )}
            <p className="text-center text-2xl font-bold tracking-widest">{code}</p>
            <p className="text-center text-xs text-ink-faint">
              {expired
                ? 'Abgelaufen - für einen neuen Code erneut öffnen.'
                : `Gültig noch ${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')}`}
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-sb bg-control px-4 py-2 font-semibold text-ink-soft hover:bg-control-hover"
        >
          Schließen
        </button>
      </div>
    </div>
  )
}
