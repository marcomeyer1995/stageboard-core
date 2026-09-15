import { useEffect, useRef, useState } from 'react'
import { centsToColor } from '../lib/centsColor'
import { detectPitch } from '../lib/pitchDetection'
import { noteFromFrequency, type NoteMatch } from '../lib/noteFromFrequency'
import { PitchHistory } from '../lib/pitchSmoothing'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import {
  DEFAULT_METER_SIZE_RATIO,
  DEFAULT_NOTE_SIZE_RATIO,
  minRmsToSlider,
  responsivenessFromWindow,
  sliderToMinRms,
  type TunerConfig,
} from './tunerConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

type MicStatus = 'idle' | 'requesting' | 'listening' | 'denied' | 'insecure-context' | 'unsupported'

/**
 * Docs/02 tier 1 "Musician Toolkit" - a chromatic tuner via the tablet's own microphone.
 * Not capability-gated (registry.tsx: requires: []) - it needs a browser API, not a
 * plugin, so the graceful-degradation states are handled internally the same way
 * MidiStatusWidget handles its own WebMIDI states, rather than through the capability
 * system.
 *
 * Two functional elements, each a ratio of the device-wide default rather than auto-fit to
 * the tile (Marco, 2026-09-14): the detected note name, and the meter row (track/tick/ball
 * plus the cents/Hz caption) - the meter used to be sized with CSS container-query units
 * (cqh/cqw) rather than font-size at all; its dimensions are now derived from
 * `meterFontSize` instead, keeping the same proportions relative to each other the cq
 * values had (ball = 1x, tick = 1.33x tall / 0.09x wide, track = 0.4x tall, cents/Hz text
 * = 0.6x) so the whole row scales with its slider instead of the container. The "Aus"
 * button, and the idle/error/status messages, are unaffected - those are full sentences
 * meant to wrap onto multiple lines, not a fit-to-content concern.
 */
