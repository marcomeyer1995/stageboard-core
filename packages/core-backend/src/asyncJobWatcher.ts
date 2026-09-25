import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { AsyncJobSchema, isYoutubeUrl, type AsyncJob, type TrackMeta } from 'shared-types'
import { allDocs, getDoc, putDocWithRetry, waitForChange, type CouchConfig, type CouchDoc } from './couch.js'
import { workspaceDbName } from './workspaceProvisioning.js'
import { mimeTypeForExt, runYtDlpExtract } from './ytDlp.js'
import { deleteAudioFile, isSafeAudioId, writeAudioFile } from './audioStore.js'

const CHANGES_TIMEOUT_MS = 30_000
const ASYNC_JOB_PREFIX = 'async-jobs:'
const SONG_VARIANT_PREFIX = 'song-variants:'

/** Progress writes are throttled to this often - a raw yt-dlp stdout feed reports several times
 * a second, and every one of those as its own CouchDB PUT would be a needless write storm for
 * a number only the job's own creator is watching. */
const PROGRESS_WRITE_INTERVAL_MS = 1_500

export interface AsyncJobWatcherOptions {
  couch: CouchConfig
  workspaceId: string
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
}

export interface AsyncJobWatcherHandle {
  stop: () => void
  /** Exposed for tests and for an immediate pass at startup, same shape as pluginSync.ts's. */
  syncOnce: () => Promise<void>
}

/** Only documents that parse are trusted - same "a half-replicated doc must not crash the
 * server" reasoning as pluginSync.ts's `readInstallations`. */
export function readAsyncJobs(docs: unknown[]): AsyncJob[] {
  const jobs: AsyncJob[] = []
  for (const doc of docs) {
    const parsed = AsyncJobSchema.safeParse(doc)
    if (parsed.success) jobs.push(parsed.data)
  }
  return jobs
}

/** The oldest still-`queued` job, or undefined when there is none - a plain FIFO, one job
 * processed at a time per workspace. Pure, so the interesting part of the sync needs no
 * CouchDB to test (same split pluginSync.ts's `reconcile` makes). */
export function pickNextQueuedJob(jobs: readonly AsyncJob[]): AsyncJob | undefined {
  return [...jobs].filter((job) => job.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0]
}

/** `running` jobs that don't belong to this watcher instance's current job - left behind by a
 * Stage-Server restart mid-download, since nothing else will ever move them out of `running`.
 * Pure for the same reason as `pickNextQueuedJob`. */
export function stuckRunningJobs(jobs: readonly AsyncJob[], currentJobId: string | null): AsyncJob[] {
  return jobs.filter((job) => job.status === 'running' && job.id !== currentJobId)
}

function jobDocId(id: string): string {
  return `${ASYNC_JOB_PREFIX}${id}`
}

/**
 * Picks up `AsyncJob` documents (#5) the same way `pluginSync.ts` picks up plugin installs -
 * watching the shared workspace db's `_changes` feed, no dedicated HTTP endpoint. Today's one
 * job type, `youtube-extract`, shells out to `yt-dlp` (network access + a local binary, so this
 * has to run on the Stage-Server, never a tablet) and lands the result exactly where an
 * uploaded track would: a file under `audioStore.ts` plus a `TrackMeta` appended to the owning
 * SongVariant's `tracks` - see `putTrack` (stage-pwa/songVariantsDb.ts) for the client-side
 * equivalent of that same read-modify-write this mirrors server-side.
 *
 * One job at a time per workspace, oldest first - simplicity over throughput; nothing about
 * practice-track extraction needs to be concurrent.
 */
