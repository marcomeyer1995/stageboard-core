import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollOnceText } from './ScrollOnceText'
import { fitStatusBarItems, STATUS_BAR_ITEMS, type StatusBarItem } from '../lib/statusBarItems'
import { useStatusBarPrefsStore } from '../store/useStatusBarPrefsStore'
import { useEditingTitleStore } from '../store/useEditingTitleStore'
import { isSongEntry } from 'shared-types'
import { queueItemTitle } from '../lib/computeQueue'
import { songDurationMs } from '../lib/entryDuration'
import { adjustedBpm, beatAt, beatsPerBar } from '../lib/metronome'
import type { Mode } from '../lib/modes'
import { useShowModeCore } from '../lib/showMode'
import { useFrameValue } from '../lib/useFrameValue'
import {
  COUNT_IN_FLASH_MS,
  countInPosition,
  type CountInPosition,
  formatSongTime,
  STATUS_BAR_CLASS,
  type StatusBarKind,
  statusBarState,
} from '../lib/statusBar'
import { transitionItemEndMs } from '../lib/trackEndTransition'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useNow } from '../lib/useNow'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { deriveSyncStatus, useSyncStore, type SyncStatus } from '../store/useSyncStore'
import { clickTimeline } from '../lib/beatGrid'
import { Icon, type IconName } from './Icon'
import { stageVariantLabel } from '../lib/variantLabel'
import { getLoopPlaybackState } from '../lib/loopTrainerEngine'
import { stopLoopTrainer } from '../lib/loopTrainer'
import { useLoopTrainerStore } from '../store/useLoopTrainerStore'

/** Gap between the bar's items (gap-3) when the browser can't tell - part of each item's room. */
const GAP_PX = 12

/** How often the fitted set may change while nothing else does (see the layout effect). */
const MAX_REFITS = 4

/** The state as an icon (Marco, 2026-10-07: a word took the song title's room on narrow screens). */
const STATE_ICON: Record<StatusBarKind, IconName> = {
  ready: 'stop',
  'count-in': 'play',
  playing: 'play',
  loop: 'repeat',
  paused: 'pause',
  finished: 'check',
  fault: 'warning',
}

const SYNC_ICON: Record<SyncStatus, IconName> = {
  idle: 'check',
  syncing: 'syncing',
  offline: 'warning',
  error: 'close',
}

/**
 * The fixed bar at the top of every screen (PR F2 of the stage GUI audit, designed with Marco
 * 2026-09-27): one always-present place for "what is happening and is everything okay" - menu,
 * transport state, song and its time on the left; session mode, wall clock, Master token,
 * musician and sync on the right. It replaces the floating "☰ Live" button, which sat on top of
 * widgets and list content on every screen. A dashboard can hide it (`Dashboard.statusBar`); the
 * floating button comes back there.
 *
 * The whole bar takes the state's colour (Marco: "let's try the full bar"). During the count-in
 * the bar stays calm blue and only the count block on the left flashes on each beat - big count
 * number, beat dots, count-in bar "1/2" - from the same synced clock as the Prompter and the
 * Visual Metronome, so every tablet flashes together in the song's tempo. (A first version
 * flashed the whole bar; on the tablet that "looked weird", Marco 2026-09-27.)
 */
