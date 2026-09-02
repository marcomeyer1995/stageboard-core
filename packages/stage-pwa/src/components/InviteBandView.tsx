import { useEffect, useState } from 'react'
import { renderQrCode } from '../lib/qrCode'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * "Band beitreten" QR/code screen (see #21, redesigned 2026-09-01 at Marco's explicit request
 * after losing every device's cached admin credential at once with no way back in) - modeled
 * directly on WiFi: one standing, non-expiring code per band, shown here, either typed in
 * manually (alongside picking the band by name on the joining device) or scanned as a QR that
 * carries both the band and the code together, like a WiFi QR carries SSID + password. Fetches
 * (never mints) the *current* code via `useWorkspaceStore.ts`'s `getAccessCode` - opening this
 * view never changes anything by itself. "Code ändern" is the one deliberate action that does
 * (`rotateAccessCode`), for "the code leaked" or routine post-tour cleanup.
 *
 * 2026-09-02 sixth follow-up, at Marco's explicit request: also reused, unmodified except for
 * `isFoundingSummary`'s copy/label swap, as `RosterSetupView.tsx`'s final phase - the whole
 * point of this session's earlier lockouts was losing this exact code, so founding a band now
 * ends on this same screen instead of relying on someone remembering to open "Einladen" later.
 * "Drucken" (`window.print()`, browser-native - every OS's print dialog already offers "Save as
 * PDF" as a destination, no PDF library needed) uses `print:` Tailwind variants to hide
 * everything except the QR/code themselves, and to escape the `fixed`/`overflow-y-auto` modal
 * chrome that would otherwise clip or blank the printed page.
 */
export function InviteBandView({
  workspaceId,
  onClose,
  isFoundingSummary = false,
}: {
  workspaceId: string
  onClose: () => void
  isFoundingSummary?: boolean
}) {
  const getAccessCode = useWorkspaceStore((state) => state.getAccessCode)
  const rotateAccessCode = useWorkspaceStore((state) => state.rotateAccessCode)
  const confirm = useDialogStore((state) => state.confirm)

  const [code, setCode] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  async function loadQr(nextCode: string) {
    // The QR carries workspaceId+code together (WiFi-QR-style - SSID and password in one
    // scan), so a scanning device can skip straight to the roster picker without first
    // browsing/picking this band by name from JoinBandView.tsx's list.
    const url = await renderQrCode(`${workspaceId}:${nextCode}`)
    setQrDataUrl(url)
  }

  useEffect(() => {
    let cancelled = false
    void getAccessCode(workspaceId).then((result) => {
      if (cancelled) return
      if (!result) {
        setError('Code konnte nicht geladen werden.')
        return
      }
      setCode(result.code)
      void loadQr(result.code)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, getAccessCode])

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/60 p-4 print:relative print:inset-auto print:block print:bg-white print:p-0">
      {/* max-h-[90vh] + overflow-y-auto: a landscape phone/tablet viewport can be shorter
          than this card's content (QR image + code + copy) - without a scroll fallback the
          bottom (including the only way to close it) would be unreachable. print: overrides
          escape all of that for the printed page itself - a fixed/clipped/scrollable modal
          would otherwise print blank or cropped. */}
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-sb border border-line bg-surface p-6 text-ink print:max-h-none print:w-full print:max-w-none print:overflow-visible print:border-0 print:p-0">
        <h2 className="text-xl font-bold">{isFoundingSummary ? 'Code speichern!' : 'Band einladen'}</h2>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {!error && !code && <p className="text-sm text-ink-muted">Lade Code…</p>}

        {code && (
          <>
            <p className="text-sm text-ink-muted print:text-black">
              {isFoundingSummary
                ? 'Das ist der einzige Weg zurück in diese Band, falls du dich einmal aussperrst - jetzt notieren, ausdrucken oder als PDF speichern. QR-Code scannen oder Code eingeben lassen - "Band beitreten" auf einem neuen Gerät.'
                : 'QR-Code scannen oder Code eingeben lassen - "Band beitreten" auf dem neuen Gerät. Dieser Code bleibt gültig, bis er neu erzeugt wird.'}
            </p>
            {qrDataUrl && <img src={qrDataUrl} alt={`QR-Code für Bandcode ${code}`} className="mx-auto w-48" />}
            <p className="text-center text-2xl font-bold tracking-widest print:text-black">{code}</p>
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full rounded-sb border border-line bg-surface px-4 py-2 font-semibold hover:bg-control-hover print:hidden"
            >
              Drucken / als PDF speichern
            </button>
            <button
              type="button"
              disabled={rotating}
              onClick={async () => {
                const confirmed = await confirm(
                  'Neuen Code erzeugen? Der alte Code funktioniert danach nicht mehr - auf jedem Gerät, das ihn nur kennt, aber noch nicht beigetreten ist.',
                  { confirmLabel: 'Neu erzeugen', danger: true },
                )
                if (!confirmed) return
                setRotating(true)
                const result = await rotateAccessCode(workspaceId)
                setRotating(false)
                if (!result) return
                setCode(result.code)
                void loadQr(result.code)
              }}
              className="w-full text-center text-xs text-ink-faint underline disabled:opacity-50 print:hidden"
            >
              {rotating ? 'Erzeuge neuen Code…' : 'Code ändern'}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-sb bg-control px-4 py-2 font-semibold text-ink-soft hover:bg-control-hover print:hidden"
        >
          {isFoundingSummary ? 'Fertig' : 'Schließen'}
        </button>
      </div>
    </div>
  )
}
