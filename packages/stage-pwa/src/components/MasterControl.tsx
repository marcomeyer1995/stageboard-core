import { useEffect, useRef, useState } from 'react'
import { useQueue } from '../lib/queue'
import { CONTROL, FOCUS, HOVER } from './ui/styles'
import { Icon } from './Icon'
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
/** How long the Master row is held to change it - as long as "Bearbeiten". */
const HOLD_MS = 600
/** How long the "hold it" hint stays after a too-short tap, ms. */
const HINT_MS = 2500
/** How long a completed hold's new state is shown before falling back if the token didn't change. */
const PENDING_MS = 4000

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

  // One "Master" row that is held to change it, both ways (Marco's #409 review): yellow = this
  // device / person controls the show. Holding fills it (take over) or drains it (hand over), like
  // "Bearbeiten" below it - a stray tap on stage changes nothing, it only says "hold it".
  const mine = isMaster || unconfirmed
  const blocked = !mine && !canClaim
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const [hint, setHint] = useState(false)
  // The state a completed hold asked for, shown until the token actually changes - without it the
  // row fell back to the old state for a moment and then jumped (Marco, #409). Given up after a
  // few seconds if the change doesn't happen (refused, or "Abgeben" cancelled mid-song).
  const [pending, setPending] = useState<boolean | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pending !== null && pending === mine) setPending(null)
  }, [pending, mine])
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
    },
    [],
  )
  function startHold() {
    if (blocked || pending !== null) return
    setHolding(true)
    setHint(false)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      setHolding(false)
      setPending(!mine)
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => setPending(null), PENDING_MS)
      void (mine ? release() : claim())
    }, HOLD_MS)
  }
  function endHold(tooShort: boolean) {
    if (holdTimer.current && tooShort) {
      setHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setHint(false), HINT_MS)
    }
    setHolding(false)
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
  }

  const statusLine = unconfirmed
    ? SELF_CHECK_HINT[selfCheck]
    : isMaster
      ? holderProfileId
        ? 'Du bist Master – alle deine Geräte.'
        : 'Du bist Master – nur dieses Gerät.'
      : masterHolderId
        ? `${masterName ?? 'Ein anderes Gerät'} ist Master${status === 'stale' ? ' – antwortet aber nicht' : ''}.${
            blocked ? ' Übernehmen dürfen nur Admin/Showmaster.' : isForce ? ' Halten erzwingt die Übernahme.' : ''
          }`
        : 'Niemand ist Master.'
  // Full while it's yours, empty otherwise; holding animates towards the other state.
  const shown = pending ?? mine
  const fill = holding ? (shown ? '0%' : '100%') : shown ? '100%' : '0%'
  const darkText = holding ? !shown : shown

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-pressed={shown}
        aria-label="Master"
        disabled={blocked}
        title={mine ? 'Zum Abgeben gedrückt halten' : 'Zum Übernehmen gedrückt halten'}
        onPointerDown={startHold}
        onPointerUp={() => endHold(true)}
        onPointerLeave={() => endHold(false)}
        onPointerCancel={() => endHold(false)}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative flex h-stage w-full items-center justify-between overflow-hidden bg-control px-4 text-lg ${CONTROL} ${FOCUS} ${HOVER} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span
          aria-hidden
          data-testid="master-progress"
          className="absolute inset-y-0 left-0 bg-accent"
          style={{ width: fill, transition: holding ? `width ${HOLD_MS}ms linear` : 'none' }}
        />
        <span className={`relative font-semibold ${darkText ? 'text-accent-ink' : 'text-ink-soft'}`}>Master</span>
        <Icon name="master" size="1.4rem" className={`relative ${darkText ? 'text-accent-ink' : 'text-ink-soft'}`} />
      </button>
      {hint ? (
        <p role="status" className="text-sm text-accent">
          {mine ? 'Zum Abgeben gedrückt halten' : 'Zum Übernehmen gedrückt halten'}
        </p>
      ) : (
        <p role={unconfirmed ? 'status' : undefined} className={`text-sm ${unconfirmed || status === 'stale' ? 'text-amber-500' : 'text-ink-faint'}`}>
          {statusLine}
        </p>
      )}
      <div className={`flex min-h-stage items-center justify-between gap-3 bg-control px-4 text-lg text-ink-soft ${CONTROL}`}>
        Aktive Setlist
        {activeSetlist ? (
          <span className="font-medium text-accent">{activeSetlist.name}</span>
        ) : (
          <span className="text-base text-ink-faint">Keine</span>
        )}
      </div>
    </div>
  )
}
