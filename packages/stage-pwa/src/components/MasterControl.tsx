import { useEffect, useRef, useState } from 'react'
import { useQueue } from '../lib/queue'
import { CONTROL, FOCUS, HOVER } from './ui/styles'
import { Icon } from './Icon'
import { useDeviceName } from '../store/useDevicesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useMasterTakeover } from '../lib/useMasterTakeover'
import { useShowStateStore } from '../store/useShowStateStore'
import { profileIdOfMasterHolder } from '../lib/masterTakeover'
import { useProfilesStore } from '../store/useProfilesStore'
import { useTranslation } from 'react-i18next'

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

export function MasterControl() {
  const { isMaster } = useQueue()
  const { status, canClaim, isForce, claim } = useMasterTakeover()
  const releaseMaster = useShowStateStore((state) => state.releaseMaster)
  const isPlaying = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const confirm = useDialogStore((state) => state.confirm)
  const { t } = useTranslation('menu')

  const release = async () => {
    // Handing over mid-song leaves the show without a driver until someone claims it.
    if (isPlaying && !(await confirm(t('master.releaseConfirm'), { title: t('master.release'), confirmLabel: t('master.releaseButton'), danger: true }))) return
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
  const masterName = holderProfileId ? t('master.allDevicesOf', { name: holderProfileName ?? t('master.someone') }) : deviceName

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
    ? selfCheck === 'ok'
      ? ''
      : t(`master.selfCheck.${selfCheck}`)
    : isMaster
      ? holderProfileId
        ? t('master.youAll')
        : t('master.youThis')
      : masterHolderId
        ? `${t(status === 'stale' ? 'master.otherStale' : 'master.other', { name: masterName ?? t('master.anotherDevice') })}${
            blocked ? ` ${t('master.onlyAdmins')}` : isForce ? ` ${t('master.holdForces')}` : ''
          }`
        : t('master.nobody')
  // Who holds it, short, inside the button after a dash (Marco, 2026-10-16: the line below cost
  // the room that kept ☰ on one landscape screen). The line stays only for what needs attention.
  const holderShort = isMaster
    ? holderProfileId
      ? t('master.shortAll')
      : t('master.shortThis')
    : masterHolderId
      ? status === 'stale'
        ? t('master.shortStale', { name: masterName ?? t('master.shortOther') })
        : (masterName ?? t('master.shortOther'))
      : t('master.shortNobody')
  const showStatusLine = unconfirmed || status === 'stale' || (!isMaster && !!masterHolderId && isForce)
  // Full while it's yours, empty otherwise; holding animates towards the other state.
  const shown = pending ?? mine
  const fill = holding ? (shown ? '0%' : '100%') : shown ? '100%' : '0%'
  const darkText = holding ? !shown : shown

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-pressed={shown}
        aria-label={t('master.label')}
        disabled={blocked}
        title={`${statusLine} ${mine ? t('master.holdToRelease') : t('master.holdToTake')}.`}
        onPointerDown={startHold}
        onPointerUp={() => endHold(true)}
        onPointerLeave={() => endHold(false)}
        onPointerCancel={() => endHold(false)}
        onContextMenu={(e) => e.preventDefault()}
        // Icon first, then the word - like the view rows above it in ☰ (Marco, 2026-10-16).
        className={`relative flex h-stage w-full items-center gap-3 overflow-hidden bg-control px-4 text-left text-lg ${CONTROL} ${FOCUS} ${HOVER} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span
          aria-hidden
          data-testid="master-progress"
          className="absolute inset-y-0 left-0 bg-accent"
          style={{ width: fill, transition: holding ? `width ${HOLD_MS}ms linear` : 'none' }}
        />
        <Icon name="master" size="1.4rem" className={`relative ${darkText ? 'text-accent-ink' : 'text-ink'}`} />
        <span className={`relative min-w-0 truncate ${darkText ? 'text-accent-ink' : 'text-ink'}`}>
          <span className={darkText ? 'font-semibold' : ''}>{t('master.label')}</span>
          <span className={darkText ? 'text-accent-ink/70' : 'text-ink-faint'}> – {holderShort}</span>
        </span>
      </button>
      {hint ? (
        <p role="status" className="text-sm text-accent">
          {mine ? t('master.holdToRelease') : t('master.holdToTake')}
        </p>
      ) : (
        showStatusLine && (
          <p role={unconfirmed ? 'status' : undefined} className={`text-sm ${unconfirmed || status === 'stale' ? 'text-warn' : 'text-ink-faint'}`}>
            {statusLine}
          </p>
        )
      )}
    </div>
  )
}
