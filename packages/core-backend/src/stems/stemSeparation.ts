import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StemModel } from 'shared-types'

/**
 * Stem separation (#9) on the Stage-Server: a Python script (`scripts/stem_separate.py`, Demucs +
 * PyAV) in its own virtualenv - `$STAGEBOARD_STATE_DIR/stems/venv`, overridable with STEMS_PYTHON.
 * Installed on demand like Piper (docs/03), ~1.1 GB; without it the stem-separation plugin still
 * installs and says so (Graceful Degradation). All the small things (2:50): 4 stems in ~45 s.
 */

export interface StemsConfig {
  python: string
  script: string
}

export function stemsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StemsConfig {
  return {
    python: env.STEMS_PYTHON ?? join(env.STAGEBOARD_STATE_DIR ?? './data', 'stems', 'venv', 'bin', 'python'),
    // dist/stems/ and src/stems/ are both two levels below the package, next to scripts/.
    script: fileURLToPath(new URL('../../scripts/stem_separate.py', import.meta.url)),
  }
}

/** A song takes about a quarter of its length; this is far beyond any real song. */
const TIMEOUT_MS = 20 * 60_000

export interface StemFile {
  /** drums, bass, vocals, other, guitar, piano, guitar-left, guitar-right */
  key: string
  /** Absolute path of the written MP3. */
  path: string
}

/** "PROGRESS 0.472" -> 0.472; anything else -> null. */
export function parseStemProgress(line: string): number | null {
  const match = /^PROGRESS\s+([0-9.]+)\s*$/.exec(line.trim())
  return match ? Math.min(1, Math.max(0, Number(match[1]))) : null
}

/** The script's last line, `RESULT {"stems":[{"key","file"}]}`, as files under `outDir`. */
export function parseStemResult(line: string, outDir: string): StemFile[] | null {
  const match = /^RESULT\s+(\{.*\})\s*$/.exec(line.trim())
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1]!) as { stems?: { key?: unknown; file?: unknown }[] }
    const stems = (parsed.stems ?? []).filter((s): s is { key: string; file: string } => typeof s.key === 'string' && typeof s.file === 'string' && /^[\w-]+\.webm$/.test(s.file))
    return stems.map((s) => ({ key: s.key, path: join(outDir, s.file) }))
  } catch {
    return null
  }
}

export function stemsAvailable(config: StemsConfig = stemsConfigFromEnv()): boolean {
  return existsSync(config.python) && existsSync(config.script)
}

export function runStemSeparation(
  input: string,
  outDir: string,
  options: { model: StemModel; splitGuitar: boolean },
  onProgress: (fraction: number) => void,
  config: StemsConfig = stemsConfigFromEnv(),
  timeoutMs: number = TIMEOUT_MS,
): Promise<StemFile[]> {
  return new Promise((resolve, reject) => {
    if (!stemsAvailable(config)) {
      reject(new Error('Stem-Trennung ist auf dem Stage-Server nicht installiert (Demucs, siehe docs/03).'))
      return
    }
    const args = [config.script, input, outDir, options.model, ...(options.model === 'extended' && options.splitGuitar ? ['--split-guitar'] : [])]
    const child = spawn(config.python, args)
    let result: StemFile[] | null = null
    let pending = ''
    let stderrTail = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const progress = parseStemProgress(line)
        if (progress !== null) onProgress(progress)
        result = parseStemResult(line, outDir) ?? result
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (pending) result = parseStemResult(pending, outDir) ?? result
      if (timedOut) reject(new Error('Stem-Trennung hat zu lange gedauert und wurde abgebrochen.'))
      else if (code !== 0 || !result || result.length === 0) reject(new Error(`Stem-Trennung fehlgeschlagen (Code ${code}): ${stderrTail.trim().split('\n').slice(-1)[0] ?? ''}`))
      else resolve(result)
    })
  })
}
