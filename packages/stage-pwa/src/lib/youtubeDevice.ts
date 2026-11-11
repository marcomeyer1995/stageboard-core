import { webmOpusToOgg, YoutubeSearchResultSchema, type AsyncJob, type HostCapabilities, type TrackMeta, type YoutubeExtractJob, type YoutubeSearchResult } from 'shared-types'
import { randomId } from './id'
import { HelperError, runHelper, trustedHelper, type HelperInfo } from './nativeHelper'

/**
 * YouTube on every host (docs/25 §6b, Marco 2026-11-10): a host that can (a laptop with yt-dlp)
 * downloads as before; otherwise - an Android device as host, or no host - the device itself, with
 * the add-on's Android helper (docs/32 §8, a separate app package a band installs itself). Either
 * way the track ends up as Ogg Opus (docs/30 §8h).
 */

export const YOUTUBE_ADDON_ID = 'youtube-download'

/** `trusted` everywhere below: the signing certificates of helpers this add-on trusts, from the
 * installed manifest (`helpers.android.certSha256`, `androidHelperCerts` in shared-types) - never
 * from code, so an add-on from its own repository brings its own list (docs/32 §8). */

export type YoutubeRoute = 'server' | 'device' | 'none'

/**
 * Where a search or download runs: the host when it can, else this device's helper. Nowhere only
 * when the host says it can't - a host that doesn't say (`null`: built before 2026-11-07, or not
 * reachable) is asked as before, and answers itself what is missing.
 */
export function youtubeRoute(host: HostCapabilities | null, helper: HelperInfo | null, trusted: readonly string[]): YoutubeRoute {
  if (host?.plugins.some((p) => p.id === YOUTUBE_ADDON_ID && p.available)) return 'server'
  if (trustedHelper(helper, trusted)) return 'device'
  return host ? 'none' : 'server'
}

/** Search through this device's helper - the same hits as the host's yt-dlp search (#618). */
export async function searchOnDevice(helper: HelperInfo, query: string, trusted: readonly string[]): Promise<YoutubeSearchResult[]> {
  if (!trustedHelper(helper, trusted)) throw new HelperError('helper.untrusted', 'untrusted helper')
  const { result } = await runHelper<{ results: unknown[] }>(YOUTUBE_ADDON_ID, helper, 'search', { query })
  return (result.results ?? []).flatMap((r) => {
    const parsed = YoutubeSearchResultSchema.safeParse(r)
    return parsed.success ? [parsed.data] : []
  })
}

/** What the helper says about the file it wrote. */
interface DownloadResult {
  itag: number
  codec: string
  container: string | null
  kbps: number
  bytes: number
  title: string
  durationSec: number
}

export interface DeviceJobDeps {
  putJob: (job: AsyncJob) => Promise<void>
  putTrack: (variantId: string, meta: TrackMeta, file: Blob) => Promise<void>
  /** Not too often - every write replicates to the band. */
  now?: () => number
}

/** The job's runner field for this device (asyncJob.ts): the Stage-Server leaves it alone. */
export function deviceRunner(deviceId: string): string {
  return `device:${deviceId}`
}

const PROGRESS_WRITE_MS = 1000

/** Jobs this device runs right now (this app session) - the rest of its `running` ones are leftovers. */
export const activeDeviceJobs = new Set<string>()

/**
 * Runs a YouTube job on this device: download through the helper, re-wrap Opus into Ogg (lossless),
 * upload as a normal track (`putTrack`: to whichever host the band has), report on the job document
 * the whole band sees - exactly as the Stage-Server's watcher does.
 */
export async function runOnDevice(job: YoutubeExtractJob, deviceId: string, helper: HelperInfo, trusted: readonly string[], deps: DeviceJobDeps, signal?: AbortSignal): Promise<void> {
  const now = deps.now ?? Date.now
  const runner = deviceRunner(deviceId)
  activeDeviceJobs.add(job.id)
  let current: YoutubeExtractJob = { ...job, status: 'running', progress: 0, runner, updatedAt: now() }
  // Writes in order, so a late progress write never lands after the result.
  let writes = deps.putJob(current)
  const write = (patch: Partial<YoutubeExtractJob>) => {
    current = { ...current, ...patch, updatedAt: now() }
    const snapshot = current
    writes = writes.then(() => deps.putJob(snapshot)).catch(() => {})
    return writes
  }
  try {
    if (!trustedHelper(helper, trusted)) throw new HelperError('helper.untrusted', 'untrusted helper')
    let lastWrite = 0
    const { result, file } = await runHelper<DownloadResult>(YOUTUBE_ADDON_ID, helper, 'download', { url: job.url }, {
      output: true,
      signal,
      onProgress: (value) => {
        if (now() - lastWrite < PROGRESS_WRITE_MS) return
        lastWrite = now()
        // The download is most of the work; re-wrapping and uploading the last few percent.
        void write({ progress: Math.min(0.95, value * 0.95) })
      },
    })
    if (!file) throw new HelperError('youtube.failed', 'no file')
    const ogg = result.codec === 'opus' ? webmOpusToOgg(new Uint8Array(await file.arrayBuffer())) : null
    // The helper takes Opus whenever YouTube has it (practically always); the rest needs the
    // Opus encoder (#730), not built into this path yet.
    if (!ogg) throw new HelperError('youtube.noOpus', `${result.codec} (itag ${result.itag})`)
    const track = new Blob([ogg], { type: 'audio/ogg' })
    const meta: TrackMeta = {
      id: randomId(),
      kind: 'reference',
      label: job.label,
      source: 'youtube-extract',
      parentTrackId: null,
      mimeType: 'audio/ogg',
      addedAt: now(),
      sizeBytes: track.size,
      ...(result.durationSec > 0 ? { durationMs: Math.round(result.durationSec * 1000) } : {}),
    }
    await deps.putTrack(job.variantId, meta, track)
    await write({ status: 'done', progress: 1, trackId: meta.id })
  } catch (err) {
    const code = err instanceof HelperError ? err.code : 'youtube.failed'
    const message = err instanceof Error ? err.message : String(err)
    // The same ceiling as the host's (core-backend maxExtractBytes), for the shared message.
    const params = code === 'youtube.tooLarge' ? { errorParams: { mb: 200 } } : {}
    await write({ status: 'error', error: message || code, errorCode: code, ...params })
  } finally {
    activeDeviceJobs.delete(job.id)
  }
}

/**
 * Jobs this device was running when the app stopped (killed, crashed): nothing will finish them -
 * marked failed, as the Stage-Server does with its own after a restart. `active`: ids running now.
 */
export function leftoverDeviceJobs(jobs: readonly AsyncJob[], deviceId: string, active: ReadonlySet<string>): AsyncJob[] {
  const runner = deviceRunner(deviceId)
  return jobs.filter((j) => j.runner === runner && j.status === 'running' && !active.has(j.id))
}

/** A new YouTube job for this device to run - created as running, so no Stage-Server picks it up. */
export function newDeviceJob(variantId: string, url: string, label: string, deviceId: string, now: number = Date.now()): YoutubeExtractJob {
  return { id: randomId(), type: 'youtube-extract', status: 'running', progress: 0, createdAt: now, updatedAt: now, variantId, url, label, runner: deviceRunner(deviceId) }
}
