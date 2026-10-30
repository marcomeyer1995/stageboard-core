import { spawn } from 'node:child_process'
import { OnsetDetector } from './onsets.js'

/** A running microphone recording that reports click onsets in server time (ms). */
export interface MicCapture {
  stop(): void
  /** Onsets so far, as server times (ms). */
  onsetsMs(): number[]
  /** Set when the recording could not run (no `arecord`, no input device, nothing recorded). */
  error(): string | null
  /** The loudest sample so far, 0..1 of full scale. */
  peak(): number
}

const SAMPLE_RATE = 48_000
const CHUNK_FRAMES = 240 // 5 ms - small chunks keep the frame->time mapping tight
/** The laptop input sits at full scale for ~500 ms after opening (DC offset settling, measured
 * 2026-10-30) - the level leaves that out. */
export const SETTLE_MS = 600
const SETTLE_FRAMES = (SAMPLE_RATE * SETTLE_MS) / 1000

function nowMs(): number {
  return performance.timeOrigin + performance.now()
}

/** The microphone while none is chosen under System → Rig-Check (#662). */
export function fallbackMicDevice(): string {
  return process.env.CALIBRATION_AUDIO_DEVICE ?? 'default'
}

/**
 * Records one channel of a Stage-Server audio input (ALSA `arecord`; #662: device and channel as
 * chosen under System → Rig-Check, else CALIBRATION_AUDIO_DEVICE / `default`, channel 0) and
 * detects click onsets on the fly. For channel n it records n+1 channels and keeps the last - an
 * interface's input 2 is the second channel of its stream. Frame -> server time comes from the
 * least-buffered chunk (read time minus the frames read so far, minimum over the run); what remains
 * is a constant capture bias of a few ms, the same for every device being calibrated.
 */
export function startMicCapture(device = fallbackMicDevice(), channel = 0): MicCapture {
  const channels = channel + 1
  const detector = new OnsetDetector(SAMPLE_RATE)
  let frames = 0
  let base = Infinity
  let leftover: Buffer | null = null
  let failure: string | null = null
  let gotData = false
  let peak = 0

  const proc = spawn('arecord', ['-q', '-D', device, '-f', 'S16_LE', '-r', String(SAMPLE_RATE), '-c', String(channels), '-t', 'raw', '--period-size', String(CHUNK_FRAMES), '--buffer-size', String(CHUNK_FRAMES * 4)])
  let stderr = ''
  proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
  proc.on('error', (err) => (failure = `Mikrofon am Stage-Server nicht verfügbar (arecord: ${err.message})`))
  proc.on('exit', (code) => {
    if (!gotData && code !== null && code !== 0 && !failure) failure = `Mikrofon am Stage-Server nicht verfügbar (arecord: ${stderr.trim() || `Code ${code}`})`
  })
  proc.stdout.on('data', (chunk: Buffer) => {
    const readAt = nowMs()
    gotData = true
    const data = leftover ? Buffer.concat([leftover, chunk]) : chunk
    const frameBytes = 2 * channels
    const whole = data.length - (data.length % frameBytes)
    leftover = whole < data.length ? data.subarray(whole) : null
    const interleaved = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + whole))
    const samples = channels === 1 ? interleaved : new Int16Array(interleaved.length / channels)
    if (channels > 1) for (let i = 0; i < samples.length; i++) samples[i] = interleaved[i * channels + channel]!
    // The input settling after it opened - not what the level meter is about.
    if (frames >= SETTLE_FRAMES) for (const sample of samples) peak = Math.max(peak, Math.abs(sample) / 32768)
    frames += samples.length
    base = Math.min(base, readAt - (frames * 1000) / SAMPLE_RATE)
    detector.feed(samples)
  })

  return {
    stop: () => {
      if (!proc.killed) proc.kill('SIGTERM')
    },
    onsetsMs: () => (Number.isFinite(base) ? detector.onsets.map((frame) => base + (frame * 1000) / SAMPLE_RATE) : []),
    error: () => failure,
    peak: () => peak,
  }
}
