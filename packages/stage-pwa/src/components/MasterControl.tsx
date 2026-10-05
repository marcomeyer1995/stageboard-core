import { useQueue } from '../lib/queue'
import { useDeviceName } from '../store/useDevicesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useMasterTakeover } from '../lib/useMasterTakeover'
import { useShowStateStore } from '../store/useShowStateStore'
import { profileIdOfMasterHolder, type MasterSelfCheck } from '../lib/masterTakeover'
import { useProfilesStore } from '../store/useProfilesStore'

/**
 * The Master-Token claim, previously reachable only from inside NextSongWidget/
 * LiveQueueWidget - a band running a dashboard without either widget had no way to claim
 * control at all. Lives in the main menu instead so it's always reachable regardless of
 * which widgets happen to be on the active dashboard. Also surfaces the active setlist here
 * - the same "which setlist is live right now" question Marco wanted visible in the
 * Bibliothek too (LibraryView.tsx/SetlistDetail.tsx's "● Aktiv" badges).
 */
const SELF_CHECK_LABEL: Record<MasterSelfCheck, string> = {
  ok: '',
  'sync-error': 'nicht synchron',
  offline: 'offline',
  unconfirmed: 'nicht bestätigt',
}

const SELF_CHECK_HINT: Record<MasterSelfCheck, string> = {
  ok: '',
  'sync-error':
    'Sync-Fehler: Dieses Gerät steuert die Show gerade nicht - die anderen sähen es nicht, und vielleicht hat schon ein anderes Gerät übernommen. Unter System → Einstellungen → Synchronisation „Reparieren“.',
  offline: 'Keine Verbindung zum Stage-Server: Dieses Gerät steuert die Show erst wieder, wenn die Verbindung zurück ist.',
  unconfirmed:
    'Der Stage-Server bestätigt dieses Gerät nicht als Master - vermutlich hat ein anderes Gerät übernommen. Dieses Gerät steuert die Show gerade nicht.',
}

export function MasterControl() {
  const { isMaster, activeSetlist } = useQueue()
  const { status, canClaim, isForce, claim } = useMasterTakeover()
  const releaseMaster = useShowStateStore((state) => state.releaseMaster)
  const isPlaying = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const confirm = useDialogStore((state) => state.confirm)

  const release = async () => {
    // Handing over mid-song leaves the show without a driver until someone claims it.
    if (isPlaying && !(await confirm('Der Song läuft gerade. Master trotzdem abgeben?', { title: 'Master abgeben', confirmLabel: 'Abgeben', danger: true }))) return
    await releaseMaster()
  }
  const masterHolderId = useShowStateStore((state) => state.state.masterHolderId)
  // The master token lives in the band's synced ShowState doc. With a permanently failed sync
  // (401/403 - e.g. stale credentials after a band restore) this device only sees its own local
  // copy: it may still read "Dieses Gerät" while another device took over on the server (#378,
  // found on the Fire 2026-10-04). Say so instead of presenting it as valid.
  const holdsToken = useShowStateStore((state) => state.holdsToken)
  const selfCheck = useShowStateStore((state) => state.selfCheck)
  // Holds the token by its own copy but fails the self-check (#378 option B): shown as this
  // device's token, not controllable, with the reason.
  const unconfirmed = holdsToken && !isMaster
  const deviceName = useDeviceName(masterHolderId)
  // 'account' master mode (#85): the holder is a person with all their devices.
  const holderProfileId = profileIdOfMasterHolder(masterHolderId)
  const holderProfileName = useProfilesStore((state) => state.profiles.find((p) => p.id === holderProfileId)?.name)
  const masterName = holderProfileId ? `${holderProfileName ?? 'Jemand'} (alle Geräte)` : deviceName
  const selfLabel = holderProfileId ? 'Du (alle deine Geräte)' : 'Dieses Gerät'

  return (
    <div className="flex flex-col gap-2">
      {unconfirmed && (
        <p role="status" className="text-sm text-amber-500">
          {SELF_CHECK_HINT[selfCheck]}
        </p>
      )}
      {isMaster || unconfirmed ? (
        <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
          Master-Kontrolle
          <span className="flex items-center gap-3">
            <span className={`text-sm ${unconfirmed ? 'text-amber-500' : 'text-accent'}`}>
              {unconfirmed ? `${selfLabel} - ${SELF_CHECK_LABEL[selfCheck]}` : selfLabel}
            </span>
            <button
              type="button"
              onClick={release}
              title="Kontrolle abgeben, damit ein anderes Gerät übernehmen kann"
              className="rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-ink hover:bg-control-strong-hover"
            >
              Master abgeben
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={claim}
          disabled={!canClaim}
          title={
            isForce
              ? canClaim
                ? 'Ein anderes Gerät ist aktiv Master - Force Takeover'
                : 'Ein anderes Gerät ist aktiv Master - nur Admin/Showmaster dürfen übernehmen'
              : 'Dieses Gerät hat aktuell keine Kontrolle über die Queue'
          }
          className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          Master-Kontrolle
          <span className="flex items-center gap-2">
            {masterHolderId && <span className="text-sm text-ink-faint">{masterName ?? 'Anderes Gerät'}</span>}
            {status === 'stale' && <span className="text-sm text-amber-500">antwortet nicht</span>}
            <span className="font-medium text-accent">{isForce ? 'Force Takeover' : 'Übernehmen'}</span>
          </span>
        </button>
      )}
      <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
        Aktive Setlist
        {activeSetlist ? (
          <span className="font-medium text-accent">{activeSetlist.name}</span>
        ) : (
          <span className="text-sm text-ink-faint">Keine</span>
        )}
      </div>
    </div>
  )
}
