import { useEffect, useRef, useState } from 'react'
import { isSongEntry } from 'shared-types'
import { queueItemTitle } from '../lib/computeQueue'
import { songDurationMs } from '../lib/entryDuration'
import { adjustedBpm, beatAt } from '../lib/metronome'
import { MODE_LABEL, type Mode } from '../lib/modes'
import { useShowMode } from '../lib/showMode'
import {
  COUNT_IN_FLASH_CLASS,
  COUNT_IN_FLASH_MS,
  finishedAfterRun,
  formatSongTime,
  STATUS_BAR_CLASS,
  statusBarState,
} from '../lib/statusBar'
import { transitionItemEndMs } from '../lib/trackEndTransition'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useNow } from '../lib/useNow'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { deriveSyncStatus, useSyncStore, type SyncStatus } from '../store/useSyncStore'

const SYNC_TEXT: Record<SyncStatus, { icon: string; label: string }> = {
  idle: { icon: '✓', label: 'Synchron' },
  syncing: { icon: '⟳', label: 'Synchronisiere…' },
  offline: { icon: '⚠', label: 'Offline' },
  error: { icon: '✕', label: 'Sync-Fehler' },
}

/**
 * The fixed bar at the top of every screen (PR F2 of the stage GUI audit, designed with Marco
 * 2026-09-27): one always-present place for "what is happening and is everything okay" - menu,
 * transport state, song and its time on the left; session mode, wall clock, Master token,
 * musician and sync on the right. It replaces the floating "☰ Live" button, which sat on top of
 * widgets and list content on every screen. A dashboard can hide it (`Dashboard.statusBar`); the
 * floating button comes back there.
 *
 * The whole bar takes the state's colour (Marco: "let's try the full bar") and during the
 * count-in flashes on each count-in beat, from the same synced clock as the Prompter and the
 * Visual Metronome, so every tablet flashes together in the song's tempo.
 */
export function StatusBar({ screen, onOpenMenu }: { screen: Mode; onOpenMenu: () => void }) {
  const { mode, queue, elapsedMs, playbackStatus, liveTempoAdjustPercent, trackOverride, canControl } = useShowMode()
  const { currentEntry, currentSong, currentVariant } = queue
  const noMaster = useShowStateStore((state) => state.state.masterHolderId === null)
  const syncStatus = useSyncStore((state) => deriveSyncStatus(state.streams, state.browserOffline))
  const audioError = useLocalAudioOutputStore((state) => state.error)
  const profile = useActiveProfile()
  const now = useNow(1000)

  const durationMs =
    currentEntry && isSongEntry(currentEntry)
      ? (songDurationMs(currentEntry, currentVariant, trackOverride)?.ms ?? null)
      : transitionItemEndMs(currentEntry)

  // "Beendet" is not in the show state (Stop rearms the entry), so the bar notices it itself: a
  // run that went from playing to stopped within a few seconds of the song's end.
  const lastRun = useRef<{ elapsedMs: number | null; durationMs: number | null }>({ elapsedMs: null, durationMs: null })
  const previousStatus = useRef(playbackStatus)
  const [finished, setFinished] = useState(false)
  useEffect(() => {
    if (playbackStatus === 'playing') lastRun.current = { elapsedMs, durationMs }
  }, [playbackStatus, elapsedMs, durationMs])
  useEffect(() => {
    const before = previousStatus.current
    previousStatus.current = playbackStatus
    if (playbackStatus === 'playing') setFinished(false)
    else if (playbackStatus === 'stopped' && before !== 'stopped') {
      setFinished(finishedAfterRun(lastRun.current.elapsedMs, lastRun.current.durationMs))
    }
  }, [playbackStatus])

  const song = currentVariant ?? currentSong
  const countInBars = currentVariant?.countInEnabled ? (currentVariant.countInBars ?? 0) : 0
  const beat =
    playbackStatus === 'playing' && elapsedMs !== null && song
      ? beatAt(
          elapsedMs,
          adjustedBpm(song.bpm, liveTempoAdjustPercent),
          song.timeSignature,
          currentVariant?.beatAnchors ?? [],
          countInBars,
          currentVariant?.tempoMarkers ?? [],
        )
      : null
  // A count-in beat: before the first beat anchor (beatAt's own flag), or - for a song without
  // anchors - on the negative part of the song clock the count-in bars lead with.
  const countInBeat = beat !== null && (beat.isCountIn || (elapsedMs ?? 0) < 0) ? beat : null
  const isCountIn = playbackStatus === 'playing' && (countInBeat !== null || (elapsedMs !== null && elapsedMs < 0))

  const state = statusBarState({
    mode,
    playbackStatus,
    isCountIn,
    finished,
    noMaster,
    syncStatus,
    audioError,
  })
  const flash = state.kind === 'count-in' && countInBeat !== null && countInBeat.msIntoBeat < COUNT_IN_FLASH_MS
  const title = currentEntry ? queueItemTitle({ entry: currentEntry, song: currentSong }) : null
  const variantLabel = currentVariant && !currentVariant.isDefault ? currentVariant.label : null
  const sync = SYNC_TEXT[syncStatus]

  return (
    <header
      data-status={state.kind}
      className={`flex h-14 flex-shrink-0 items-center gap-3 px-2 ${flash ? COUNT_IN_FLASH_CLASS : STATUS_BAR_CLASS[state.kind]} ${
        state.kind === 'ready' ? 'border-b border-line' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Menü öffnen"
        className="flex h-touch min-w-touch flex-shrink-0 items-center justify-center gap-2 rounded-sb px-3 hover:bg-black/15"
      >
        <span className="text-2xl leading-none">☰</span>
        <span className="hidden text-base md:inline">{MODE_LABEL[screen]}</span>
      </button>

      <span className="flex-shrink-0 whitespace-nowrap text-lg font-black uppercase tracking-wide">
        {state.label}
        {state.kind === 'count-in' && countInBeat ? ` ${countInBeat.beatInBar + 1}` : ''}
      </span>

      <span className="min-w-0 flex-1 truncate text-lg font-semibold">
        {title}
        {variantLabel && <span className="ml-2 font-normal opacity-80">({variantLabel})</span>}
      </span>

      {title && (
        <span className="flex-shrink-0 whitespace-nowrap text-lg font-bold tabular-nums">
          {formatSongTime(elapsedMs ?? 0)}
          {durationMs !== null && <span className="font-normal opacity-80"> / {formatSongTime(durationMs)}</span>}
        </span>
      )}

      <span className="flex flex-shrink-0 items-center gap-3 whitespace-nowrap text-base">
        <span className="rounded-sb-sm bg-black/20 px-2 font-bold uppercase tracking-wide">{mode === 'gig' ? 'Gig' : 'Solo'}</span>
        {mode === 'gig' && canControl && (
          <span title="Dieses Gerät hat das Master-Token" aria-label="Master">
            👑
          </span>
        )}
        <span className="hidden font-bold tabular-nums sm:inline">
          {new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {profile && <span className="hidden max-w-32 truncate md:inline">{profile.name}</span>}
        <span title={sync.label} aria-label={sync.label} className="font-bold">
          {sync.icon}
          <span className="ml-1 hidden font-normal lg:inline">{sync.label}</span>
        </span>
      </span>
    </header>
  )
}
