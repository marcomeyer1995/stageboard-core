import { ScrollOnceText } from './ScrollOnceText'
import { isSongEntry } from 'shared-types'
import { queueItemTitle } from '../lib/computeQueue'
import { songDurationMs } from '../lib/entryDuration'
import { adjustedBpm, beatAt, beatsPerBar } from '../lib/metronome'
import { MODE_LABEL, type Mode } from '../lib/modes'
import { useShowMode } from '../lib/showMode'
import {
  COUNT_IN_FLASH_MS,
  countInPosition,
  type CountInPosition,
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
import { clickTimeline } from '../lib/beatGrid'
import { Icon, type IconName } from './Icon'
import { stageVariantLabel } from '../lib/variantLabel'

const SYNC_TEXT: Record<SyncStatus, { icon: IconName; label: string }> = {
  idle: { icon: 'check', label: 'Synchron' },
  syncing: { icon: 'syncing', label: 'Synchronisiere…' },
  offline: { icon: 'warning', label: 'Offline' },
  error: { icon: 'close', label: 'Sync-Fehler' },
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
  const { bar, bars, beat, beatsPerBar: beatsInBar } = position
  return (
    <span
      role="status"
      aria-label={`Einzählen, Takt ${bar} von ${bars}, Schlag ${beat}`}
      data-flash={flash}
      className={`flex h-12 flex-shrink-0 items-center gap-3 rounded-control px-3 ${flash ? 'bg-white text-blue-800' : 'bg-black/25 text-white'}`}
    >
      <span className="w-8 text-center text-4xl font-black leading-none tabular-nums">{beat}</span>
      <span className="flex flex-col gap-1">
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: beatsInBar }, (_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full ${i < beat ? (flash ? 'bg-blue-800' : 'bg-white') : flash ? 'bg-blue-800/25' : 'bg-white/30'}`}
            />
          ))}
        </span>
        <span className="text-xs font-bold uppercase leading-none tracking-wide">
          {bars > 1 ? `Takt ${bar}/${bars}` : 'Einzählen'}
        </span>
      </span>
    </span>
  )
}

export function StatusBar({ screen, onOpenMenu }: { screen: Mode; onOpenMenu: () => void }) {
  const { mode, queue, elapsedMs, playbackStatus, liveTempoAdjustPercent, trackOverride, canControl, trackEnded } = useShowMode()
  const { currentEntry, currentSong, currentVariant } = queue
  const noMaster = useShowStateStore((state) => state.state.masterHolderId === null)
  const syncStatus = useSyncStore((state) => deriveSyncStatus(state.streams, state.browserOffline))
  const holdsToken = useShowStateStore((state) => state.holdsToken)
  const audioError = useLocalAudioOutputStore((state) => state.error)
  const profile = useActiveProfile()
  const now = useNow(1000)

  const durationMs =
    currentEntry && isSongEntry(currentEntry)
      ? (songDurationMs(currentEntry, currentVariant, trackOverride)?.ms ?? null)
      : transitionItemEndMs(currentEntry)

  // "Beendet" comes from the shared state now (#27: set when the track ran out by itself), so
  // every device - also one that just reloaded - shows the same.
  const finished = playbackStatus === 'stopped' && trackEnded

  const song = currentVariant ?? currentSong
  const countInBars = currentVariant?.countInEnabled ? (currentVariant.countInBars ?? 0) : 0
  const timeline = song
    ? clickTimeline({ beatGrid: currentVariant?.beatGrid, bpm: adjustedBpm(song.bpm, liveTempoAdjustPercent), timeSignature: song.timeSignature, countInBars })
    : null
  const beat = playbackStatus === 'playing' && elapsedMs !== null && timeline ? beatAt(elapsedMs, timeline) : null
  const countInBeat = beat !== null && beat.isCountIn ? beat : null
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
  // Where bar 1 starts (song time 0 without a grid - the count-in leads with negative time then).
  const firstBeatMs = timeline?.bar1Ms ?? 0
  const perBar = song ? beatsPerBar(song.timeSignature) : 4
  const position =
    state.kind === 'count-in' && countInBeat && elapsedMs !== null
      ? countInPosition(elapsedMs, countInBeat.msIntoBeat, countInBeat.effectiveBpm, firstBeatMs, countInBars, countInBeat.beatInBar, perBar)
      : null
  const title = currentEntry ? queueItemTitle({ entry: currentEntry, song: currentSong }) : null
  const variantLabel = currentVariant && !currentVariant.isDefault ? stageVariantLabel(currentVariant.label) : null
  const sync = SYNC_TEXT[syncStatus]

  return (
    <header
      data-status={state.kind}
      className={`flex h-14 flex-shrink-0 items-center gap-3 px-2 ${STATUS_BAR_CLASS[state.kind]} ${
        state.kind === 'ready' ? 'border-b border-line' : ''
      }`}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Menü öffnen"
        className="flex h-touch min-w-touch flex-shrink-0 items-center justify-center gap-2 rounded-control px-3 [@media(hover:hover)]:hover:bg-black/15"
      >
        <Icon name="menu" size="1.75rem" />
        <span className="hidden text-base md:inline">{MODE_LABEL[screen]}</span>
      </button>

      {position ? (
        <CountBlock position={position} flash={flash} />
      ) : (
        // On a phone the song title needs the room (#373: it was cut to "Wie …"); "Bereit" is the
        // resting state and the only one the bar can drop there - every other state stays visible.
        <span
          className={`flex-shrink-0 whitespace-nowrap text-lg font-black uppercase tracking-wide ${
            state.kind === 'ready' ? 'hidden sm:inline' : ''
          }`}
        >
          {state.label}
        </span>
      )}

      <ScrollOnceText cycleKey={`${title ?? ''}|${variantLabel ?? ''}`} className="min-w-0 flex-1 text-lg font-semibold">
        {title}
        {variantLabel && <span className="ml-2 font-normal opacity-80">({variantLabel})</span>}
      </ScrollOnceText>

      {title && (
        <span className="flex-shrink-0 whitespace-nowrap text-lg font-bold tabular-nums">
          {formatSongTime(elapsedMs ?? 0)}
          {durationMs !== null && <span className="hidden font-normal opacity-80 sm:inline"> / {formatSongTime(durationMs)}</span>}
        </span>
      )}

      <span className="flex flex-shrink-0 items-center gap-3 whitespace-nowrap text-base">
        <span className="rounded-control bg-black/20 px-2 font-bold uppercase tracking-wide">{mode === 'gig' ? 'Gig' : 'Solo'}</span>
        {mode === 'gig' && (canControl || holdsToken) && (
          <span
            title={canControl ? 'Dieses Gerät hat das Master-Token' : 'Master laut eigener Kopie, aber nicht bestätigt - steuert die Show gerade nicht'}
            aria-label={canControl ? 'Master' : 'Master, nicht bestätigt'}
            className={`flex items-center ${canControl ? '' : 'opacity-60'}`}
          >
            <Icon name="master" size="1.4rem" />
          </span>
        )}
        <span className="hidden font-bold tabular-nums sm:inline">
          {new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {profile && <span className="hidden max-w-32 truncate md:inline">{profile.name}</span>}
        <span title={sync.label} aria-label={sync.label} className="flex items-center font-bold">
          <Icon name={sync.icon} size="1.3rem" />
          <span className="ml-1 hidden font-normal lg:inline">{sync.label}</span>
        </span>
      </span>
    </header>
  )
}
