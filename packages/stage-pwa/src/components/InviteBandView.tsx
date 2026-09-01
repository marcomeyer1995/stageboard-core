import { useEffect, useState } from 'react'
import { renderQrCode } from '../lib/qrCode'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * "Band beitreten" QR/code screen (see #21, redesigned 2026-09-01 at Marco's request) - one
 * band-level, reusable code, not tied to any specific person. Mints it via createInvite
 * (useWorkspaceStore.ts) and shows it as both a QR code (JoinBandView.tsx's camera scans this)
 * and plain digits (its manual-entry fallback). The joining device looks up the roster with
 * this code and self-service-picks who it is - nothing person-specific happens here anymore.
 */
export function InviteBandView({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const createInvite = useWorkspaceStore((state) => state.createInvite)

  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)

  useEffect(() => {
    let cancelled = false
    void createInvite(workspaceId).then((invite) => {
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
  }, [workspaceId, createInvite])

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