function CountBlock({ position, flash }: { position: CountInPosition; flash: boolean }) {
  const { t } = useTranslation('statusbar')
  const { bar, bars, beat, beatsPerBar: beatsInBar } = position
  return (
    <span
      role="status"
      aria-label={t('countIn.aria', { bar, bars, beat })}
      data-flash={flash}
      className={`flex h-12 flex-shrink-0 items-center gap-3 rounded-control px-3 ${flash ? 'bg-state-count-in-ink text-state-count-in' : 'bg-scrim/25 text-state-count-in-ink'}`}
    >
      <span className="w-8 text-center text-4xl font-black leading-none tabular-nums">{beat}</span>
      <span className="flex flex-col gap-1">
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: beatsInBar }, (_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full ${i < beat ? (flash ? 'bg-state-count-in' : 'bg-state-count-in-ink') : flash ? 'bg-state-count-in/25' : 'bg-state-count-in-ink/30'}`}
            />
          ))}
        </span>
        <span className="text-xs font-bold uppercase leading-none tracking-wide">
          {bars > 1 ? t('countIn.bar', { bar, bars }) : t('countIn.single')}
        </span>
      </span>
    </span>
  )
}

/** What the bar shows of the running clock - it re-renders only when one of these changes. */
interface FrameClock {
  time: string
  isCountIn: boolean
  flash: boolean
  position: CountInPosition | null
}

function sameFrameClock(a: FrameClock, b: FrameClock): boolean {
  const p = a.position
  const q = b.position
  const samePosition = p === q || (p !== null && q !== null && p.bar === q.bar && p.bars === q.bars && p.beat === q.beat && p.beatsPerBar === q.beatsPerBar)
  return a.time === b.time && a.isCountIn === b.isCountIn && a.flash === b.flash && samePosition
}

export function StatusBar({
  screen,
  onOpenMenu,
  onOpenDashboards,
  menuOpen = false,
  dashboardsOpen = false,
}: {
  screen: Mode
  onOpenMenu: () => void
  onOpenDashboards?: () => void
  /** Its drawer is open: the symbol shows yellow, a tap closes it (Marco, 2026-10-16). */
  menuOpen?: boolean
  dashboardsOpen?: boolean
}) {
  // Not useShowMode(): that re-rendered the whole bar every frame for a time shown to the second.
  // The clock is read per frame below and re-renders only what it changes (#457).
  const { mode, queue, elapsedNow, playbackStatus, liveTempoAdjustPercent, trackOverride, canControl, trackEnded } = useShowModeCore()
  const { currentEntry, currentSong, currentVariant } = queue
  const noMaster = useShowStateStore((state) => state.state.masterHolderId === null)
  const syncStatus = useSyncStore((state) => deriveSyncStatus(state.streams, state.browserOffline))
  const holdsToken = useShowStateStore((state) => state.holdsToken)
  const audioError = useLocalAudioOutputStore((state) => state.error)
  const profile = useActiveProfile()
  const now = useNow(1000)
  const { t, i18n } = useTranslation(['statusbar', 'common'])

  const durationMs =
    currentEntry && isSongEntry(currentEntry)
      ? (songDurationMs(currentEntry, currentVariant, trackOverride)?.ms ?? null)
      : transitionItemEndMs(currentEntry)

  // "Beendet" comes from the shared state now (#27: set when the track ran out by itself), so
  // every device - also one that just reloaded - shows the same.
  const finished = playbackStatus === 'stopped' && trackEnded

  const song = queue.currentArrangement
  const countInBars = currentVariant?.countInEnabled ? (currentVariant.countInBars ?? 0) : 0
  // Once per song and tempo - not every frame the bar re-renders with the clock (#457).
  const songBpm = song?.bpm
  const songMeter = song?.timeSignature
  const beatGrid = currentVariant?.beatGrid
  const timeline = useMemo(
    () => (songBpm !== undefined && songMeter !== undefined ? clickTimeline({ beatGrid, bpm: adjustedBpm(songBpm, liveTempoAdjustPercent), timeSignature: songMeter, countInBars }) : null),
    [beatGrid, songBpm, songMeter, liveTempoAdjustPercent, countInBars],
  )
  // Where bar 1 starts (song time 0 without a grid - the count-in leads with negative time then).
  const firstBeatMs = timeline?.bar1Ms ?? 0
  const perBar = song ? beatsPerBar(song.timeSignature) : 4
  const clock = useFrameValue(
    (): FrameClock => {
      const elapsedMs = elapsedNow()
      const beat = playbackStatus === 'playing' && elapsedMs !== null && timeline ? beatAt(elapsedMs, timeline) : null
      const countInBeat = beat !== null && beat.isCountIn ? beat : null
      const isCountIn = playbackStatus === 'playing' && (countInBeat !== null || (elapsedMs !== null && elapsedMs < 0))
      return {
        time: formatSongTime(elapsedMs ?? 0),
        isCountIn,
        flash: countInBeat !== null && countInBeat.msIntoBeat < COUNT_IN_FLASH_MS,
        position:
          countInBeat && elapsedMs !== null
            ? countInPosition(elapsedMs, countInBeat.msIntoBeat, countInBeat.effectiveBpm, firstBeatMs, countInBars, countInBeat.beatInBar, perBar)
            : null,
      }
    },
    playbackStatus === 'playing',
    sameFrameClock,
  )
  const isCountIn = clock.isCountIn

  // Read each render - the bar re-renders with the song clock, so pass and tempo stay current.
  const loopActive = useLoopTrainerStore((s) => s.active)
  const loop = loopActive ? getLoopPlaybackState() : null
  const state = statusBarState({
    loop: loop !== null,
    mode,
    playbackStatus,
    isCountIn,
    finished,
    noMaster,
    syncStatus,
    audioError,
    variantIssue: queue.currentVariantIssue,
  })
  const flash = state.kind === 'count-in' && clock.flash
  const position = state.kind === 'count-in' ? clock.position : null
  // An open editor names what it edits instead of the queue's song (#603) - always, also while
  // the queue plays; state, faults and sync stay as they are.
  const editing = useEditingTitleStore((s) => s.editing)
  const title = editing ? editing.title : currentEntry ? queueItemTitle({ entry: currentEntry, song: currentSong }) : null
  const variantLabel = editing
    ? editing.variantLabel || null
    : currentVariant && !currentVariant.isDefault
      ? stageVariantLabel(currentVariant.label)
      : null
  const sync = { icon: SYNC_ICON[syncStatus], label: t(`sync.${syncStatus}`) }
  const stateLabel =
    state.kind === 'loop' && loop ? `${t('state.loop')} · ${loop.pass + 1} · ${Math.round(loop.rate * 100)} %` : t(`state.${state.label}`)

  // Ranked items (lib/statusBarItems.ts, per device in Einstellungen): each one is measured -
  // also while it doesn't fit (then invisible and out of the flow) - and the bar keeps as many
  // as leave the song title its minimum room. Faults and a sync problem are never given up.
  const order = useStatusBarPrefsStore((s) => s.order)
  const hiddenItems = useStatusBarPrefsStore((s) => s.hidden)
  const wanted = order.filter((item) => !hiddenItems.includes(item))
  const headerRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const [shownKey, setShownKey] = useState(wanted.join(','))
  const shown = new Set(shownKey.split(',').filter(Boolean) as StatusBarItem[])
  const fault = state.kind === 'fault'
  // While an editor is open a fault shows only its red icon, never its word - the edited song needs
  // the room on a phone; leaving the editor brings the word back (Marco, 2026-10-20, #603).
  const faultWordHidden = fault && editing !== null
  // 'syncing' is the normal short phase of every write - pinning it made the bar jump on every
  // Play/Weiter (#429 review). Only offline / error is a problem that must stay visible.
  const syncProblem = syncStatus === 'offline' || syncStatus === 'error'
  const isShown = (item: StatusBarItem) =>
    item === 'stateText' && faultWordHidden ? false : (item === 'stateText' && fault) || (item === 'sync' && syncProblem) || shown.has(item)
  const item = (id: StatusBarItem) => ({
    'data-sbitem': id,
    className: isShown(id) ? '' : 'pointer-events-none invisible absolute',
  })
  // Measuring forces a layout - only when something visible changed (texts, the fitted set), not on
  // every animation frame the playing song re-renders this bar with (#429 review). Size changes
  // come through the ResizeObserver below.
  const measuredFor = useRef('')
  const refitsFor = useRef('')
  const refits = useRef(0)
  const [resizes, setResizes] = useState(0)
  useLayoutEffect(() => {
    const header = headerRef.current
    const title = titleRef.current
    if (!header || !title) return
    const unchanged = `${resizes}|${wanted.join(',')}|${fault}|${faultWordHidden}|${syncProblem}|${header.textContent}`
    const signature = `${unchanged}|${shownKey}`
    if (signature === measuredFor.current) return
    measuredFor.current = signature
    // Never flip back and forth: nothing but the fitted set changed four times in a row - keep it.
    // A bar that is a few pixels off is a nuisance; one that loops takes the whole app down.
    refits.current = unchanged === refitsFor.current ? refits.current + 1 : 0
    refitsFor.current = unchanged
    if (refits.current > MAX_REFITS) return
    const widths: Partial<Record<StatusBarItem, number>> = {}
    let used = 0
    // Exact widths and the real gap (gap-3 grows with the text size): with whole pixels and a fixed
    // 12 px, showing "Gig" left 1 px less room than hiding it - it was hidden, shown, hidden … until
    // React gave up and the app stayed black (Redmi, 2026-10-29).
    const gap = parseFloat(getComputedStyle(header).columnGap) || GAP_PX
    for (const el of header.querySelectorAll<HTMLElement>('[data-sbitem]')) {
      const id = el.dataset.sbitem as StatusBarItem
      const width = el.getBoundingClientRect().width + gap
      widths[id] = width
      if (isShown(id)) used += width
    }
    // Always-shown items (a fault's word, a sync problem) take their room off the top - also when
    // hidden in Einstellungen, they are shown anyway (#429 review).
    const pinned = STATUS_BAR_ITEMS.filter((id) => (id === 'stateText' && fault && !faultWordHidden) || (id === 'sync' && syncProblem))
    const room = title.getBoundingClientRect().width + used - pinned.reduce((sum, id) => sum + (widths[id] ?? 0), 0)
    const fitted = wanted.filter((id) => !(pinned as readonly StatusBarItem[]).includes(id) && !(id === 'stateText' && faultWordHidden))
    const next = [...fitStatusBarItems(fitted, widths, room)].join(',')
    if (next !== shownKey) setShownKey(next)
  })
  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    // A narrower or wider bar (rotation, split screen): start from everything again and fit.
    const observer = new ResizeObserver(() => {
      const { order: all, hidden } = useStatusBarPrefsStore.getState()
      setShownKey(all.filter((id) => !hidden.includes(id)).join(','))
      setResizes((n) => n + 1)
    })
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  return (
    <header
      ref={headerRef}
      data-status={state.kind}
      className={`relative flex h-14 flex-shrink-0 items-center gap-3 overflow-hidden px-2 ${STATUS_BAR_CLASS[state.kind]} ${
        state.kind === 'ready' ? 'border-b border-line' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t('openMenu')}
        aria-pressed={menuOpen}
        className={`flex h-touch min-w-touch flex-shrink-0 items-center justify-center gap-2 rounded-control px-3 ${menuOpen ? 'bg-accent text-accent-ink' : '[@media(hover:hover)]:hover:bg-scrim/15'}`}
      >
        <Icon name="menu" size="1.75rem" />
        <span {...item('screen')}>
          <span className="text-base">{t(`common:mode.${screen}`)}</span>
        </span>
      </button>

      {position ? (
        <CountBlock position={position} flash={flash} />
      ) : state.kind === 'loop' ? (
        // Stoppable from every dashboard, also one without the Loop-Trainer widget (Marco, 2026-10-22).
        <button
          type="button"
          onClick={stopLoopTrainer}
          aria-label={`${stateLabel} - ${t('loopStop')}`}
          title={t('loopStop')}
          className="flex h-touch flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-control px-2 text-lg font-black uppercase tracking-wide [@media(hover:hover)]:hover:bg-scrim/15"
        >
          <Icon name="repeat" size="1.5rem" />
          <span {...item('stateText')}>{stateLabel}</span>
        </button>
      ) : (
        // The state as an icon - always there; its word is a ranked item (a fault keeps it:
        // the icon alone wouldn't say what is wrong).
        <span className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap text-lg font-black uppercase tracking-wide" aria-label={stateLabel} title={stateLabel}>
          <Icon name={STATE_ICON[state.kind]} size="1.5rem" filled={['ready', 'playing', 'count-in', 'paused'].includes(state.kind)} />
          <span {...item('stateText')}>{stateLabel}</span>
        </span>
      )}

      <span ref={titleRef} className="min-w-0 flex-1">
        <ScrollOnceText cycleKey={`${title ?? ''}|${variantLabel ?? ''}`} className="min-w-0 text-lg font-semibold">
          {editing && <Icon name="edit" size="1.1em" className="mr-2" label={t('editing')} />}
          {title}
          {variantLabel && <span className="ml-2 font-normal opacity-80">({variantLabel})</span>}
        </ScrollOnceText>
      </span>

      {title && !editing && (
        <span className="flex-shrink-0 whitespace-nowrap text-lg font-bold tabular-nums">
          {clock.time}
          {durationMs !== null && (
            <span {...item('duration')}>
              <span className="font-normal opacity-80"> / {formatSongTime(durationMs)}</span>
            </span>
          )}
        </span>
      )}

      <span className="flex flex-shrink-0 items-center gap-3 whitespace-nowrap text-base">
        <span {...item('mode')}>
          <span className="rounded-control bg-scrim/20 px-2 font-bold uppercase tracking-wide">{t(mode === 'gig' ? 'common:session.gig' : 'common:session.practice')}</span>
        </span>
        {mode === 'gig' && (canControl || holdsToken) && (
          <span {...item('master')}>
            <span
              title={canControl ? t('master.holds') : t('master.unconfirmed')}
              aria-label={canControl ? t('master.holdsLabel') : t('master.unconfirmedLabel')}
              className={`flex items-center ${canControl ? '' : 'opacity-60'}`}
            >
              <Icon name="master" size="1.4rem" />
            </span>
          </span>
        )}
        <span {...item('clock')}>
          <span className="font-bold tabular-nums">{new Date(now).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span>
        </span>
        {profile && (
          <span {...item('profile')}>
            <span className="inline-block max-w-32 truncate align-middle">{profile.name}</span>
          </span>
        )}
        <span {...item('sync')}>
          <span title={sync.label} aria-label={sync.label} className="flex items-center font-bold">
            <Icon name={sync.icon} size="1.3rem" />
          </span>
        </span>
        <span {...item('syncText')}>
          <span className="font-normal">{sync.label}</span>
        </span>
      </span>

      {/* Top right on dashboards: the bento menu - pick and manage dashboards (docs/15 D8). Part of
          the fixed core like ☰, never given up for room. */}
      {screen === 'boards' && onOpenDashboards && (
        <button
          type="button"
          onClick={onOpenDashboards}
          aria-label={t('openDashboards')}
          aria-pressed={dashboardsOpen}
          className={`flex h-touch min-w-touch flex-shrink-0 items-center justify-center rounded-control px-2 ${dashboardsOpen ? 'bg-accent text-accent-ink' : '[@media(hover:hover)]:hover:bg-scrim/15'}`}
        >
          <Icon name="dashboards" size="1.75rem" />
        </button>
      )}
    </header>
  )
}
