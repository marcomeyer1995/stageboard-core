import { useEffect, useRef, useState } from 'react'
import type { ShowCue } from 'shared-types'
import { analyzeOnsetsBlob, type TrackOnsets } from '../lib/analyzeTrack'
import { parseChordPro } from '../lib/chordpro'
import { createCueRecording, type CueRecording } from '../lib/cueRecording'
import { getDeviceId } from '../lib/deviceId'
import { loopSections } from '../lib/loopSections'
import { canDecodeCapability, createMidiDecoder } from '../lib/midiCueDecoders'
import { MAX_SNAP_WINDOW_MS, snapCues, snapToOnset } from '../lib/onsetSnap'
import { formatTrackClockTime, useTrackClock } from '../lib/useTrackClock'
import { listenToMidiInputById, listMidiInputs, type MidiInputInfo } from '../lib/webMidi'
import { useClockStore } from '../store/useClockStore'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'

interface CueRecorderProps {
  /** Object URL of the variant's track (band-mix, else reference). Cues are stamped with the
   * track's own playback position, so without one there is nothing to record against. */
  trackSrc: string | null
  /** The variant's ChordPro text - its timestamped parts are shown against the detected onsets. */
  chordProContent?: string
  onComplete: (cues: ShowCue[]) => void
  onCancel: () => void
}

interface LiveRow {
  key: number
  timeMs: number
  label: string
}

function describe(type: string, payload: Record<string, unknown> | undefined): string {
  const details = payload ? Object.entries(payload).map(([key, value]) => `${key} ${String(value)}`).join(', ') : ''
  return details ? `${type} (${details})` : type
}

/**
 * Cue recording for #6, in the spirit of TapToSync/TapBeatAnchors: play the backing track and
 * perform on the connected device - every message it sends while the track plays becomes a cue at
 * the track's own playback position (the same Master-Clock TapToSync reads), decoded into the
 * device's plugin event (`kemper.selectRig`, `rc500.selectMemory`, ...) so it replays through the
 * existing translator. Only devices with a decoder (midiCueDecoders.ts) can be chosen.
 *
 * Nothing is saved until "Übernehmen": the cues are handed to the caller to merge into the
 * variant's draft, like every other recording tool in the editor.
 */
/** Snapping windows offered (ms either side of a cue). */
const SNAP_WINDOWS_MS = [30, 60, 100, 150] as const