export function TunerWidget({ config }: { config: TunerConfig }) {
  const [status, setStatus] = useState<MicStatus>('idle')
  const [note, setNote] = useState<NoteMatch | null>(null)
  const [frequency, setFrequency] = useState<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const historyRef = useRef(new PitchHistory())
  // Read from a ref, not the `config` closure the tick loop was set up with, so changing
  // the ConfigPanel's settings takes effect immediately on an already-listening widget
  // instead of only after the mic is stopped and restarted.
  const configRef = useRef(config)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const noteFontSize = baseFontSize * (config.noteSizeRatio ?? DEFAULT_NOTE_SIZE_RATIO)
  const meterFontSize = baseFontSize * (config.meterSizeRatio ?? DEFAULT_METER_SIZE_RATIO)

  useEffect(() => {
    configRef.current = config
    const settings = responsivenessFromWindow(config.smoothingWindow)
    historyRef.current = new PitchHistory(settings.size, settings.maxMisses)
  }, [config])

  function stop() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
  }

  useEffect(() => stop, [])

  function stopListening() {
    stop()
    setStatus('idle')
    setNote(null)
    setFrequency(null)
  }

  async function start() {
    if (!window.isSecureContext) {
      setStatus('insecure-context')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported')
      return
    }
    setStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const buffer = new Float32Array(analyser.fftSize)

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer)
        const settings = responsivenessFromWindow(configRef.current.smoothingWindow)
        historyRef.current.push(
          detectPitch(buffer, audioContext.sampleRate, configRef.current.minRms),
        )
        const smoothed = historyRef.current.smoothed(settings.minReadings)
        if (smoothed) {
          setFrequency(smoothed)
          setNote(
            noteFromFrequency(smoothed, {
              referenceFrequency: configRef.current.referenceFrequency,
              naming: configRef.current.noteNaming,
            }),
          )
        } else {
          setFrequency(null)
          setNote(null)
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      setStatus('listening')
    } catch {
      setStatus('denied')
    }
  }

  return (
    <div className="flex h-full w-full flex-col text-ink-soft [container-type:size]">
      {status === 'listening' && (
        <div className="flex justify-end p-[1.5cqh]">
          <button
            type="button"
            onClick={stopListening}
            className="rounded-sb-sm bg-control-strong px-[4cqw] py-[2cqh] text-[5.5cqh] font-medium text-ink hover:bg-control-strong-hover"
          >
            Aus
          </button>
        </div>
      )}

      {status === 'listening' && note ? (
        // The three rows below use flex-grow (not justify-center) so they always sum to
        // exactly 100% of the remaining height: no leftover space stacks up above the note
        // or below the cents readout the way fixed cqh values that didn't add up to 100%
        // used to. Each row is also a real, non-overlapping flex box, so the meter's
        // tick/ball - which visually extend past its thin track - can no longer collide
        // with the note name above it; they now have a full row reserved for them.
        <div className="flex flex-1 flex-col items-center">
          <div className="flex w-full flex-[6] items-center justify-center overflow-hidden">
            <p style={{ fontSize: noteFontSize }} className="whitespace-nowrap font-bold leading-none text-ink">
              {note.name}
              <span className="text-[0.35em] text-ink-faint">{note.octave}</span>
            </p>
          </div>
          {/* The meter: a fixed center tick marks exactly where "in tune" is, taller
              than the moving indicator so it still peeks out top and bottom even when
              the ball sits right on top of it - otherwise the wider ball fully hides a
              same-height tick the moment it's actually centered, which is exactly the
              moment you most want to see it. The indicator itself is colored on a
              strict-green/orange-to-red gradient (centsColor.ts) by how close it is - no
              border or shadow on it, that's decoration a glance from across the stage
              doesn't need, and it only muddies the color that's the actual signal.
              Track width stays a plain CSS percentage (fills the row), not tied to the
              size ratio - only the indicators' own sizes should shrink/grow with it. */}
          <div className="flex w-full flex-[4] items-center justify-center">
            <div
              className="relative w-[92%] rounded-full bg-control"
              style={{ height: meterFontSize * 0.4 }}
            >
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-faint"
                style={{ height: meterFontSize * 1.33, width: meterFontSize * 0.093 }}
              />
              <div
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-100"
                style={{
                  left: `${50 + note.cents}%`,
                  height: meterFontSize,
                  width: meterFontSize,
                  backgroundColor: centsToColor(note.cents),
                }}
              />
            </div>
          </div>
          <div className="flex w-full flex-[2] items-center justify-center">
            <p style={{ fontSize: meterFontSize * 0.6 }} className="font-medium text-ink-faint">
              {note.cents > 0 ? '+' : ''}
              {note.cents} Cent · {frequency?.toFixed(1)} Hz
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-[2cqh]">
          {status === 'idle' && (
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-sb-sm bg-control-strong px-[5cqw] py-[2.5cqh] text-[6cqh] font-bold text-ink hover:bg-control-strong-hover"
            >
              Mikrofon aktivieren
            </button>
          )}
          {status === 'requesting' && (
            <p className="text-[5cqh] text-ink-faint">Warte auf Mikrofon-Zugriff…</p>
          )}
          {status === 'insecure-context' && (
            <p className="px-[4cqw] text-center text-[4cqh] text-ink-faint">
              Mikrofon braucht eine sichere Verbindung (HTTPS oder localhost) - im LAN per
              http nicht verfügbar, unabhängig vom Gerät.
            </p>
          )}
          {status === 'unsupported' && (
            <p className="text-[4cqh] text-ink-faint">
              Mikrofon wird von diesem Browser nicht unterstützt.
            </p>
          )}
          {status === 'denied' && (
            <p className="text-[4cqh] text-ink-faint">Kein Zugriff aufs Mikrofon.</p>
          )}
          {status === 'listening' && !note && (
            <p className="text-[5cqh] text-ink-faint">Spiele eine Note…</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Static stand-in for the Widget Gallery (#22) - the real component only ever shows a note
 * once the mic is both permitted and actively hearing one, neither of which a gallery tile
 * can fake without literally asking for microphone access just to render a thumbnail. Mimics
 * the real "listening, in tune" markup/classes (minus the container-query units, which need
 * an actual sized ancestor a small fixed-height tile already provides differently) so it
 * still reads as "this is the tuner", not a generic placeholder.
 */
export function TunerWidgetPreview() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-soft">
      <p className="text-3xl font-bold leading-none text-ink">
        A<span className="text-sm text-ink-faint">4</span>
      </p>
      <div className="relative h-1.5 w-4/5 rounded-full bg-control">
        <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-faint" />
        <div className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-500" />
      </div>
      <p className="text-[10px] text-ink-faint">440.0 Hz</p>
    </div>
  )
}

export function TunerConfigPanel({
  config,
  onChange,
}: {
  config: TunerConfig
  onChange: (next: TunerConfig) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        <div className="flex items-center justify-between">
          <span>Empfindlichkeit</span>
          <span className="text-ink-faint">{config.minRms.toFixed(4)} RMS</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={minRmsToSlider(config.minRms)}
          onChange={(e) => onChange({ ...config, minRms: sliderToMinRms(Number(e.target.value)) })}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-ink-faint">
          <span>Unempfindlich</span>
          <span>Empfindlich</span>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        <div className="flex items-center justify-between">
          <span>Reaktionsgeschwindigkeit</span>
          <span className="text-ink-faint">{config.smoothingWindow}</span>
        </div>
        <input
          type="range"
          min={50}
          max={150}
          step={1}
          value={config.smoothingWindow}
          onChange={(e) => onChange({ ...config, smoothingWindow: Number(e.target.value) })}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-ink-faint">
          <span>Schnell</span>
          <span>Stabil</span>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        <div className="flex items-center justify-between">
          <span>Referenzton</span>
          <span className="text-ink-faint">{config.referenceFrequency.toFixed(1)} Hz</span>
        </div>
        <input
          type="range"
          min={400}
          max={480}
          step={0.5}
          value={config.referenceFrequency}
          onChange={(e) => onChange({ ...config, referenceFrequency: Number(e.target.value) })}
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-ink-faint">
          <span>400 Hz</span>
          <span>440 Hz (Standard)</span>
          <span>480 Hz</span>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Notennamen
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.noteNaming}
          onChange={(e) =>
            onChange({ ...config, noteNaming: e.target.value as TunerConfig['noteNaming'] })
          }
        >
          <option value="sharp">Kreuz (F#)</option>
          <option value="flat">B (Gb)</option>
        </select>
      </label>
      <SizeRatioSlider
        label="Notenname"
        ratio={config.noteSizeRatio ?? DEFAULT_NOTE_SIZE_RATIO}
        onChange={(noteSizeRatio) => onChange({ ...config, noteSizeRatio })}
      />
      <SizeRatioSlider
        label="Anzeige (Balken & Zeiger)"
        ratio={config.meterSizeRatio ?? DEFAULT_METER_SIZE_RATIO}
        onChange={(meterSizeRatio) => onChange({ ...config, meterSizeRatio })}
      />
    </div>
  )
}
