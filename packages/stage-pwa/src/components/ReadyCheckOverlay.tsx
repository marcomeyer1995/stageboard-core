import { useState } from 'react'
import { hasAnswered } from '../lib/readyCheck'
import { reportReady } from '../lib/reportReady'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useAppModeStore } from '../store/useAppModeStore'
import { usePresenceStore } from '../store/usePresenceStore'
import { useReadyCheckStore } from '../store/useReadyCheckStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Full-screen Ready Check prompt (#60): the bandleader opened a check, so every other tablet
 * dims the dashboard behind one huge "Ich bin bereit" button. Gig mode only - a musician
 * practicing alone (Solo Üben) is not on stage. The Master never sees it (its own profile
 * answers automatically, useReadyCheckResponder.ts).
 *
 * Deliberately subscribes to as little as possible (no useShowMode/elapsedMs, which tick every
 * animation frame during playback): AudioResumeOverlay.tsx's doc comment records what re-render
 * churn under a full-screen overlay does to the very tap it exists to catch.
 *
 * It goes away when this profile has answered (from any of its devices), when the Master closes
 * or restarts the check, or - for a device with no active profile, which cannot answer - via
 * "Schließen". A failed answer keeps the overlay up with a retry hint instead of pretending.
 */
export function ReadyCheckOverlay() {
  const mode = useAppModeStore((state) => state.mode)
  const checkId = useShowStateStore((state) => state.state.readyCheckId)
  const isMaster = useShowStateStore((state) => state.isMaster)
  const presence = usePresenceStore((state) => state.presence)
  const handledCheckId = useReadyCheckStore((state) => state.handledCheckId)
  const markHandled = useReadyCheckStore((state) => state.markHandled)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profile = useActiveProfile()
  const [failed, setFailed] = useState(false)
  const [sending, setSending] = useState(false)

  if (mode !== 'gig' || !checkId || isMaster || handledCheckId === checkId || hasAnswered(presence, checkId, profile?.id)) {
    return null
  }

  const answer = async () => {
    if (!profile) return markHandled(checkId)
    setSending(true)
    const ok = await reportReady(workspaceId, checkId, profile.id)
    setSending(false)
    setFailed(!ok)
    if (ok) markHandled(checkId)
  }

  return (
    <div role="dialog" aria-label="Ready-Check" className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-black/90 p-6 text-center">
      <p className="text-2xl font-bold uppercase tracking-widest text-ink-faint">Ready-Check</p>
      <p className="max-w-md text-lg text-ink-soft">
        {profile ? 'Auf der Bühne, In-Ears sitzen, Instrument an?' : 'Kein Profil gewählt - dieses Gerät kann nicht antworten.'}
      </p>
      <button
        type="button"
        disabled={sending}
        onClick={answer}
        className="w-full max-w-xl rounded-sb bg-accent px-8 py-12 text-4xl font-bold uppercase tracking-wide text-accent-ink hover:opacity-90 disabled:opacity-60"
      >
        {profile ? 'Ich bin bereit' : 'Schließen'}
      </button>
      {failed && <p className="text-base text-red-500">Keine Verbindung zum Stage-Server - bitte nochmal tippen.</p>}
    </div>
  )
}
