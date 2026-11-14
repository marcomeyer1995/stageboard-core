import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { ServerMessageError, YOUTUBE_VIDEO_ID_RE, webmOpusToOgg, type YoutubeSearchResult } from 'shared-types'

/** Same "find whichever binary is already on the host" pattern as ultimateGuitarPlugin.ts's
 * `resolveChromeExecutable` - yt-dlp is not bundled or auto-installed (fetching an executable
 * at runtime/install time is its own can of worms), the operator installs it themselves. */
const YT_DLP_CANDIDATES = ['/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp']

export function resolveYtDlpExecutable(): string {
  const configured = process.env.YT_DLP_PATH
  if (configured) return configured
  const found = YT_DLP_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(`No yt-dlp executable found. Set YT_DLP_PATH, or install yt-dlp at one of: ${YT_DLP_CANDIDATES.join(', ')}`)
  }
  return found
}

/** yt-dlp's default `--newline` progress line looks like
 * `[download]  42.3% of  3.45MiB at  1.23MiB/s ETA 00:02` - this is the only line format this
 * reads; anything else (a warning, a merge step, a playlist entry count) is simply not progress,
 * not an error. */
const PROGRESS_RE = /^\[download\]\s+(\d+(?:\.\d+)?)%/

/** A 0-1 fraction, or null for a line that carries no progress info. */
export function parseYtDlpProgress(line: string): number | null {
  const match = PROGRESS_RE.exec(line.trim())
  return match ? Number(match[1]) / 100 : null
}

/** yt-dlp writes the extension of the file it actually produced (`m4a`, `webm`, ...) - the
 * container/codec YouTube happens to offer for the requested format, not something this code
 * picks. Unlisted extensions still get *a* browser-playable guess rather than failing the whole
 * job, since `<audio>` mostly figures it out from the bytes regardless of a slightly-off
 * declared type. */
const MIME_TYPES_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

