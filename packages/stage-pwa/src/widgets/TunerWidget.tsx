import { useEffect, useRef, useState } from 'react'
import { detectPitch } from '../lib/pitchDetection'
import { noteFromFrequency, type NoteMatch } from '../lib/noteFromFrequency'
import { PitchHistory } from '../lib/pitchSmoothing'

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
export function TunerWidget() {
  const [status, setStatus] = useState<MicStatus>('idle')
  const [note, setNote] = useState<NoteMatch | null>(null)
  const [frequency, setFrequency] = useState<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const historyRef = useRef(new PitchHistory())

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
      const history = historyRef.current

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer)
        history.push(detectPitch(buffer, audioContext.sampleRate))
        const smoothed = history.smoothed()
        if (smoothed) {
          setFrequency(smoothed)
          setNote(noteFromFrequency(smoothed))
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
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-soft">
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
            <p className="text-4xl font-bold text-ink">
              {note.name}
              <span className="text-xl text-ink-faint">{note.octave}</span>
            </p>
            <div className="relative h-2 w-full max-w-[200px] rounded-full bg-control">
              <div
                className={`absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full ${
                  Math.abs(note.cents) <= 5 ? 'bg-green-500' : 'bg-amber-500'
                }`}
                style={{ left: `${50 + note.cents}%` }}
              />
            </div>
            <p className="text-xs text-ink-faint">
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
