import { useState } from 'react'
import { CAPABILITIES, isTransitionEntry, type ShowControlEvent } from 'shared-types'
import { resolveTrackForEntry } from '../lib/computeQueue'
import { triggerShowControl } from '../lib/showControlClient'
import { useCapabilityRouting } from '../lib/useCapabilityRouting'
import { useShowMode } from '../lib/showMode'
import { useLocalAudioOutputStore } from '../store/useLocalAudioOutputStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import {
  DEFAULT_BUTTONS_SIZE_RATIO,
  DEFAULT_TITLE_SIZE_RATIO,
  type ShowTransportConfig,
} from './showTransportConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { MasterTakeoverButton } from '../components/MasterTakeoverButton'

/** A negative `ms` (#25 follow-up: counting in before the backing track's own audio starts,
 * elapsedMs 0) is a real, intended state - shown as a visible negative countdown up through
 * "00:00", not hidden or clamped away. `Math.floor`/`%` both propagate a negative dividend's
 * sign on their own (`-1500 -> -2` seconds, not `-1`), so the sign is pulled out and applied
 * once to the absolute value instead of trusting that arithmetic directly. */
function formatClock(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const totalSeconds = Math.floor(Math.abs(ms) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * The one Play/Pause/Stop/Reset control for the current song (#13, closing docs/07's
 * long-deferred "explizite Pause/Stop-Kontrolle" idea) - works the same in Gig mode (with or
 * without an `audio-playback` plugin installed, or an `audio-playback` binding in the active
 * HardwareSetup - see HardwareSetupPicker.tsx / #10) and Practice mode (see useShowMode.ts).
 *
 * Gig mode's default routes through whichever plugin `pluginProviding` resolves, same as the
 * previous ShowPlaybackWidget - degrades to a disconnected state if none is reachable, and
 * deliberately never falls back to this device's own speaker on its own (a tablet
 * unexpectedly outputting audio mid-show would be worse than silence) - that only happens if
 * the active HardwareSetup explicitly binds `audio-playback` to a tablet. Practice mode always
 * plays locally (localAudioEngine.ts), since it's inherently just this device's own headphones.
 *
 * This widget owns only the Play/Pause/Stop/Reset UI and its click handlers - actually driving
 * the audio engine (reactively mirroring `playbackStatus`, loading/unloading tracks, forwarding
 * "load" events to a plugin) lives in useAudioOutputDriver.ts instead, mounted once in App.tsx
 * regardless of which top-level tab is showing. It used to live here, which meant switching away
 * from the Live tab (Bibliothek/System) unmounted this widget and silently stopped a live show's
 * backing track mid-song (found live, 2026-09-10). The routing booleans below
 * (`engine`/`usesDeviceOutput`/`pluginId`) are safe to re-derive here too, purely for display -
 * they're plain derivations, not the side-effecting part.
 *
 * Two functional elements, each a ratio of the device-wide default rather than auto-fit to
 * the tile (Marco, 2026-09-14): the title+clock row, and the four transport buttons (which
 * all share one size).
 */
export function ShowTransportWidget({ config }: { config: ShowTransportConfig }) {
  const { mode, queue, elapsedMs, playbackStatus, trackOverride, canControl, clickExtendMs, play, pause, stop, reset } =
    useShowMode()
  const { currentSong, currentVariant } = queue
  const driverError = useLocalAudioOutputStore((state) => state.error)

  // resolveExecutionEngine's Practice branch plays locally regardless of any Gig-mode binding -
  // supportsLocalExecution is unconditionally true for audio-playback (native <audio>, no
  // plugin needed - #98), so Practice mode always resolves to 'local-mine' here.
  const { engine, pluginId } = useCapabilityRouting(CAPABILITIES.audioPlayback, mode)
  const remoteDeviceOutput = engine === 'local-other'
  const usesLocalEngine = engine === 'local-mine'
  const usesDeviceOutput = usesLocalEngine || remoteDeviceOutput

  const [error, setError] = useState<string | null>(null)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const titleFontSize = baseFontSize * (config.titleSizeRatio ?? DEFAULT_TITLE_SIZE_RATIO)
  const buttonFontSize = baseFontSize * (config.buttonsSizeRatio ?? DEFAULT_BUTTONS_SIZE_RATIO)

  async function forward(event: ShowControlEvent) {
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, event)
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  // No track attached at all (e.g. an a cappella song) is a normal, expected state, not an
  // error - shown separately from `error` below, same distinction BackingTrackPlayerWidget
  // used to draw with "Kein Track angehängt". Only relevant on whichever device is actually
  // responsible for playing something locally.
  const track = resolveTrackForEntry(queue.currentEntry, currentVariant, trackOverride)
  const noLocalTrack = usesLocalEngine && (!currentVariant || !track)

  // A transition item (#29) plays as a silent countdown with the same Play/Pause/Stop controls.
  const transitionItem = queue.currentEntry && isTransitionEntry(queue.currentEntry) ? queue.currentEntry : null
  if (!currentSong && !transitionItem) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Kein Song aktiv</div>
  }

  if (!canControl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-soft">
        <span className="text-center text-sm">Dieses Gerät hat aktuell keine Kontrolle über die Show</span>
        <MasterTakeoverButton
          className="rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-accent hover:bg-control-strong-hover"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 text-ink-soft">
      <div className="flex w-full flex-1 items-center overflow-hidden">
        <span style={{ fontSize: titleFontSize }} className="whitespace-nowrap">
          <span className="font-semibold text-ink">{transitionItem?.title ?? currentSong?.title}</span>
          {currentVariant && !currentVariant.isDefault && (
            <span className="ml-1 text-[0.6em] text-accent">({currentVariant.label})</span>
          )}
          <span className="ml-2 font-sb-mono text-ink">{formatClock(elapsedMs ?? 0)}</span>
          {transitionItem?.estimatedDurationMs ? (
            <span className="ml-1 font-sb-mono text-ink-faint">/ {formatClock(transitionItem.estimatedDurationMs)}</span>
          ) : null}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => {
            void play()
            if (!usesDeviceOutput && !transitionItem) void forward({ type: 'play' })
          }}
          className={`rounded-sb py-2 font-bold uppercase tracking-wide transition-colors ${
            playbackStatus === 'playing'
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          <span style={{ fontSize: buttonFontSize }}>Play</span>
        </button>
        <button
          type="button"
          onClick={() => {
            void pause()
            if (!usesDeviceOutput && !transitionItem) void forward({ type: 'pause' })
          }}
          className={`rounded-sb py-2 font-bold uppercase tracking-wide transition-colors ${
            playbackStatus === 'paused'
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          <span style={{ fontSize: buttonFontSize }}>Pause</span>
        </button>
        <button
          type="button"
          onClick={() => {
            void stop()
            if (!usesDeviceOutput && !transitionItem) void forward({ type: 'stop' })
          }}
          className="rounded-sb bg-control-strong py-2 font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          <span style={{ fontSize: buttonFontSize }}>Stop</span>
        </button>
        <button
          type="button"
          onClick={() => void reset()}
          className="rounded-sb bg-control-strong py-2 font-bold uppercase tracking-wide text-ink hover:bg-control-strong-hover"
        >
          <span style={{ fontSize: buttonFontSize }}>Reset</span>
        </button>
      </div>
      {remoteDeviceOutput && <p className="text-xs text-ink-faint">Audio läuft über ein anderes Gerät</p>}
      {noLocalTrack && !transitionItem && <p className="text-xs text-ink-faint">Kein Track angehängt</p>}
      {/* #231: the song is running past its originally authored end, via the live bar-extend
          trigger - shown whenever any extension is active, playing or not (a pause mid-extension
          shouldn't make the indicator flicker off). */}
      {clickExtendMs > 0 && <p className="text-xs text-accent">Verlängert - läuft über die reguläre Länge hinaus</p>}
      {(error ?? driverError) && <p className="text-xs text-red-500">{error ?? driverError}</p>}
    </div>
  )
}

export function ShowTransportConfigPanel({
  config,
  onChange,
}: {
  config: ShowTransportConfig
  onChange: (next: ShowTransportConfig) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <SizeRatioSlider
        label="Titel & Uhr"
        ratio={config.titleSizeRatio ?? DEFAULT_TITLE_SIZE_RATIO}
        onChange={(titleSizeRatio) => onChange({ ...config, titleSizeRatio })}
      />
      <SizeRatioSlider
        label="Buttons"
        ratio={config.buttonsSizeRatio ?? DEFAULT_BUTTONS_SIZE_RATIO}
        onChange={(buttonsSizeRatio) => onChange({ ...config, buttonsSizeRatio })}
      />
    </div>
  )
}
