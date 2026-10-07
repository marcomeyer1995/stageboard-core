import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildJoinUrl, renderQrCode } from '../lib/qrCode'
import { fetchServerAddress } from '../lib/serverInfo'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useBackHandler } from '../lib/backNavigation'
import { printPage } from '../lib/native'
import { Button } from './ui'

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
 *
 * 2026-09-02 seventh follow-up, at Marco's explicit request: the QR now encodes a real
 * `https://<LAN IP>/?ws=&code=` URL (`buildJoinUrl`), not just `workspaceId:code` text, so a
 * phone's *native* camera app can open it directly and land on the right Stage-Server, not only
 * the in-app scanner. The IP is fetched fresh (`fetchServerAddress`) every time this screen mounts - so
 * every "Einladen" press embeds whatever address is current right now, not a stale build-time
 * or first-load one - and shown as plain text alongside the QR, with a note that the code needs
 * regenerating if that address ever changes, since there's no way to update an already-printed
 * QR code after the fact.
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
  useBackHandler(onClose)
  const getAccessCode = useWorkspaceStore((state) => state.getAccessCode)
  const rotateAccessCode = useWorkspaceStore((state) => state.rotateAccessCode)
  const bandName = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === workspaceId)?.name ?? '')
  const confirm = useDialogStore((state) => state.confirm)

  const [code, setCode] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [server, setServer] = useState<{ lanIp: string; certFingerprint: string | null } | null>(null)
  const lanIp = server?.lanIp ?? null
  const [error, setError] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  async function loadQr(nextCode: string, address: { lanIp: string; certFingerprint: string | null } | null) {
    // The QR carries workspaceId+code together (WiFi-QR-style - SSID and password in one
    // scan) either way; wrapped in a real URL when the server's current LAN IP is known, so a
    // scanning device's native camera app can open it directly - falls back to the older bare
    // `workspaceId:code` text (still fine for the in-app scanner) if the IP couldn't be
    // determined, rather than blocking the invite screen on that.
    const payload = address ? buildJoinUrl(address.lanIp, workspaceId, nextCode, address.certFingerprint) : `${workspaceId}:${nextCode}`
    const url = await renderQrCode(payload)
    setQrDataUrl(url)
  }

  useEffect(() => {
    let cancelled = false
    // Fetched fresh on every mount, i.e. every time "Einladen" is opened (Marco's explicit
    // request) - not cached/reused, so a QR regenerated after the server's IP changes always
    // reflects the current address, never a stale one from an earlier visit to this screen.
    const addressPromise = fetchServerAddress().then((address) => {
      if (!cancelled) setServer(address)
      return address
    })
    void getAccessCode(workspaceId).then(async (result) => {
      if (cancelled) return
      if (!result) {
        setError('Code konnte nicht geladen werden.')
        return
      }
      setCode(result.code)
      void loadQr(result.code, await addressPromise)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, getAccessCode])

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      {/* max-h-[90vh] + overflow-y-auto: a landscape phone/tablet viewport can be shorter
          than this card's content (QR image + code + copy) - without a scroll fallback the
          bottom (including the only way to close it) would be unreachable. Printing uses its
          own sheet below - this overlay inside the scrolling app never made it onto the page
          (the printout showed the app behind it, 2026-10-07). */}
      <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-container border border-line bg-surface p-6 text-ink">
        <h2 className="text-xl font-bold">{isFoundingSummary ? 'Code speichern!' : 'Band einladen'}</h2>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {!error && !code && <p className="text-sm text-ink-muted">Lade Code…</p>}

        {code && (
          <>
            <p className="text-sm text-ink-muted">
              {isFoundingSummary
                ? 'Das ist der einzige Weg zurück in diese Band, falls du dich einmal aussperrst - jetzt notieren, ausdrucken oder als PDF speichern. QR-Code scannen oder Code eingeben lassen - "Band beitreten" auf einem neuen Gerät.'
                : 'QR-Code scannen oder Code eingeben lassen - "Band beitreten" auf dem neuen Gerät. Dieser Code bleibt gültig, bis er neu erzeugt wird.'}
            </p>
            {qrDataUrl && <img src={qrDataUrl} alt={`QR-Code für Bandcode ${code}`} className="mx-auto w-48" />}
            <p className="text-center text-2xl font-bold tracking-widest">{code}</p>
            {lanIp ? (
              <p className="text-center text-xs text-ink-faint">
                Im QR-Code enthaltene Server-Adresse: {lanIp}
                <br />
                Ändert sich diese Adresse später, muss der QR-Code hier neu erstellt werden - der Code selbst ({code}
                ) bleibt dabei gültig.
              </p>
            ) : (
              <p className="text-center text-xs text-ink-faint">
                Server-Adresse konnte nicht ermittelt werden - der QR-Code funktioniert nur mit der Kamera in der App,
                nicht mit einer normalen Kamera-App.
              </p>
            )}
            <button
              type="button"
              onClick={() => void printPage(`StageBoard - ${bandName || 'Band'} einladen`)}
              className="w-full min-h-form rounded-control bg-control-strong px-4 font-semibold text-ink [@media(hover:hover)]:hover:bg-control-hover"
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
                void loadQr(result.code, server)
              }}
              className="min-h-form w-full text-center text-base text-ink-faint underline disabled:opacity-50"
            >
              {rotating ? 'Erzeuge neuen Code…' : 'Code ändern'}
            </button>
          </>
        )}

        {/* Nothing to confirm here - one "Fertig" at the bottom (docs/15 D6). */}
        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        </div>
      </div>
      {code &&
        createPortal(
          <PrintSheet bandName={bandName} code={code} qrDataUrl={qrDataUrl} lanIp={lanIp} />,
          document.body,
        )}
    </div>
  )
}

/** What goes on paper (index.css `.sb-print-sheet`): black on white, whatever the theme. */
function PrintSheet({ bandName, code, qrDataUrl, lanIp }: { bandName: string; code: string; qrDataUrl: string | null; lanIp: string | null }) {
  useEffect(() => {
    document.body.classList.add('sb-has-print-sheet')
    return () => document.body.classList.remove('sb-has-print-sheet')
  }, [])
  return (
    <div className="sb-print-sheet" data-testid="print-sheet" style={{ color: '#000', background: '#fff', padding: '24mm 18mm', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '26pt', fontWeight: 700, margin: 0 }}>{bandName || 'Band'}</h1>
      <p style={{ fontSize: '13pt', margin: '6mm 0 10mm' }}>
        StageBoard - Einladung. Auf dem neuen Gerät „Band beitreten“ wählen und den QR-Code scannen oder den Code eingeben.
      </p>
      {qrDataUrl && <img src={qrDataUrl} alt="" style={{ width: '70mm', height: '70mm', display: 'block' }} />}
      <p style={{ fontSize: '28pt', fontWeight: 700, letterSpacing: '0.2em', margin: '8mm 0 2mm' }}>{code}</p>
      <p style={{ fontSize: '11pt', margin: 0 }}>
        {lanIp ? `Stage-Server: ${lanIp} - ändert sich diese Adresse, den QR-Code neu ausdrucken (der Code bleibt gültig).` : 'Server-Adresse unbekannt - der QR-Code funktioniert nur mit der Kamera in der App.'}
      </p>
      <p style={{ fontSize: '10pt', marginTop: '10mm', color: '#444' }}>
        Gültig, bis der Code in der App neu erzeugt wird. Gedruckt am {new Date().toLocaleDateString('de-DE')}.
      </p>
    </div>
  )
}