export function CueRecorder({ trackSrc, chordProContent, onComplete, onCancel }: CueRecorderProps) {
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const configs = useDeviceTransportConfigStore((state) => state.configs)
  const recordable = logicalDevices.filter((device) => canDecodeCapability(device.capability))

  const [deviceId, setDeviceId] = useState('')
  const [inputs, setInputs] = useState<MidiInputInfo[] | null | undefined>(undefined)
  const [inputId, setInputId] = useState('')
  const [rows, setRows] = useState<LiveRow[]>([])
  const [ignored, setIgnored] = useState(0)
  const [onsets, setOnsets] = useState<TrackOnsets | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [snapWindowMs, setSnapWindowMs] = useState<number>(60)
  const { elapsedMs, isPlaying, duration, position, togglePlay, audioProps } = useTrackClock(trackSrc)
  const recordingRef = useRef<CueRecording | null>(null)
  const isPlayingRef = useRef(false)

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  function refreshInputs() {
    void listMidiInputs().then((found) => {
      setInputs(found)
      setInputId((current) => (found?.some((input) => input.id === current) ? current : (found?.[0]?.id ?? '')))
    })
  }
  useEffect(refreshInputs, [])

  const device = recordable.find((candidate) => candidate.id === deviceId) ?? null
  // The device's own configured MIDI channel (1-16, stored 1-based) - unset means any channel.
  const configuredChannel = Number(
    configs.find((config) => config.deviceId === getDeviceId() && config.logicalDeviceId === deviceId)?.values.midiChannel,
  )
  const channel = Number.isInteger(configuredChannel) && configuredChannel >= 1 && configuredChannel <= 16 ? configuredChannel - 1 : null

  // (Re)start a recording whenever the device/port changes: a different device decodes differently,
  // so cues captured for the previous choice must not carry over.
  useEffect(() => {
    recordingRef.current = null
    setRows([])
    setIgnored(0)
    if (!device || !inputId) return
    const decoder = createMidiDecoder(device.capability, channel)
    if (!decoder) return
    const recording = createCueRecording(decoder)
    recordingRef.current = recording
    let stop: (() => void) | null = null
    let cancelled = false
    void listenToMidiInputById(inputId, (data) => {
      // Only what happens while the track actually plays is a cue - a stomp while paused is not.
      if (!isPlayingRef.current) return
      const cue = recording.handle(data, useClockStore.getState().getElapsedMs())
      setIgnored(recording.ignoredCount())
      if (cue) {
        setRows(recording.recorded().map((recorded, index) => ({ key: index, timeMs: recorded.timeMs, label: describe(recorded.event.type, recorded.event.payload) })))
      }
    }).then((unsubscribe) => {
      if (cancelled) unsubscribe?.()
      else stop = unsubscribe
    })
    return () => {
      cancelled = true
      stop?.()
    }
    // `channel` derives from `configs`, which is a new array reference on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, inputId, device?.capability, channel])

  // The onsets belong to one track: a different track means a stale analysis.
  useEffect(() => {
    setOnsets(null)
    setSnapEnabled(false)
    setAnalysisError(null)
  }, [trackSrc])

  async function analyzeOnsets() {
    if (!trackSrc) return
    setAnalyzing(true)
    setAnalysisError(null)
    try {
      const result = await analyzeOnsetsBlob(await (await fetch(trackSrc)).blob())
      setOnsets(result)
      setSnapEnabled(true)
    } catch {
      setAnalysisError('Onset-Analyse fehlgeschlagen (Track nicht dekodierbar?).')
    } finally {
      setAnalyzing(false)
    }
  }

  const snapOnsets = snapEnabled && onsets ? onsets.onsets : null
  function snappedTime(timeMs: number): { timeMs: number; shiftMs: number } {
    const onset = snapOnsets ? snapToOnset(timeMs, snapOnsets, snapWindowMs) : null
    return onset ? { timeMs: Math.round(onset.timeMs), shiftMs: Math.round(onset.timeMs) - timeMs } : { timeMs, shiftMs: 0 }
  }

  // Timestamped `{part:}` sections against the nearest detected onset - shows at a glance whether
  // this song's section starts land on attacks the snapping can use.
  const partStarts = onsets ? loopSections(parseChordPro(chordProContent ?? ''), null) : []

  function accept() {
    const recording = recordingRef.current
    if (!recording || !device) return
    const cues = recording.toShowCues(device.id)
    onComplete(snapOnsets ? snapCues(cues, snapOnsets, snapWindowMs).map((snapped) => snapped.cue) : cues)
  }

  const inputProblem = inputs === null ? 'WebMIDI ist nicht verfügbar (Browser oder Berechtigung).' : inputs?.length === 0 ? 'Kein MIDI-Eingang gefunden.' : null

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft">
        <span>Track abspielen und am Gerät spielen - jede Aktion wird als Cue an der Track-Position aufgenommen.</span>
        <span className="font-sb-mono text-ink">{(elapsedMs / 1000).toFixed(2)}s</span>
      </div>

      {!trackSrc ? (
        <p className="rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-faint">
          Für diese Variante ist kein Track angehängt - Cues brauchen einen Track als Zeitachse.
        </p>
      ) : (
        <div className="flex items-center gap-2 rounded-sb-sm bg-control px-3 py-2 text-xs text-ink-soft">
          <audio {...audioProps} />
          <button type="button" onClick={togglePlay} className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover">
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <span className="font-sb-mono">
            {formatTrackClockTime(position)} / {formatTrackClockTime(duration)}
          </span>
          {isPlaying && device && inputId && <span className="ml-auto font-bold text-red-500">● Aufnahme läuft</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-muted">
          Gerät
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={recordable.length === 0} className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink disabled:opacity-40">
            <option value="">{recordable.length === 0 ? 'Kein aufnahmefähiges Gerät eingerichtet' : 'Wählen…'}</option>
            {recordable.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-muted">
          MIDI-Eingang
          <span className="flex gap-1">
            <select value={inputId} onChange={(e) => setInputId(e.target.value)} disabled={!inputs?.length} className="min-w-0 flex-1 rounded-sb-sm bg-control px-2 py-1 text-sm text-ink disabled:opacity-40">
              {(inputs ?? []).map((input) => (
                <option key={input.id} value={input.id}>
                  {input.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={refreshInputs} title="MIDI-Eingänge neu einlesen" className="rounded-sb-sm bg-control-strong px-2 text-sm text-ink hover:bg-control-strong-hover">
              ↻
            </button>
          </span>
        </label>
      </div>
      {inputProblem && <p className="text-xs text-red-500">{inputProblem}</p>}

      <div className="max-h-48 flex-1 space-y-1 overflow-y-auto rounded-sb-sm bg-control p-3 font-sb-mono text-sm">
        {rows.length === 0 ? (
          <p className="text-ink-faint">Noch nichts aufgenommen.</p>
        ) : (
          rows.map((row) => (
            <p key={row.key} className="text-ink">
              <span className="text-ink-faint">{(snappedTime(row.timeMs).timeMs / 1000).toFixed(2)}s</span> {row.label}
              {snappedTime(row.timeMs).shiftMs !== 0 && (
                <span className="ml-2 text-xs text-accent">eingerastet {snappedTime(row.timeMs).shiftMs > 0 ? '+' : ''}{snappedTime(row.timeMs).shiftMs} ms</span>
              )}
            </p>
          ))
        )}
      </div>
      {ignored > 0 && <p className="text-xs text-ink-faint">{ignored} Nachricht(en) ohne passendes Ereignis übersprungen.</p>}

      <div className="flex flex-col gap-2 rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void analyzeOnsets()}
            disabled={!trackSrc || analyzing}
            className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {analyzing ? 'Analysiere…' : 'Onsets analysieren'}
          </button>
          {onsets && <span className="text-xs text-ink-faint">{onsets.onsets.length} Onsets gefunden</span>}
          {onsets && (
            <>
              <label className="ml-auto flex items-center gap-1 text-ink">
                <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
                Cues einrasten
              </label>
              <select
                aria-label="Einrast-Fenster"
                value={snapWindowMs}
                onChange={(e) => setSnapWindowMs(Number(e.target.value))}
                disabled={!snapEnabled}
                className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink disabled:opacity-40"
              >
                {SNAP_WINDOWS_MS.map((windowMs) => (
                  <option key={windowMs} value={windowMs}>
                    ±{windowMs} ms
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        {analysisError && <p className="text-xs text-red-500">{analysisError}</p>}
        {partStarts.length > 0 && (
          <div className="flex flex-col gap-0.5 text-xs text-ink-muted">
            <span>Abschnittsstarts zum nächsten Onset:</span>
            {partStarts.map((section) => {
              const nearest = snapToOnset(section.startMs, onsets?.onsets ?? [], MAX_SNAP_WINDOW_MS)
              const offsetMs = nearest ? Math.round(nearest.timeMs - section.startMs) : null
              return (
                <span key={section.startMs} className="font-sb-mono">
                  {section.label} · {(section.startMs / 1000).toFixed(1)}s ·{' '}
                  {offsetMs === null ? `kein Onset innerhalb ±${MAX_SNAP_WINDOW_MS} ms` : `${offsetMs >= 0 ? '+' : ''}${offsetMs} ms`}
                </span>
              )
            })}
          </div>
        )}
        <p className="text-xs text-ink-faint">Einrasten verschiebt Cues auf den nächsten erkannten Anschlag - ohne Zusage, dass jeder Abschnittswechsel einen hat.</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={rows.length === 0}
          className="flex-1 rounded-sb-sm bg-accent-2 py-3 text-lg font-bold text-accent-ink hover:bg-accent-2-hover disabled:opacity-40"
        >
          Übernehmen{rows.length > 0 ? ` (${rows.length} Cues)` : ''}
        </button>
        <button type="button" onClick={onCancel} className="rounded-sb-sm bg-control-strong px-4 py-3 text-sm hover:bg-control-strong-hover">
          Abbrechen
        </button>
      </div>
    </div>
  )
}