export function mimeTypeForExt(ext: string): string {
  return MIME_TYPES_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Args for extracting just the audio of one video, without a hard ffmpeg dependency: YouTube's own
 * best audio-only stream, downloaded as-is (no `-x`/`--extract-audio`, which would need ffmpeg).
 * Opus first (in WebM, YouTube's format 251, ~130-160 kbit/s) - the track format (docs/30 §8h):
 * `toTrackFormat` only re-wraps it into Ogg, nothing encoded again. Only without one, whatever else
 * there is (m4a/AAC), kept as it is.
 * `outputTemplate` should have no extension of its own (`.%(ext)s` is added by yt-dlp) so the
 * caller can find the one file it wrote by extension after the fact.
 */
export function buildYtDlpArgs(url: string, outputTemplate: string, maxFileSizeBytes: number, jsRuntime: string = process.execPath): string[] {
  return [
    '-f', 'bestaudio[acodec=opus]/bestaudio/best',
    '--no-playlist', '--newline', '--no-part',
    '--max-filesize', String(maxFileSizeBytes),
    // YouTube extraction needs a JS runtime (yt-dlp only auto-enables deno, which the Stage-Server
    // doesn't have); without one yt-dlp warns that formats may be missing. The Node running this
    // server is always there. Verified live 2026-09-25 (yt-dlp 2026.08.19).
    '--js-runtimes', `node:${jsRuntime}`,
    '-o', outputTemplate,
    '--', url,
  ]
}

/**
 * A downloaded file in the track format (docs/30 §8h): WebM with Opus - nearly always, see
 * `buildYtDlpArgs` - becomes Ogg Opus, packet for packet (lossless; every device then starts it on
 * the same sample). Anything else stays as downloaded: the server has no decoder to encode it anew.
 */
export function toTrackFormat(data: Buffer, ext: string): { data: Buffer; mimeType: string; remuxed: boolean } {
  if (['webm', 'mkv'].includes(ext.toLowerCase())) {
    const ogg = webmOpusToOgg(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    if (ogg) return { data: Buffer.from(ogg.buffer, ogg.byteOffset, ogg.byteLength), mimeType: 'audio/ogg', remuxed: true }
  }
  return { data, mimeType: mimeTypeForExt(ext), remuxed: false }
}

/** The message shown on the job: yt-dlp's own `ERROR:` lines when there are any - its stderr
 * usually leads with unrelated WARNING lines that would bury the actual reason (e.g. "This video
 * is unavailable") - otherwise the raw tail. */
export function ytDlpErrorSummary(output: string): string {
  const errors = output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('ERROR:'))
  return (errors.length > 0 ? errors.join(' ') : output.trim()).slice(-500) || '(no output)'
}

/** Same ceiling as a manual upload (`MAX_AUDIO_UPLOAD_BYTES`, index.ts's body limit) - an
 * extracted track ends up in the exact same audio store and tablet caches as an uploaded one. */
export function maxExtractBytes(): number {
  return Number(process.env.MAX_AUDIO_UPLOAD_BYTES ?? 200 * 1024 * 1024)
}

/** A stalled download must not block the one-job-at-a-time queue forever. Generous: a full
 * album-length video on a slow venue uplink still fits. */
export const YT_DLP_TIMEOUT_MS = 15 * 60 * 1000

export interface YtDlpRunResult {
  /** The exact path yt-dlp wrote to, extension included. */
  filePath: string
}

/**
 * Runs yt-dlp against `url`, writing into `outputTemplate` (see `buildYtDlpArgs`), calling
 * `onProgress` with each 0-1 fraction as it's read from stdout. Rejects with yt-dlp's own
 * stderr (trimmed to its last few lines - a full crawl trace is not an actionable error message)
 * on a non-zero exit.
 */
export function runYtDlpExtract(
  url: string,
  outputTemplate: string,
  onProgress: (fraction: number) => void,
  timeoutMs: number = YT_DLP_TIMEOUT_MS,
): Promise<YtDlpRunResult> {
  return new Promise((resolve, reject) => {
    const executable = resolveYtDlpExecutable()
    const args = buildYtDlpArgs(url, outputTemplate, maxExtractBytes())
    const child = spawn(executable, args)

    let filePath: string | null = null
    let tooLarge = false
    let timedOut = false
    let stdoutTail = ''
    let stderrTail = ''
    // A pipe chunk can end mid-line - only complete lines are parsed, the remainder waits for
    // the next chunk (a split `Destination:` line would otherwise fail a good download).
    let pendingLine = ''

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    function handleLine(line: string): void {
      if (/File is larger than max-filesize/.test(line)) tooLarge = true
      const progress = parseYtDlpProgress(line)
      if (progress !== null) onProgress(progress)
      // `[download] Destination: <path>` on the way in, or `[ExistingFile]` / the merge
      // announcement if a later step renames it - the LAST path yt-dlp mentions is always
      // the one actually left on disk, so this just keeps overwriting rather than taking
      // only the first match.
      const destination = /^\[download\] Destination:\s+(.+)$/.exec(line.trim()) ?? /^\[Merger\] Merging formats into "(.+)"$/.exec(line.trim())
      if (destination) filePath = destination[1]!
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutTail = (stdoutTail + chunk.toString()).slice(-4000)
      const lines = (pendingLine + chunk.toString()).split('\n')
      pendingLine = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
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
      if (pendingLine) handleLine(pendingLine)
      if (timedOut) {
        reject(new ServerMessageError('youtube.downloadTimeout', { minutes: Math.round(timeoutMs / 60_000) }))
        return
      }
      if (tooLarge) {
        reject(new ServerMessageError('youtube.tooLarge', { mb: Math.round(maxExtractBytes() / (1024 * 1024)) }))
        return
      }
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${ytDlpErrorSummary(stderrTail || stdoutTail)}`))
        return
      }
      if (!filePath) {
        reject(new Error('yt-dlp finished but never reported a destination file'))
        return
      }
      resolve({ filePath })
    })
  })
}

/** How many hits a search lists (#618) - a screenful on a phone; the right take is near the top. */
export const YT_DLP_SEARCH_COUNT = 10

/** A search answers in ~2.5 s (measured 2026-10-20); a hung one must not keep the dialog waiting. */
export const YT_DLP_SEARCH_TIMEOUT_MS = 30_000

/** Search, metadata only: `--flat-playlist` lists the hits without resolving each video's formats. */
export function buildYtDlpSearchArgs(query: string, count: number = YT_DLP_SEARCH_COUNT, jsRuntime: string = process.execPath): string[] {
  return ['--flat-playlist', '-J', '--js-runtimes', `node:${jsRuntime}`, '--', `ytsearch${count}:${query}`]
}

/** The hits out of yt-dlp's `-J` playlist JSON - entries without an id or title are skipped. */
export function parseYtDlpSearch(json: string): YoutubeSearchResult[] {
  const data = JSON.parse(json) as { entries?: Array<Record<string, unknown>> }
  return (data.entries ?? []).flatMap((entry) => {
    const id = typeof entry.id === 'string' ? entry.id : null
    const title = typeof entry.title === 'string' ? entry.title : null
    if (!id || !title || !YOUTUBE_VIDEO_ID_RE.test(id)) return []
    return [
      {
        id,
        title,
        channel: typeof entry.channel === 'string' ? entry.channel : typeof entry.uploader === 'string' ? entry.uploader : null,
        durationSec: typeof entry.duration === 'number' ? Math.round(entry.duration) : null,
        url: `https://www.youtube.com/watch?v=${id}`,
      },
    ]
  })
}

/** Runs a YouTube search on the Stage-Server (#618) - the same yt-dlp the download uses. */
export function runYtDlpSearch(query: string, timeoutMs: number = YT_DLP_SEARCH_TIMEOUT_MS): Promise<YoutubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlpExecutable(), buildYtDlpSearchArgs(query))
    let stdout = ''
    let stderrTail = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
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
      if (timedOut) return reject(new ServerMessageError('youtube.searchTimeout'))
      if (code !== 0) return reject(new Error(`yt-dlp exited with code ${code}: ${ytDlpErrorSummary(stderrTail)}`))
      try {
        resolve(parseYtDlpSearch(stdout))
      } catch (err) {
        reject(err)
      }
    })
  })
}
