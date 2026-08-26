import { useEffect, useRef, useState } from 'react'
import { centsToColor } from '../lib/centsColor'
import { detectPitch } from '../lib/pitchDetection'
import { noteFromFrequency, type NoteMatch } from '../lib/noteFromFrequency'
import { PitchHistory } from '../lib/pitchSmoothing'
import {
  minRmsToSlider,
  responsivenessFromWindow,
  sliderToMinRms,
  type TunerConfig,
} from './tunerConfig'

type MicStatus = 'idle' | 'requesting' | 'listening' | 'denied' | 'insecure-context' | 'unsupported'

/**
 * Docs/02 tier 1 "Musician Toolkit" - a chromatic tuner via the tablet's own microphone.
 * Not capability-gated (registry.tsx: requires: []) - it needs a browser API, not a
 * plugin, so the graceful-degradation states are handled internally the same way
 * MidiStatusWidget handles its own WebMIDI states, rather than through the capability
 * system.
 *
 * `getUserMedia` needs a secure context (HTTPS or localhost) the same way
 * `crypto.randomUUID()` does (see lib/id.ts, docs/03's Live-Tablet-Debugging section) -
 * on a tablet reached over plain http://<lan-ip>, `navigator.mediaDevices` is undefined
 * for that reason, not because the device itself lacks a microphone API. Checking
 * isSecureContext first, before the generic feature check, is what tells those two
 * apart instead of showing a misleading "not supported here" on hardware that's fine.
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
    <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-soft">
      {status === 'idle' && (
        <button
          type="button"
          onClick={() => void start()}
          className="rounded-sb-sm bg-control-strong px-4 py-2 font-medium text-ink hover:bg-control-strong-hover"
        >
          Mikrofon aktivieren
        </button>
      )}
      {status === 'requesting' && (
        <p className="text-sm text-ink-faint">Warte auf Mikrofon-Zugriff…</p>
      )}
      {status === 'insecure-context' && (
        <p className="text-sm text-ink-faint">
          Mikrofon braucht eine sichere Verbindung (HTTPS oder localhost) - im LAN per
          http nicht verfügbar, unabhängig vom Gerät.
        </p>
      )}
      {status === 'unsupported' && (
        <p className="text-sm text-ink-faint">Mikrofon wird von diesem Browser nicht unterstützt.</p>
      )}
      {status === 'denied' && <p className="text-sm text-ink-faint">Kein Zugriff aufs Mikrofon.</p>}
      {status === 'listening' &&
        (note ? (
          <>
            <p className="text-8xl font-bold leading-none text-ink">
              {note.name}
              <span className="text-3xl text-ink-faint">{note.octave}</span>
            </p>
            {/* The meter: a fixed center tick marks exactly where "in tune" is, separate
                from the moving indicator - without it there's nothing to see the ball
                actually reach. The indicator itself is oversized on purpose (readable
                from a music-stand's distance) and colored on a red-yellow-green gradient
                by how close it is, not just a two-state color flip. */}
            <div className="relative h-4 w-full max-w-xs rounded-full bg-control">
              <div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-faint" />
              <div
                className="absolute top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-ink shadow-lg transition-[left] duration-100"
                style={{ left: `${50 + note.cents}%`, backgroundColor: centsToColor(note.cents) }}
              />
            </div>
            <p className="text-lg text-ink-faint">
              {note.cents > 0 ? '+' : ''}
              {note.cents} Cent · {frequency?.toFixed(1)} Hz
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-faint">Spiele eine Note…</p>
        ))}
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
          min={1}
          max={119}
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
    </div>
  )
}
