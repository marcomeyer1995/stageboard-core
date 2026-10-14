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
  /** The voice used when a request names none (PIPER_VOICE, default Thorsten). */
  voice: string
  /** Where downloaded voices live (`<key>.onnx` + `<key>.onnx.json`, voiceCatalog.ts). */
  voicesDir: string
  cacheDir: string
}

export function speechConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SpeechConfig {
  const base = join(env.STAGEBOARD_STATE_DIR ?? './data', 'speech')
  return {
    piperBin: env.PIPER_BIN ?? join(base, 'piper', 'piper', 'piper'),
    voice: env.PIPER_VOICE ?? join(base, 'piper', 'voices', 'de_DE-thorsten-medium.onnx'),
    voicesDir: join(base, 'piper', 'voices'),
    cacheDir: join(base, 'cache'),
  }
}

export type SpeechResult = { ok: true; wav: Buffer; generated: boolean } | { ok: false; reason: 'unavailable' | 'failed'; message: string }

export class PiperSpeech {
  private queue: Promise<unknown> = Promise.resolve()
  private inFlight = new Map<string, Promise<SpeechResult>>()

  constructor(private readonly config: SpeechConfig) {}

  /** Whether the Piper program is installed on this server. */
  piperInstalled(): boolean {
    return existsSync(this.config.piperBin)
  }

  /** The model file of a voice (`voiceKey`, else the default voice), if installed. */
  private voiceFile(voiceKey?: string): string | null {
    const file = voiceKey ? join(this.config.voicesDir, `${voiceKey}.onnx`) : this.config.voice
    return existsSync(file) && existsSync(`${file}.json`) ? file : null
  }

  /** Whether Piper and the voice are installed on this server. */
  available(voiceKey?: string): boolean {
    return this.piperInstalled() && this.voiceFile(voiceKey) !== null
  }

  voiceName(voiceKey?: string): string {
    return voiceKey ?? basename(this.config.voice).replace(/\.onnx$/, '')
  }

  /** Normalised text: one line, single spaces - "Chorus " and "Chorus" are the same clip. */
  static normalise(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH_TEXT)
  }

  async speak(rawText: string, voiceKey?: string): Promise<SpeechResult> {
    const text = PiperSpeech.normalise(rawText)
    const key = createHash('sha1').update(`${CLIP_FORMAT}\n${this.voiceName(voiceKey)}\n${text}`).digest('hex')
    const file = join(this.config.cacheDir, `${key}.wav`)
    if (existsSync(file)) return { ok: true, wav: await readFile(file), generated: false }
    const model = this.voiceFile(voiceKey)
    if (!this.piperInstalled() || !model) return { ok: false, reason: 'unavailable', message: `Piper oder Stimme ${this.voiceName(voiceKey)} nicht installiert` }
    const running = this.inFlight.get(key)
    if (running) return running
    // One Piper at a time: a song's clips are requested together, the laptop must keep its CPU for audio.
    const job = this.queue.then(() => this.generate(text, model, file))
    this.queue = job.catch(() => undefined)
    this.inFlight.set(key, job)
    try {
      return await job
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async generate(text: string, model: string, file: string): Promise<SpeechResult> {
    await mkdir(this.config.cacheDir, { recursive: true })
    const raw = `${file}.piper.wav`
    try {
      await runPiper(this.config.piperBin, model, text, raw)
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

function runPiper(piperBin: string, model: string, text: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(piperBin, ['--model', model, '--output_file', outFile], { stdio: ['pipe', 'ignore', 'pipe'] })
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
