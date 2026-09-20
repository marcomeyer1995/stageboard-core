import { useMasterTakeover } from '../lib/useMasterTakeover'

/** The "Master übernehmen" button shared by the transport/queue widgets (#32): plain claim
 * while the master is vacant or dead, "Force Takeover" against a live one (Admin/Showmaster
 * only - everyone else sees it disabled). */
export function MasterTakeoverButton({ className }: { className: string }) {
  const { status, canClaim, isForce, claim } = useMasterTakeover()
  const title = isForce
    ? canClaim
      ? 'Ein anderes Gerät ist aktiv Master - Force Takeover'
      : 'Ein anderes Gerät ist aktiv Master - nur Admin/Showmaster dürfen übernehmen'
    : status === 'stale'
      ? 'Das Master-Gerät antwortet nicht mehr'
      : 'Dieses Gerät hat aktuell keine Kontrolle über die Queue'

  return (
    <button type="button" onClick={claim} disabled={!canClaim} title={title} className={`${className} disabled:cursor-not-allowed disabled:opacity-40`}>
      {isForce ? 'Force Takeover' : 'Master übernehmen'}
    </button>
  )
}
