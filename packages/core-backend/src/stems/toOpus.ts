import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { oggOpusInfo } from 'shared-types'
import { stemsConfigFromEnv } from './stemSeparation.js'

/**
 * Any audio file → Ogg Opus, the track format (docs/30 §8h), on the Stage-Server: for a YouTube
 * download without Opus. `scripts/to_opus.py` in the stem-separation virtualenv (PyAV) - the
 * server has no decoder of its own; without the venv the file stays as downloaded.
 */

export interface ToOpusConfig {
  python: string
  script: string
}

export function toOpusConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ToOpusConfig {
  return {
    python: stemsConfigFromEnv(env).python,
    script: fileURLToPath(new URL('../../scripts/to_opus.py', import.meta.url)),
  }
}

export function toOpusAvailable(config: ToOpusConfig = toOpusConfigFromEnv()): boolean {
  return existsSync(config.python) && existsSync(config.script)
}

/** Seconds per song (2 s for 3:38 on the laptop) - this is only against a hung process. */
const TIMEOUT_MS = 5 * 60_000

/** Encodes `input` to `output` and returns the file, checked with the same rules as the players' reader. */
export async function convertToOpus(input: string, output: string, config: ToOpusConfig = toOpusConfigFromEnv(), timeoutMs: number = TIMEOUT_MS): Promise<Buffer> {
  await new Promise<void>((resolve, reject) => {
    execFile(config.python, [config.script, input, output], { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`Umwandeln nach Opus fehlgeschlagen (${err.killed ? 'Zeitlimit' : `Code ${String(err.code)}`}): ${stderr.trim().split('\n').slice(-1)[0] ?? ''}`))
      else resolve()
    })
  })
  const data = await readFile(output)
  const info = oggOpusInfo(data)
  if (!info || info.frames === 0) throw new Error('Umwandeln nach Opus: die Datei ist kein gültiges Ogg Opus')
  return data
}
