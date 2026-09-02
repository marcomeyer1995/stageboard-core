import { useEffect, useRef, useState } from 'react'
import type { WorkspaceRoster, WorkspaceSummary } from 'shared-types'
import { decodeQrFrame, parseJoinPayload } from '../lib/qrCode'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
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
 *    device or session required at all. On success, `handleJoinAs` also calls
 *    `useActiveProfileStore`'s `setActive` with that exact profileId (2026-09-02 eighth
 *    follow-up, at Marco's explicit request) - the pick here already answered "wer bist du?",
 *    so without this App.tsx's `needsProfile` gate would immediately re-ask the identical
 *    question via ProfileRolePickerView right afterward.
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
 *
 * `onClose` (#68): also reused as a voluntary "join an additional band" flow from
 * `BandManagementView.tsx`, for a device that already has at least one working band - unlike
 * the forced App.tsx onboarding gate (no `onClose` there, nothing to close back to), this case
 * needs an explicit way out if the person changes their mind. Deliberately its own "Abbrechen"
 * button, not `BackToWorkingBandLink` (suppressed here, only shown for the forced gate) - found
 * live: that component lists every workspace *except* the active one, which for this voluntary
 * case is exactly backwards (the active workspace is the perfectly-working one someone opening
 * this dialog wants back, and clicking one of the *other* listed bands switches away from it
 * instead). "Abbrechen" never touches `activeWorkspaceId` at all, so simply closing already
 * leaves the untouched active workspace exactly where it was. Only rendered on step 1 (steps
 * 2/3 already have their own "back" links to get there first) and auto-fired after a
 * successful join, so the caller's overlay dismisses itself the moment there's something worth
 * showing instead.
 * `fixed inset-0` on the root (all three steps) rather than plain `h-dvh`: harmless when used
 * as App.tsx's onboarding gate (nothing else renders alongside it there), but required for this
 * new usage, where it has to sit on top of the already-rendered BandManagementView.tsx.
 */
export function JoinBandView({ onClose }: { onClose?: () => void } = {}) {
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace)
  const listWorkspaces = useWorkspaceStore((state) => state.listWorkspaces)
  const fetchRoster = useWorkspaceStore((state) => state.fetchRoster)
  const joinAsMember = useWorkspaceStore((state) => state.joinAsMember)
  const joinWithPassword = useWorkspaceStore((state) => state.joinWithPassword)
  const setActiveProfile = useActiveProfileStore((state) => state.setActive)
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

  // Picks up a `?ws=&code=` link (InviteBandView.tsx's `buildJoinUrl` - see #21 seventh
  // follow-up) opened by a *native* camera app rather than scanned in-app: same effect as a
  // successful in-app scan, skipping straight to step 3, so the URL doubles as both "open the
  // right Stage-Server" and "join this band" in one action, not just the former. Clears the
  // query string afterwards so a later reload/share of this URL doesn't repeat the same
  // roster fetch, or leak the code into browser history more than once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const workspaceId = params.get('ws')
    const linkCode = params.get('code')
    if (workspaceId && linkCode) {
      window.history.replaceState(null, '', window.location.pathname)
      void handleFetchRoster(workspaceId, linkCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleJoinAs(profileId: string, memberPassword?: string) {
    if (busyRef.current || !code || !roster) return
    busyRef.current = true
    setBusy(true)
    const workspace = await joinAsMember(roster.workspaceId, roster.workspaceName, code, profileId, memberPassword)
    setBusy(false)
    busyRef.current = false
    if (!workspace) return
    // Picking a roster member here already answered "wer bist du?" - without this, App.tsx's
    // needsProfile gate (activeProfileId still undefined) immediately re-asks the exact same
    // question via ProfileRolePickerView, whose list can even show empty right after a
    // password-less non-admin join (PouchDB sync hasn't pulled the `profiles:*` docs down yet -
    // an admin join looks fine only because typing the password bought sync more time). Same
    // fix as BandManagementView.tsx's performActivate for switching profiles later.
    setActiveProfile(roster.workspaceId, profileId)
    onClose?.()
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
      // The QR carries workspaceId+code together (InviteBandView.tsx's `buildJoinUrl`/legacy
      // pairing, parsed via the same `parseJoinPayload` App.tsx uses for a scanned-by-a-native-
      // camera-app link) - a scan skips straight to step 3, past both browsing the list and
      // typing a code by hand. Anything that doesn't parse is silently ignored and scanning
      // just continues, same as any unrelated QR code today.
      const payload = scanned ? parseJoinPayload(scanned) : null
      if (payload) {
        stopCamera()
        setCameraStatus('idle')
        void handleFetchRoster(payload.workspaceId, payload.code)
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
      <div className="fixed inset-0 z-20 flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
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
      <div className="fixed inset-0 z-20 flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
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
    <div className="fixed inset-0 z-20 flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <div className="w-full max-w-sm space-y-4 py-4">
        {!onClose && <BackToWorkingBandLink />}

        <div>
          <h1 className="text-2xl font-bold">Band beitreten</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Scanne den QR-Code vom Gerät des Band-Admins, oder wähle eine Band und gib ihren Code ein.
          </p>
        </div>

        {/* Only when opened voluntarily from BandManagementView.tsx (#68) - the forced
            App.tsx onboarding gate passes no onClose, since there's nothing to close back to
            with zero known bands. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-sb bg-control px-4 py-2 font-semibold text-ink-soft hover:bg-control-hover"
          >
            Abbrechen
          </button>
        )}

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
              {/* Inline SVG (Heroicons' outline "camera", MIT-licensed shape hand-copied - no
                  icon library dependency for one glyph), not the 📷 emoji: renders as a crisp,
                  theme-colored (currentColor) line icon on every platform/font instead of each
                  OS's own cartoonish camera-emoji glyph. */}
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-10 w-10">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.174C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.174 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
                />
              </svg>
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
