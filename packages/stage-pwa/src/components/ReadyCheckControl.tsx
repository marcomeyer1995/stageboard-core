import { useTranslation } from 'react-i18next'
import { useReadyCheck } from '../lib/useReadyCheck'
import { useProfilesStore } from '../store/useProfilesStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { Icon } from './Icon'

/** The Master's Ready Check control (#60), for NextSongWidget: starts a check, then shows the
 * live "x/y bereit" count (who is still missing on hover) with a button to close it early. */
/** `compact`: "Ready" / "3/4" for narrow widgets. `buttonClassName` lets the host widget size the
 * buttons (Next Song fills its height with them - lib/gigWidgetLayout.ts). */
export function ReadyCheckControl({ compact = false, buttonClassName }: { compact?: boolean; buttonClassName?: string } = {}) {
  const { t } = useTranslation('common')
  const startReadyCheck = useShowStateStore((state) => state.startReadyCheck)
  const endReadyCheck = useShowStateStore((state) => state.endReadyCheck)
  const profiles = useProfilesStore((state) => state.profiles)
  const { checkId, status } = useReadyCheck()
  const buttonClass = buttonClassName ?? 'rounded-control bg-control-strong px-3 py-1 font-medium text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'

  if (!checkId || !status) {
    return (
      <button type="button" onClick={() => void startReadyCheck()} title={t('rc.askTitle')} className={buttonClass}>
        {compact ? t('rc.short') : t('rc.title')}
      </button>
    )
  }

  const missing = status.missingProfileIds.map((id) => profiles.find((profile) => profile.id === id)?.name ?? t('rc.unknown'))
  return (
    <div className="flex h-full items-center gap-2">
      <span
        title={missing.length > 0 ? t('rc.waiting', { names: missing.join(', ') }) : t('rc.allReady')}
        className={`font-bold tabular-nums ${status.allReady ? 'text-ok' : 'text-ink'}`}
      >
        {status.allReady && <Icon name="check" className="mr-1" />}
        {status.ready}/{status.total}{compact ? '' : ' bereit'}
      </span>
      <button type="button" onClick={() => void endReadyCheck()} title={t('rc.endTitle')} className={buttonClass}>
        {t('rc.end')}
      </button>
    </div>
  )
}
