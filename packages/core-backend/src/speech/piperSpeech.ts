import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { readWav16Mono, trimSpeech, writeWav16Mono } from './wavTrim.js'

/**
 * Spoken announcements (#63): text -> trimmed WAV, generated with Piper (offline neural TTS, run as
 * a separate program) and kept on disk - each text is generated once, every device downloads the
 * same clip. Piper and its voice live outside the repo (docs/21 §9): by default under
 * `$STAGEBOARD_STATE_DIR/speech/piper/`, overridable with PIPER_BIN / PIPER_VOICE.
 */

/** Bumped when the post-processing changes, so old cached clips are not served any more. */
const CLIP_FORMAT = 1
export const MAX_SPEECH_TEXT = 80
const GENERATE_TIMEOUT_MS = 15_000

export interface SpeechConfig {
  piperBin: string
  voice: string
  cacheDir: string
}

export function speechConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SpeechConfig {
  const base = join(env.STAGEBOARD_STATE_DIR ?? './data', 'speech')
  return {
    piperBin: env.PIPER_BIN ?? join(base, 'piper', 'piper', 'piper'),
    voice: env.PIPER_VOICE ?? join(base, 'piper', 'voices', 'de_DE-thorsten-medium.onnx'),
    cacheDir: join(base, 'cache'),
  }
}

export type SpeechResult = { ok: true; wav: Buffer; generated: boolean } | { ok: false; reason: 'unavailable' | 'failed'; message: string }

export class PiperSpeech {
  private queue: Promise<unknown> = Promise.resolve()
  private inFlight = new Map<string, Promise<SpeechResult>>()

  constructor(private readonly config: SpeechConfig) {}

  /** Whether Piper and the voice are installed on this server. */
  available(): boolean {
    return existsSync(this.config.piperBin) && existsSync(this.config.voice)
  }

  voiceName(): string {
    return basename(this.config.voice).replace(/\.onnx$/, '')
  }

  /** Normalised text: one line, single spaces - "Chorus " and "Chorus" are the same clip. */
  static normalise(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH_TEXT)
  }

  async speak(rawText: string): Promise<SpeechResult> {
    const text = PiperSpeech.normalise(rawText)
    const key = createHash('sha1').update(`${CLIP_FORMAT}\n${this.voiceName()}\n${text}`).digest('hex')
    const file = join(this.config.cacheDir, `${key}.wav`)
    if (existsSync(file)) return { ok: true, wav: await readFile(file), generated: false }
    if (!this.available()) return { ok: false, reason: 'unavailable', message: `Piper nicht installiert (${this.config.piperBin}, ${this.config.voice})` }
    const running = this.inFlight.get(key)
    if (running) return running
    // One Piper at a time: a song's clips are requested together, the laptop must keep its CPU for audio.
    const job = this.queue.then(() => this.generate(text, file))
    this.queue = job.catch(() => undefined)
    this.inFlight.set(key, job)
    try {
      return await job
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async generate(text: string, file: string): Promise<SpeechResult> {
    await mkdir(this.config.cacheDir, { recursive: true })
    const raw = `${file}.piper.wav`
    try {
      await runPiper(this.config, text, raw)
      const wav = writeWav16Mono(trimSpeech(readWav16Mono(await readFile(raw))))
      await writeFile(`${file}.tmp`, wav)
      await rename(`${file}.tmp`, file)
      return { ok: true, wav, generated: true }
    } catch (err) {
      return { ok: false, reason: 'failed', message: err instanceof Error ? err.message : String(err) }
    } finally {
      await rm(raw, { force: true })
    }
  }
}

function runPiper(config: SpeechConfig, text: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.piperBin, ['--model', config.voice, '--output_file', outFile], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    const timer = setTimeout(() => proc.kill('SIGKILL'), GENERATE_TIMEOUT_MS)
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`piper exited with ${code}: ${stderr.trim().split('\n').pop() ?? ''}`))
    })
    proc.stdin.end(`${text}\n`)
  })
}
