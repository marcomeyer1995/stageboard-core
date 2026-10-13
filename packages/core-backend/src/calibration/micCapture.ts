import { spawn } from 'node:child_process'
import { OnsetDetector } from './onsets.js'

/** A running microphone recording that reports click onsets in server time (ms). */
export interface MicCapture {
  stop(): void
  /** Onsets so far, as server times (ms). */
  onsetsMs(): number[]
  /** Set when the recording could not run (no `arecord`, no input device, nothing recorded). */
  error(): string | null
}

const SAMPLE_RATE = 48_000
const CHUNK_FRAMES = 240 // 5 ms - small chunks keep the frame->time mapping tight

function nowMs(): number {
  return performance.timeOrigin + performance.now()
}

/**
 * Records the Stage-Server's microphone (ALSA `arecord`, device from CALIBRATION_AUDIO_DEVICE,
 * default `default`) and detects click onsets on the fly. Frame -> server time comes from the
 * least-buffered chunk (read time minus the frames read so far, minimum over the run); what remains
 * is a constant capture bias of a few ms, the same for every device being calibrated.
 */
export function startMicCapture(device = process.env.CALIBRATION_AUDIO_DEVICE ?? 'default'): MicCapture {
  const detector = new OnsetDetector(SAMPLE_RATE)
  let frames = 0
  let base = Infinity
  let leftover: Buffer | null = null
  let failure: string | null = null
  let gotData = false

  const proc = spawn('arecord', ['-q', '-D', device, '-f', 'S16_LE', '-r', String(SAMPLE_RATE), '-c', '1', '-t', 'raw', '--period-size', String(CHUNK_FRAMES), '--buffer-size', String(CHUNK_FRAMES * 4)])
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
    const whole = data.length - (data.length % 2)
    leftover = whole < data.length ? data.subarray(whole) : null
    const samples = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + whole))
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
  }
}
