import { useReadyCheck } from '../lib/useReadyCheck'
import { useProfilesStore } from '../store/useProfilesStore'
import { useShowStateStore } from '../store/useShowStateStore'

/** The Master's Ready Check control (#60), for NextSongWidget: starts a check, then shows the
 * live "x/y bereit" count (who is still missing on hover) with a button to close it early. */
export function ReadyCheckControl() {
  const startReadyCheck = useShowStateStore((state) => state.startReadyCheck)
  const endReadyCheck = useShowStateStore((state) => state.endReadyCheck)
  const profiles = useProfilesStore((state) => state.profiles)
  const { checkId, status } = useReadyCheck()
  const buttonClass = 'rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover'

  if (!checkId || !status) {
    return (
      <button type="button" onClick={() => void startReadyCheck()} title="Alle Tablets fragen, ob die Band bereit ist" className={buttonClass}>
        Ready-Check
      </button>
    )
  }

  const missing = status.missingProfileIds.map((id) => profiles.find((profile) => profile.id === id)?.name ?? 'Unbekannt')
  return (
    <div className="flex items-center gap-2">
      <span
        title={missing.length > 0 ? `Warten auf: ${missing.join(', ')}` : 'Alle bereit'}
        className={`font-bold tabular-nums ${status.allReady ? 'text-green-500' : 'text-ink'}`}
      >
        {status.allReady ? '✓ ' : ''}
        {status.ready}/{status.total} bereit
      </span>
      <button type="button" onClick={() => void endReadyCheck()} title="Ready-Check beenden" className={buttonClass}>
        Ende
      </button>
    </div>
  )
}
