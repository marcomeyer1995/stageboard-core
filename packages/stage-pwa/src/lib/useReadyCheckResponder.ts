import { useEffect } from 'react'
import { hasAnswered } from './readyCheck'
import { reportReady } from './reportReady'
import { useActiveProfile } from './useActiveProfile'
import { useReadyCheck } from './useReadyCheck'
import { usePresenceStore } from '../store/usePresenceStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** How long a finished check (everyone ready) stays up before the Master's tablet closes it -
 * long enough to read "5/5 bereit". */
const AUTO_CLOSE_DELAY_MS = 3_000
/** Retry interval for the Master's own automatic answer while the Stage-Server does not take it. */
const REPORT_RETRY_MS = 3_000

/**
 * The Master's side of a Ready Check (#60), mounted once in App.tsx:
 * - The Master opened the check, so its own profile counts as ready without a tap.
 * - Once every online profile has answered, it closes the check after a moment, which dismisses
 *   the "Gig läuft" state for everyone.
 * Musicians answer through ReadyCheckOverlay.tsx; this hook does nothing on their tablets.
 */
export function useReadyCheckResponder(): void {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const endReadyCheck = useShowStateStore((state) => state.endReadyCheck)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profileId = useActiveProfile()?.id
  const presence = usePresenceStore((state) => state.presence)
  const { checkId, status } = useReadyCheck()

  const answered = checkId !== null && hasAnswered(presence, checkId, profileId)
  useEffect(() => {
    if (!isMaster || !checkId || !profileId || answered) return
    const send = () => void reportReady(workspaceId, checkId, profileId)
    send()
    const retry = setInterval(send, REPORT_RETRY_MS)
    return () => clearInterval(retry)
  }, [isMaster, checkId, profileId, workspaceId, answered])

  const allReady = status?.allReady ?? false
  useEffect(() => {
    if (!isMaster || !allReady) return
    const timer = setTimeout(() => void endReadyCheck(), AUTO_CLOSE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isMaster, allReady, endReadyCheck])
}
