import { useShowPart } from '../lib/widgetParts'
import { useReadyCheck } from '../lib/useReadyCheck'
import { useAppModeStore } from '../store/useAppModeStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { Icon } from '../components/Icon'

const BUTTON = 'min-h-touch rounded-control bg-control-strong px-4 font-bold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'

/**
 * Ready-Check (#60) as its own widget (Marco, 2026-10-17: it sat in Next Song, where it didn't
 * belong). The master starts it and sees who is still missing; everyone else confirms through the
 * overlay (ReadyCheckOverlay) and sees the count here while a check runs.
 */
export function ReadyCheckWidget() {
  const isGig = useAppModeStore((state) => state.mode) === 'gig'
  const isMaster = useShowStateStore((state) => state.isMaster)
  const startReadyCheck = useShowStateStore((state) => state.startReadyCheck)
  const endReadyCheck = useShowStateStore((state) => state.endReadyCheck)
  const profiles = useProfilesStore((state) => state.profiles)
  const { checkId, status } = useReadyCheck()
  const showMissing = useShowPart('missing')

  if (!isGig) return <p className="flex h-full items-center justify-center text-center text-ink-faint">Nur im Gig</p>

  if (!checkId || !status) {
    return isMaster ? (
      <button
        type="button"
        onClick={() => void startReadyCheck()}
        title="Alle Tablets fragen, ob die Band bereit ist"
        className={`${BUTTON} h-full w-full text-xl`}
      >
        Ready-Check
      </button>
    ) : (
      <p className="flex h-full items-center justify-center text-center text-ink-faint">Ready-Check startet der Master</p>
    )
  }

  const missing = status.missingProfileIds.map((id) => profiles.find((profile) => profile.id === id)?.name ?? 'Unbekannt')
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-h-0 flex-1 items-center justify-between gap-3">
        <span className={`text-3xl font-bold tabular-nums ${status.allReady ? 'text-ok' : 'text-ink'}`}>
          {status.allReady && <Icon name="check" className="mr-1" />}
          {status.ready}/{status.total} bereit
        </span>
        {isMaster && (
          <button type="button" onClick={() => void endReadyCheck()} title="Ready-Check beenden" className={BUTTON}>
            Ende
          </button>
        )}
      </div>
      {showMissing && missing.length > 0 && <p className="truncate text-ink-soft">Warten auf: {missing.join(', ')}</p>}
    </div>
  )
}
