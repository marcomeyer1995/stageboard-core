import { useTranslation } from 'react-i18next'
import { useMasterTakeover } from '../lib/useMasterTakeover'

/** The "Master übernehmen" button shared by the transport/queue widgets (#32): plain claim
 * while the master is vacant or dead, "Force Takeover" against a live one (Admin/Showmaster
 * only - everyone else sees it disabled). */
export function MasterTakeoverButton({ className }: { className: string }) {
  const { t } = useTranslation('common')
  const { status, canClaim, isForce, claim } = useMasterTakeover()
  const title = isForce
    ? canClaim
      ? t('mt.force')
      : t('mt.forceDenied')
    : status === 'stale'
      ? t('mt.stale')
      : t('mt.noControl')

  return (
    <button type="button" onClick={claim} disabled={!canClaim} title={title} className={`${className} disabled:cursor-not-allowed disabled:opacity-40`}>
      {isForce ? t('mt.forceButton') : t('mt.claim')}
    </button>
  )
}
