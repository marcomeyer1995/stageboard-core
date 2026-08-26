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
 *
 * Sized with CSS container query units (cqw/cqh, via [container-type:size] on the root)
 * rather than fixed-size text/height/width classes, so the note display actually fills
 * whatever size the widget has been resized to instead of sitting small in the middle of
 * a lot of empty space.
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
        // A second, nested container-query context sized to *this* row's actual
        // remaining height (after the "Aus" button row above it), not the widget's full
        // height - so note/meter/text keep scaling together as that space grows or
        // shrinks, independent of whether the button row is even present. The three rows
        // below use flex-grow (not justify-center) so they always sum to exactly 100% of
        // that height: no leftover space stacks up above the note or below the cents
        // readout the way fixed cqh values that didn't add up to 100% used to. Each row
        // is also a real, non-overlapping flex box, so the meter's tick/ball - which
        // visually extend past its thin track - can no longer collide with the note name
        // above it; they now have a full row reserved for them.
        <div className="flex flex-1 flex-col items-center [container-type:size]">
          <div className="flex w-full flex-[5] items-center justify-center">
            <p className="text-[24cqh] font-bold leading-none text-ink">
              {note.name}
              <span className="text-[9cqh] text-ink-faint">{note.octave}</span>
            </p>
          </div>
          {/* The meter: a fixed center tick marks exactly where "in tune" is, taller
              than the moving indicator so it still peeks out top and bottom even when
              the ball sits right on top of it - otherwise the wider ball fully hides a
              same-height tick the moment it's actually centered, which is exactly the
              moment you most want to see it. The indicator itself is colored on a
              strict-green/orange-to-red gradient (centsColor.ts) by how close it is. */}
          <div className="flex w-full flex-[4] items-center justify-center">
            <div className="relative h-[5cqh] w-[92cqw] rounded-full bg-control">
              <div className="absolute left-1/2 top-1/2 h-[16cqh] w-[1.2cqw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-faint" />
              <div
                className="absolute top-1/2 h-[12cqh] w-[12cqh] -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-ink shadow-lg transition-[left] duration-100"
                style={{ left: `${50 + note.cents}%`, backgroundColor: centsToColor(note.cents) }}
              />
            </div>
          </div>
          <div className="flex w-full flex-[2] items-center justify-center">
            <p className="text-[6cqh] text-ink-faint">
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
              className="rounded-sb-sm bg-control-strong px-[4cqw] py-[2cqh] text-[4cqh] font-medium text-ink hover:bg-control-strong-hover"
            >
              Mikrofon aktivieren
            </button>
          )}
          {status === 'requesting' && (
            <p className="text-[4cqh] text-ink-faint">Warte auf Mikrofon-Zugriff…</p>
          )}
          {status === 'insecure-context' && (
            <p className="px-[4cqw] text-center text-[3.5cqh] text-ink-faint">
              Mikrofon braucht eine sichere Verbindung (HTTPS oder localhost) - im LAN per
              http nicht verfügbar, unabhängig vom Gerät.
            </p>
          )}
          {status === 'unsupported' && (
            <p className="text-[3.5cqh] text-ink-faint">
              Mikrofon wird von diesem Browser nicht unterstützt.
            </p>
          )}
          {status === 'denied' && (
            <p className="text-[3.5cqh] text-ink-faint">Kein Zugriff aufs Mikrofon.</p>
          )}
          {status === 'listening' && !note && (
            <p className="text-[4cqh] text-ink-faint">Spiele eine Note…</p>
          )}
        </div>
      )}
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
    </div>
  )
}
