import { useEffect, useRef, useState } from 'react'
import type { WorkspaceRoster, WorkspaceSummary } from 'shared-types'
import { decodeQrFrame } from '../lib/qrCode'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { BackToWorkingBandLink } from './BackToWorkingBandLink'

type CameraStatus = 'idle' | 'requesting' | 'scanning' | 'denied' | 'insecure-context' | 'unsupported'

/**
 * Shown by App.tsx instead of the Dashboard whenever the active workspace has no stored
 * CouchDB credentials yet (see #21) - replaces the old bare `window.prompt()`
 * (`useEnsureWorkspaceCredentials.ts`, removed) with a real join screen.
 *
 * 2026-09-01 WiFi-style redesign, at Marco's explicit request after losing every device's
 * cached admin credential at once with no way back in: modeled directly on joining WiFi. Three
 * steps, matching `useWorkspaceStore.ts`'s three actions:
 * 1. `listWorkspaces()` - every band the currently-configured Stage-Server hosts, shown with no
 *    code needed at all (the SSID-list equivalent). Scanning a QR skips straight past this and
 *    the next step (the QR carries `workspaceId:code` together, `InviteBandView.tsx`'s pairing).
 * 2. Pick one, type its standing code (`fetchRoster`) - the "network password" step. The code
 *    never expires on its own; there's no TTL/countdown to fight through anymore.
 * 3. Pick who you are from that band's roster (`joinAsMember`). A non-admin entry
 *    (`RosterMember.isAdmin`) has no password concept at all anymore (2026-09-02 second
 *    follow-up, at Marco's explicit request, after locking himself out testing the *first*
 *    follow-up's design twice in one day) - tapping it just works, immediately, every time. An
 *    admin entry needs a 4-digit code: either that person's own self-assigned PIN, or the
 *    *universal* recovery code that always works for any admin here - the last 4 digits of the
 *    band's own access code (the one already typed in step 2). That's the actual
 *    account-recovery mechanism now: no separate secret to lose, and it works with nobody else's
 *    device or session required at all.
 *
 * "Neue Band gründen" stays equally visible on the landing step - a brand-new device knows
 * about zero workspaces (`useWorkspaceStore.ts` seeds none), so this is the very first screen
 * for someone who just downloaded the app.
 *
 * "Passwort direkt eingeben" is the pre-#21 raw-credential mechanism, kept for script-
 * provisioned dev workspaces (`scripts/setup-couchdb.sh`), which have no admin device to show a
 * code from at all.
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
  const listWorkspaces = useWorkspaceStore((state) => state.listWorkspaces)
  const fetchRoster = useWorkspaceStore((state) => state.fetchRoster)
  const joinAsMember = useWorkspaceStore((state) => state.joinAsMember)
  const joinWithPassword = useWorkspaceStore((state) => state.joinWithPassword)
  const promptText = useDialogStore((state) => state.promptText)

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle')
  const [busy, setBusy] = useState(false)
  const [showPasswordFallback, setShowPasswordFallback] = useState(false)
  const [fallbackWorkspaceId, setFallbackWorkspaceId] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)

  // Step 1: the SSID-list equivalent - every band the Stage-Server hosts, no code needed yet.
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false)

  // Step 2: one band picked from the list, waiting for its code.
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceSummary | null>(null)
  const [manualCode, setManualCode] = useState('')

  // Step 3: the roster picker, once a code resolved successfully.
  const [code, setCode] = useState<string | null>(null)
  const [roster, setRoster] = useState<WorkspaceRoster | null>(null)
  // Which roster row is expanded with a code prompt - only ever an `isAdmin: true` entry;
  // picking anyone else joins immediately with no extra step (2026-09-02 second follow-up: a
  // non-admin has no password concept at all anymore).
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

  async function loadWorkspaces() {
    setLoadingWorkspaces(true)
    const result = await listWorkspaces()
    setLoadingWorkspaces(false)
    setWorkspaces(result ?? [])
  }

  useEffect(() => {
    void loadWorkspaces()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleFetchRoster(workspaceId: string, enteredCode: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const result = await fetchRoster(workspaceId, enteredCode)
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
    await joinAsMember(roster.workspaceId, roster.workspaceName, code, profileId, memberPassword)
    setBusy(false)
    busyRef.current = false
    // No further action needed either way: on success, App.tsx notices the newly-added
    // workspace and stops rendering this screen on its own; on failure, joinAsMember already
    // alerted why, and the picker/password prompt just stays put for another attempt.
  }

  function handlePickMember(member: WorkspaceRoster['members'][number]) {
    if (member.isAdmin) {
      setPasswordProfileId(member.profileId)
      setMemberPasswordInput('')
    } else {
      void handleJoinAs(member.profileId)
    }
  }

  function backToList() {
    setRoster(null)
    setCode(null)
    setPasswordProfileId(null)
    setSelectedWorkspace(null)
    setManualCode('')
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
      const scanned = decodeQrFrame(frame)
      // The QR carries workspaceId+code together (InviteBandView.tsx's pairing) - a scan skips
      // straight to step 3, past both browsing the list and typing a code by hand. Anything
      // that doesn't look like that pairing is silently ignored and scanning just continues,
      // same as any unrelated QR code today.
      const separatorIndex = scanned?.indexOf(':') ?? -1
      if (scanned && separatorIndex > 0 && separatorIndex < scanned.length - 1) {
        const workspaceId = scanned.slice(0, separatorIndex)
        const scannedCode = scanned.slice(separatorIndex + 1)
        stopCamera()
        setCameraStatus('idle')
        void handleFetchRoster(workspaceId, scannedCode)
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

  // Step 3: pick who you are.
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
                      if (memberPasswordInput.length === 4) void handleJoinAs(member.profileId, memberPasswordInput)
                    }}
                    className="flex flex-col gap-2 p-3"
                  >
                    <span className="font-semibold">{member.name}</span>
                    <div className="flex gap-2">
                      <input
                        value={memberPasswordInput}
                        onChange={(e) => setMemberPasswordInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="4-stelliger Code"
                        inputMode="numeric"
                        autoFocus
                        className="h-12 min-w-0 flex-1 rounded-sb bg-control px-3 text-center text-lg tracking-widest text-ink-soft"
                      />
                      <button
                        type="submit"
                        disabled={busy || memberPasswordInput.length !== 4}
                        className="flex-shrink-0 rounded-sb bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
                      >
                        {busy ? '…' : 'Beitreten'}
                      </button>
                    </div>
                    {/* Admin-only screen (2026-09-02 second follow-up, at Marco's explicit
                        request) - only reached for an `isAdmin: true` entry. Deliberately no
                        hint here about the universal recovery code (the band code's own last 4
                        digits, also accepted alongside the person's own self-assigned PIN) -
                        2026-09-02 third follow-up, at Marco's explicit request: that mechanism
                        stays undocumented in the UI on purpose, known only to him. */}
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
                    <span>{member.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>

          <button type="button" onClick={backToList} className="w-full text-center text-xs text-ink-faint underline">
            Andere Band oder anderer Code
          </button>
        </div>
      </div>
    )
  }

  // Step 2: code entry, scoped to the band picked in step 1.
  if (selectedWorkspace) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
        <div className="w-full max-w-sm space-y-4 py-4">
          <div>
            <h1 className="text-2xl font-bold">{selectedWorkspace.workspaceName}</h1>
            <p className="mt-1 text-sm text-ink-muted">Code der Band eingeben - beim Admin erfragen oder QR-Code scannen.</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (manualCode.trim()) void handleFetchRoster(selectedWorkspace.workspaceId, manualCode.trim())
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

          <button type="button" onClick={backToList} className="w-full text-center text-xs text-ink-faint underline">
            Andere Band wählen
          </button>
        </div>
      </div>
    )
  }

  // Step 1: pick a band, or scan a QR to skip straight to step 3.
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <div className="w-full max-w-sm space-y-4 py-4">
        <BackToWorkingBandLink />

        <div>
          <h1 className="text-2xl font-bold">Band beitreten</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Scanne den QR-Code vom Gerät des Band-Admins, oder wähle eine Band und gib ihren Code ein.
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
              {cameraStatus === 'denied' && <span className="text-sm">Kein Kamerazugriff - Band unten auswählen.</span>}
              {cameraStatus === 'insecure-context' && (
                <span className="text-sm">Kamera braucht HTTPS - Band unten auswählen.</span>
              )}
              {cameraStatus === 'unsupported' && <span className="text-sm">Kamera nicht verfügbar auf diesem Gerät.</span>}
            </button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Verfügbare Bands</h2>
            <button type="button" onClick={() => void loadWorkspaces()} className="text-xs text-ink-faint underline">
              Neu laden
            </button>
          </div>
          {loadingWorkspaces && <p className="text-sm text-ink-muted">Lade…</p>}
          {!loadingWorkspaces && workspaces?.length === 0 && (
            <p className="text-sm text-ink-muted">Keine Band auf diesem Stage-Server gefunden.</p>
          )}
          {!loadingWorkspaces && workspaces && workspaces.length > 0 && (
            <ul className="space-y-2">
              {workspaces.map((workspace) => (
                <li key={workspace.workspaceId}>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkspace(workspace)}
                    className="w-full rounded-sb border border-line bg-surface px-4 py-3 text-left font-semibold hover:bg-control-hover"
                  >
                    {workspace.workspaceName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

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
