import { useEffect, useRef, useState } from 'react'
import type { WorkspaceRoster } from 'shared-types'
import { decodeQrFrame } from '../lib/qrCode'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { BackToWorkingBandLink } from './BackToWorkingBandLink'

type CameraStatus = 'idle' | 'requesting' | 'scanning' | 'denied' | 'insecure-context' | 'unsupported'

/**
 * Shown by App.tsx instead of the Dashboard whenever the active workspace has no stored
 * CouchDB credentials yet (see #21) - replaces the old bare `window.prompt()`
 * (`useEnsureWorkspaceCredentials.ts`, removed) with a real join screen: scan the QR code
 * shown on the band admin's device (InviteBandView.tsx), or type the same 8-digit code by
 * hand.
 *
 * 2026-09-01 redesign, at Marco's request: the code is no longer tied to any one person, so
 * scanning/entering it doesn't join immediately anymore - it fetches the workspace's roster
 * (`useWorkspaceStore.ts`'s `fetchRoster`) and shows a "wer bist du?" picker. Picking a name
 * either joins right away (a brand-new roster entry with no CouchDB account yet gets
 * auto-provisioned server-side) or, for a name whose account already exists
 * (`RosterMember.requiresPassword`), asks for that person's password first - `joinAsMember`
 * verifies it server-side and only then hands back real credentials. This is the same
 * "resolve a code, get credentials" trust boundary the old one-step flow had, just split into
 * two requests so the joining device - not the admin - is the one who says who it is.
 *
 * A brand-new device starts knowing about zero workspaces (`useWorkspaceStore.ts` no longer
 * seeds hardcoded defaults) - this is the very first screen for someone who just downloaded
 * the app, so "start a new band" has to be an equally visible option here, not buried in the
 * menu's WorkspaceSwitcher, which this screen has no obvious reason to go looking for yet.
 *
 * The "Passwort direkt eingeben" fallback is the pre-#21 raw-credential mechanism, kept for
 * script-provisioned dev workspaces (`scripts/setup-couchdb.sh`), which have no admin device
 * to mint an invite from at all - it now also asks for the workspace id itself, since without
 * hardcoded defaults there's no already-selected-but-uncredentialed workspace to attach a
 * password to anymore.
 *
 * The `<video>` element is always mounted (visibility toggled via CSS), never conditionally
 * rendered on `cameraStatus` - attaching `stream` to `videoRef.current` happens right after
 * `await getUserMedia(...)`, and if the video element only existed once `cameraStatus` was
 * already 'scanning', `videoRef.current` would still be null at that point (that state
 * update hasn't committed to the DOM yet), silently no-opping the whole attachment. Real bug,
 * found live on Android (black preview, no error) - a fast/cached permission grant on desktop
 * apparently let React batch past it, why it looked fine there.
 */