export function createAsyncJobWatcher(options: AsyncJobWatcherOptions): AsyncJobWatcherHandle {
  const { couch, workspaceId, log } = options
  const workspaceDb = workspaceDbName(workspaceId)
  let stopped = false
  let currentJobId: string | null = null

  async function patchJob(id: string, patch: Partial<AsyncJob>): Promise<void> {
    await putDocWithRetry<AsyncJob & CouchDoc>(couch, workspaceDb, jobDocId(id), (existing) => {
      const base = existing ?? { id, type: 'youtube-extract', status: 'queued', progress: 0, createdAt: Date.now(), updatedAt: Date.now(), variantId: '', url: '', label: '' }
      return { ...base, ...patch, updatedAt: Date.now(), _id: jobDocId(id), _rev: existing?._rev }
    })
  }

  /** Appends to the variant's *raw* `tracks` array rather than a schema-parsed copy: a variant
   * that fails to parse for any unrelated reason must never have its existing tracks replaced
   * by just this one (StageBoard is in productive use - a lost backing track is real data
   * loss). A variant deleted mid-download throws instead of being recreated as a stub. */
  async function appendTrack(variantId: string, meta: TrackMeta): Promise<void> {
    const docId = `${SONG_VARIANT_PREFIX}${variantId}`
    await putDocWithRetry<Record<string, unknown> & CouchDoc>(couch, workspaceDb, docId, (existing) => {
      if (!existing) throw new Error('Die Song-Variante existiert nicht mehr.')
      const tracks: unknown[] = Array.isArray(existing.tracks) ? existing.tracks : []
      return { ...existing, tracks: [...tracks, meta] }
    })
  }

  async function variantExists(variantId: string): Promise<boolean> {
    return (await getDoc<CouchDoc>(couch, workspaceDb, `${SONG_VARIANT_PREFIX}${variantId}`)) !== null
  }

  /** The change event for a job's own final write can arrive while currentJobId is still set
   * (syncOnce then returns early), so each finished job picks up the next queued one itself. */
  async function pickUpNext(): Promise<void> {
    if (!stopped) await syncOnce().catch((err) => log.error('Async job sync failed', { error: String(err) }))
  }

  async function processJob(job: AsyncJob): Promise<void> {
    currentJobId = job.id
    log.info('Starting async job', { jobId: job.id, type: job.type, variantId: job.variantId })

    // Both checked server-side regardless of what the client already validated - a replicated
    // document is untrusted input. The URL guards the shell-out (shared-types' own doc comment
    // on isYoutubeUrl); the variant id becomes a path segment under the audio store, the same
    // check the upload route applies.
    const rejection = !isYoutubeUrl(job.url)
      ? 'Nur youtube.com/youtu.be-Links werden unterstützt.'
      : !isSafeAudioId(job.variantId)
        ? 'Ungültige Song-Varianten-ID.'
        : null
    if (rejection) {
      log.error('Rejected async job', { jobId: job.id, reason: rejection })
      await patchJob(job.id, { status: 'error', error: rejection }).catch((err) =>
        log.error('Failed to mark async job as failed', { jobId: job.id, error: String(err) }),
      )
      currentJobId = null
      await pickUpNext()
      return
    }

    let workDir: string | null = null
    let writtenTrackId: string | null = null
    // Progress writes are chained and awaited before the final done/error write, so a
    // throttled progress PUT still in flight (or retrying on a 409) can never land *after* it
    // and flip a finished job back to `running`.
    let progressWrites = Promise.resolve()
    try {
      await patchJob(job.id, { status: 'running', progress: 0 })
      if (!(await variantExists(job.variantId))) throw new Error('Die Song-Variante existiert nicht mehr.')
      workDir = await mkdtemp(join(tmpdir(), 'stageboard-yt-'))
      let lastWriteAt = 0
      const { filePath } = await runYtDlpExtract(job.url, join(workDir, 'track.%(ext)s'), (progress) => {
        const now = Date.now()
        if (now - lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return
        lastWriteAt = now
        progressWrites = progressWrites.then(() =>
          patchJob(job.id, { status: 'running', progress }).catch((err) => log.error('Failed to write job progress', { jobId: job.id, error: String(err) })),
        )
      })
      await progressWrites

      const buffer = await readFile(filePath)
      const ext = extname(filePath).replace(/^\./, '')
      const trackId = randomUUID()
      await writeAudioFile(job.variantId, trackId, buffer)
      writtenTrackId = trackId

      const meta: TrackMeta = {
        id: trackId,
        kind: 'reference',
        label: job.label,
        source: 'youtube-extract',
        parentTrackId: null,
        mimeType: mimeTypeForExt(ext),
        addedAt: Date.now(),
        sizeBytes: (await stat(filePath)).size,
      }
      await appendTrack(job.variantId, meta)
      await patchJob(job.id, { status: 'done', progress: 1, trackId })
      log.info('Async job finished', { jobId: job.id, trackId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Async job failed', { jobId: job.id, error: message })
      // Audio written but never attached to the variant would be an orphan no UI can reach.
      if (writtenTrackId) await deleteAudioFile(job.variantId, writtenTrackId).catch(() => {})
      await progressWrites
      await patchJob(job.id, { status: 'error', error: message }).catch((patchErr) =>
        log.error('Failed to mark async job as failed', { jobId: job.id, error: String(patchErr) }),
      )
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {})
      currentJobId = null
    }
    await pickUpNext()
  }

  async function loadJobs(): Promise<AsyncJob[]> {
    return readAsyncJobs(
      await allDocs<unknown>(couch, workspaceDb, { startkey: ASYNC_JOB_PREFIX, endkey: `${ASYNC_JOB_PREFIX}￰` }),
    )
  }

  async function syncOnce(): Promise<void> {
    if (currentJobId !== null) return // already processing one job; the next syncOnce (its own status writes trigger one) picks up whatever is queued after it
    const next = pickNextQueuedJob(await loadJobs())
    // Re-checked after the await: a change-feed pass and the startup pass can overlap.
    if (next && currentJobId === null) void processJob(next)
  }

  /** Only at startup: within one process the only `running` job is the one this watcher itself
   * runs, so any other is left over from a previous process. Sweeping on every pass instead
   * raced with a job finishing between the `allDocs` read and the sweep, overwriting `done`
   * with `error`. */
  async function failJobsLeftRunning(): Promise<void> {
    for (const stuck of stuckRunningJobs(await loadJobs(), currentJobId)) {
      log.error('Async job was left running by a previous process - marking it failed', { jobId: stuck.id })
      await patchJob(stuck.id, { status: 'error', error: 'Durch einen Neustart des Stage-Servers unterbrochen.' })
    }
  }

  async function watchChanges(): Promise<void> {
    let since = 'now'
    while (!stopped) {
      try {
        const { lastSeq, changed } = await waitForChange(couch, workspaceDb, since, CHANGES_TIMEOUT_MS)
        since = lastSeq
        if (changed && !stopped) await syncOnce()
      } catch (err) {
        log.error('Async-job changes feed failed, retrying', { error: String(err) })
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    }
  }

  async function start(): Promise<void> {
    await failJobsLeftRunning()
    await syncOnce()
    void watchChanges()
  }

  start().catch((err) => log.error('Async job watcher failed to start', { error: String(err) }))

  return {
    stop: () => {
      stopped = true
    },
    syncOnce,
  }
}