export function JoinBandView() {
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace)
  const fetchRoster = useWorkspaceStore((state) => state.fetchRoster)
  const joinAsMember = useWorkspaceStore((state) => state.joinAsMember)
  const joinWithPassword = useWorkspaceStore((state) => state.joinWithPassword)
  const promptText = useDialogStore((state) => state.promptText)

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle')
  const [manualCode, setManualCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPasswordFallback, setShowPasswordFallback] = useState(false)
  const [fallbackWorkspaceId, setFallbackWorkspaceId] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  // Set once fetchRoster succeeds - roster !== null is what switches this screen from
  // "enter a code" to "pick your name". `code` travels alongside it: joinAsMember has to
  // re-present the same code (the server re-validates its TTL), not just the workspaceId
  // this step already learned.
  const [code, setCode] = useState<string | null>(null)
  const [roster, setRoster] = useState<WorkspaceRoster | null>(null)
  // Which roster row is expanded with a password prompt - only ever a `requiresPassword: true`
  // entry; picking anyone else joins immediately with no extra step.
  const [passwordProfileId, setPasswordProfileId] = useState<string | null>(null)
  const [memberPasswordInput, setMemberPasswordInput] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRequestRef = useRef<number | null>(null)
  const busyRef = useRef(false)

  function stopCamera() {
    if (frameRequestRef.current !== null) cancelAnimationFrame(frameRequestRef.current)
    frameRequestRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
  }

  useEffect(() => stopCamera, [])

  async function handleFetchRoster(enteredCode: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const result = await fetchRoster(enteredCode)
    setBusy(false)
    busyRef.current = false
    if (result) {
      setCode(enteredCode)
      setRoster(result)
    }
  }

  async function handleJoinAs(profileId: string, memberPassword?: string) {
    if (busyRef.current || !code || !roster) return
    busyRef.current = true
    setBusy(true)
    await joinAsMember(code, roster.workspaceId, roster.workspaceName, profileId, memberPassword)
    setBusy(false)
    busyRef.current = false
    // No further action needed either way: on success, App.tsx notices the newly-added
    // workspace and stops rendering this screen on its own; on failure, joinAsMember already
    // alerted why, and the picker/password prompt just stays put for another attempt.
  }

  function handlePickMember(member: WorkspaceRoster['members'][number]) {
    if (member.requiresPassword) {
      setPasswordProfileId(member.profileId)
      setMemberPasswordInput('')
    } else {
      void handleJoinAs(member.profileId)
    }
  }

  function scanFrame() {
    const video = videoRef.current
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      frameRequestRef.current = requestAnimationFrame(scanFrame)
      return
    }

    canvasRef.current ??= document.createElement('canvas')
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const scannedCode = decodeQrFrame(frame)
      if (scannedCode) {
        stopCamera()
        setCameraStatus('idle')
        void handleFetchRoster(scannedCode)
        return
      }
    }
    frameRequestRef.current = requestAnimationFrame(scanFrame)
  }

  async function startCamera() {
    if (!window.isSecureContext) {
      setCameraStatus('insecure-context')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('unsupported')
      return
    }
    setCameraStatus('requesting')
    try {
      // { ideal: 'environment' }, not a bare string: some Android devices/browsers don't
      // reliably expose a camera labeled "environment" and reject a mandatory constraint
      // outright - ideal lets it fall back to whatever camera is available instead of failing.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      streamRef.current = stream
      // videoRef.current is always non-null here now (see the doc comment above) - the
      // `if` stays as defense against an unmount racing this async function, not because
      // the element might not exist yet.
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraStatus('scanning')
      frameRequestRef.current = requestAnimationFrame(scanFrame)
    } catch {
      setCameraStatus('denied')
    }
  }

  if (roster) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
        <div className="w-full max-w-sm space-y-4 py-4">
          <div>
            <h1 className="text-2xl font-bold">Wer bist du?</h1>
            <p className="mt-1 text-sm text-ink-muted">Band: {roster.workspaceName}</p>
          </div>

          <ul className="space-y-2">
            {roster.members.map((member) => (
              <li key={member.profileId} className="rounded-sb border border-line bg-surface">
                {passwordProfileId === member.profileId ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (memberPasswordInput.trim()) void handleJoinAs(member.profileId, memberPasswordInput.trim())
                    }}
                    className="flex flex-col gap-2 p-3"
                  >
                    <span className="font-semibold">{member.name}</span>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        autoFocus
                        value={memberPasswordInput}
                        onChange={(e) => setMemberPasswordInput(e.target.value)}
                        placeholder="PIN/Passwort"
                        className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-ink-soft"
                      />
                      <button
                        type="submit"
                        disabled={busy || !memberPasswordInput.trim()}
                        className="flex-shrink-0 rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
                      >
                        {busy ? '…' : 'Beitreten'}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPasswordProfileId(null)}
                      className="self-start text-xs text-ink-faint underline"
                    >
                      Abbrechen
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePickMember(member)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-control-hover disabled:opacity-50"
                  >
                    <span>
                      {member.name} <span className="text-sm text-ink-muted">({member.role})</span>
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => {
              setRoster(null)
              setCode(null)
              setPasswordProfileId(null)
            }}
            className="w-full text-center text-xs text-ink-faint underline"
          >
            Anderen Code verwenden
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
          <h1 className="text-2xl font-bold">Band beitreten</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Scanne den QR-Code vom Gerät des Band-Admins, oder gib den 8-stelligen Code manuell ein.
          </p>
        </div>

        {/* Fixed height, not aspect-square: aspect-square sized to full device width made
            this taller than the whole viewport in landscape on a phone/tablet, pushing
            everything else off-screen with nothing to scroll to. object-cover still fills
            this box regardless of the camera's actual aspect ratio. */}
        <div className="relative h-56 overflow-hidden rounded-sb border border-line bg-surface">
          <video
            ref={videoRef}
            className={`h-full w-full object-cover ${cameraStatus === 'scanning' ? '' : 'hidden'}`}
            muted
            playsInline
            autoPlay
          />
          {cameraStatus !== 'scanning' && (
            <button
              type="button"
              onClick={() => void startCamera()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-muted"
            >
              <span className="text-4xl">📷</span>
              {cameraStatus === 'idle' && <span>Kamera zum Scannen starten</span>}
              {cameraStatus === 'requesting' && <span>Kamerazugriff wird angefragt…</span>}
              {cameraStatus === 'denied' && <span className="text-sm">Kein Kamerazugriff - Code manuell eingeben.</span>}
              {cameraStatus === 'insecure-context' && (
                <span className="text-sm">Kamera braucht HTTPS - Code manuell eingeben.</span>
              )}
              {cameraStatus === 'unsupported' && <span className="text-sm">Kamera nicht verfügbar auf diesem Gerät.</span>}
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (manualCode.trim()) void handleFetchRoster(manualCode.trim())
          }}
          className="flex gap-2"
        >
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="12345678"
            inputMode="numeric"
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

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-ink-faint">oder</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <button
          type="button"
          onClick={async () => {
            const name = await promptText('Neue Band', { label: 'Name der neuen Band' })
            if (name?.trim()) void addWorkspace(name.trim())
          }}
          className="w-full rounded-sb border border-line bg-surface px-4 py-3 font-semibold text-ink-soft hover:bg-control-hover"
        >
          Neue Band gründen
        </button>

        <div>
          <button
            type="button"
            onClick={() => setShowPasswordFallback((v) => !v)}
            className="text-xs text-ink-faint underline"
          >
            Passwort direkt eingeben
          </button>
          {showPasswordFallback && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (fallbackWorkspaceId.trim() && username.trim() && password.trim()) {
                  joinWithPassword(fallbackWorkspaceId.trim(), username.trim(), password.trim(), isAdmin)
                }
              }}
              className="mt-2 flex flex-col gap-2"
            >
              <input
                value={fallbackWorkspaceId}
                onChange={(e) => setFallbackWorkspaceId(e.target.value)}
                placeholder="Workspace-ID (z.B. band-a)"
                className="h-12 rounded-sb bg-control px-3 text-ink-soft"
              />
              {/* Per-person-accounts follow-up: every account has its own username now, no
                  fixed formula to derive it from - has to be typed in alongside the password. */}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Benutzername (z.B. stageboard-band-a-p1)"
                className="h-12 rounded-sb bg-control px-3 text-ink-soft"
              />
              <div className="flex gap-2">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Passwort/PIN"
                  className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-ink-soft"
                />
                <button
                  type="submit"
                  className="flex-shrink-0 rounded-sb border border-line bg-surface px-4 py-2 font-semibold"
                >
                  OK
                </button>
              </div>
              {/* Self-declared, not verified here - a wrong guess only mis-shows admin UI,
                  CouchDB's roster validator is what actually enforces admin-only writes. */}
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  className="h-5 w-5"
                />
                Dies ist ein Admin-Konto
              </label>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
