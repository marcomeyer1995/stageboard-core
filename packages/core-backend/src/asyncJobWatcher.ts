import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { AsyncJobSchema, messageFieldsOf, ServerMessageError, type AsyncJob, type OpusConvertJob, type StemRole, type StemSeparationJob, type TrackMeta, type YoutubeExtractJob } from 'shared-types'
import { allDocs, getDoc, putDocWithRetry, waitForChange, type DatabaseConfig, type DatabaseDoc } from './database.js'
import { workspaceDbName } from './workspaceProvisioning.js'
import { runYtDlpExtract } from './ytDlp.js'
import { deleteAudioFile, isSafeAudioId, readAudioFile, writeAudioFile } from './audioStore.js'
import { hostRunner, pickNextClaimable, runYoutubeExtract, stillMine, stuckJobsOfHost } from 'sync-host'
import { readInstallations } from './plugins/pluginSync.js'
import { STEM_SEPARATION_PLUGIN_ID } from './plugins/stemSeparationPlugin.js'
import { bandHasAddon, YOUTUBE_DOWNLOAD_PLUGIN_ID } from './plugins/importAddons.js'
import { runStemSeparation } from './stems/stemSeparation.js'

const CHANGES_TIMEOUT_MS = 30_000
const ASYNC_JOB_PREFIX = 'async-jobs:'
const SONG_VARIANT_PREFIX = 'song-variants:'

/** Progress writes are throttled to this often - a raw yt-dlp stdout feed reports several times
 * a second, and every one of those as its own the database PUT would be a needless write storm for
 * a number only the job's own creator is watching. */
const PROGRESS_WRITE_INTERVAL_MS = 1_500

/** What a stem is called in the song editor - renamable there ("Gitarre Marco"). */
const STEM_LABELS: Record<string, string> = {
  drums: 'Schlagzeug',
  bass: 'Bass',
  vocals: 'Gesang',
  other: 'Rest',
  guitar: 'Gitarre',
  'guitar-left': 'Gitarre links',
  'guitar-right': 'Gitarre rechts',
  piano: 'Keys/Piano',
}

/** The role each Demucs stem gets (docs/22 §2). */
const STEM_ROLES: Record<string, StemRole> = {
  drums: 'drums',
  bass: 'bass',
  vocals: 'vocals',
  other: 'other',
  guitar: 'guitar',
  'guitar-left': 'guitar',
  'guitar-right': 'guitar',
  piano: 'keys',
}

export interface AsyncJobWatcherOptions {
  database: DatabaseConfig
  workspaceId: string
  /** This host's id: the runner it writes into a job it takes (`host:<id>`, sync-host's queue rules, #964). */
  hostId?: string
  /** What a job needs from its host - from the host's runners (`JobRunners.needsOfJob`). Absent: sync-host's default table. */
  needsOf?: (job: Pick<AsyncJob, 'type'>) => string | null
  /** Whether this host can do what a job needs (`GET /host/capabilities`); a job it cannot do is left queued for a host that can. Absent: everything. */
  canDo?: (needs: string) => boolean
  /** Whether the band lists another host that might take the same job. Only then does a claim wait to be confirmed. */
  hasPeers?: () => Promise<boolean> | boolean
  /** How long a claim settles in replication before the host goes on (default 2 s). */
  settleMs?: number
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
 * the database to test (same split pluginSync.ts's `reconcile` makes). */
export function pickNextQueuedJob(jobs: readonly AsyncJob[]): AsyncJob | undefined {
  // The rules are sync-host's (#964): a job with a runner, and a conversion only devices can do (#822), are not this host's.
  return pickNextClaimable(jobs, { hostId: 'host' })
}

/** `running` jobs that don't belong to this watcher instance's current job - left behind by a
 * Host restart mid-download, since nothing else will ever move them out of `running`.
 * Pure for the same reason as `pickNextQueuedJob`. */
export function stuckRunningJobs(jobs: readonly AsyncJob[], currentJobId: string | null, hostId = 'host'): AsyncJob[] {
  return stuckJobsOfHost(jobs, hostId, currentJobId)
}

function jobDocId(id: string): string {
  return `${ASYNC_JOB_PREFIX}${id}`
}

/**
 * Picks up `AsyncJob` documents (#5) the same way `pluginSync.ts` picks up plugin installs -
 * watching the shared workspace db's `_changes` feed, no dedicated HTTP endpoint. Today's one
 * job type, `youtube-extract`, shells out to `yt-dlp` (network access + a local binary, so this
 * has to run on the Host, never a tablet) and lands the result exactly where an
 * uploaded track would: a file under `audioStore.ts` plus a `TrackMeta` appended to the owning
 * SongVariant's `tracks` - see `putTrack` (stage-pwa/songVariantsDb.ts) for the client-side
 * equivalent of that same read-modify-write this mirrors server-side.
 *
 * One job at a time per workspace, oldest first - simplicity over throughput; nothing about
 * practice-track extraction needs to be concurrent.
 */
export function createAsyncJobWatcher(options: AsyncJobWatcherOptions): AsyncJobWatcherHandle {
  const { database, workspaceId, log } = options
  const hostId = options.hostId ?? 'host'
  const settleMs = options.settleMs ?? 2_000
  const workspaceDb = workspaceDbName(workspaceId)
  let stopped = false
  let currentJobId: string | null = null

  /** What the server ever writes into a job - the fields every job type shares, plus its result. */
  type JobPatch = Partial<Pick<AsyncJob, 'status' | 'progress' | 'error' | 'errorCode' | 'errorParams' | 'runner'>> & { trackId?: string; stemTrackIds?: string[] }

  /** The `error` patch for a failure: the German text, plus its code when it has one (#679). */
  function errorPatch(err: unknown): JobPatch {
    const { message, messageCode, messageParams } = messageFieldsOf(err)
    return { status: 'error', error: message, ...(messageCode ? { errorCode: messageCode } : {}), ...(messageParams ? { errorParams: messageParams } : {}) }
  }

  async function patchJob(id: string, patch: JobPatch): Promise<void> {
    await putDocWithRetry<Record<string, unknown> & DatabaseDoc>(database, workspaceDb, jobDocId(id), (existing) => {
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
    await putDocWithRetry<Record<string, unknown> & DatabaseDoc>(database, workspaceDb, docId, (existing) => {
      if (!existing) throw new ServerMessageError('job.variantGone')
      const tracks: unknown[] = Array.isArray(existing.tracks) ? existing.tracks : []
      return { ...existing, tracks: [...tracks, meta] }
    })
  }

  /** A device converts the track to Ogg Opus (#822) - queued for whichever device takes it first. */
  async function queueOpusConvert(variantId: string, trackId: string, label: string): Promise<void> {
    const now = Date.now()
    const job: OpusConvertJob = { id: randomUUID(), type: 'opus-convert', status: 'queued', progress: 0, createdAt: now, updatedAt: now, variantId, trackId, label }
    await putDocWithRetry<Record<string, unknown> & DatabaseDoc>(database, workspaceDb, jobDocId(job.id), (existing) => ({ ...job, _id: jobDocId(job.id), _rev: existing?._rev }))
  }

  async function variantExists(variantId: string): Promise<boolean> {
    return (await getDoc<DatabaseDoc>(database, workspaceDb, `${SONG_VARIANT_PREFIX}${variantId}`)) !== null
  }

  /** The change event for a job's own final write can arrive while currentJobId is still set
   * (syncOnce then returns early), so each finished job picks up the next queued one itself. */
  async function pickUpNext(): Promise<void> {
    if (!stopped) await syncOnce().catch((err) => log.error('Async job sync failed', { error: String(err) }))
  }

  async function processJob(job: AsyncJob): Promise<void> {
    if (job.type === 'stem-separation') return processStemJob(job)
    if (job.type === 'opus-convert') return // a device's (pickNextQueuedJob never hands one out)
    return processYoutubeJob(job)
  }

  /** Throttled, chained progress writes - awaited before a job's final write, so a late one can
   * never flip a finished job back to `running`. */
  function progressWriter(jobId: string) {
    let writes = Promise.resolve()
    let lastWriteAt = 0
    return {
      report(progress: number) {
        const now = Date.now()
        if (now - lastWriteAt < PROGRESS_WRITE_INTERVAL_MS) return
        lastWriteAt = now
        writes = writes.then(() => patchJob(jobId, { status: 'running', progress }).catch((err) => log.error('Failed to write job progress', { jobId, error: String(err) })))
      },
      settled: () => writes,
    }
  }

  async function failJob(job: AsyncJob, err: unknown): Promise<void> {
    await patchJob(job.id, errorPatch(err)).catch((err) => log.error('Failed to mark async job as failed', { jobId: job.id, error: String(err) }))
  }

  async function stemPluginInstalled(): Promise<boolean> {
    const installations = readInstallations(await allDocs<unknown>(database, workspaceDb, { startkey: 'plugins:', endkey: 'plugins:￰' }))
    return installations.some((i) => i.id === STEM_SEPARATION_PLUGIN_ID && i.enabled)
  }

  /** The variant's tracks with `stems` in place of the earlier stems of `sourceTrackId` - raw
   * array, as in `appendTrack`. Returns the replaced stems' ids (their files go after). */
  async function replaceStems(variantId: string, sourceTrackId: string, stems: TrackMeta[]): Promise<string[]> {
    let replaced: string[] = []
    await putDocWithRetry<Record<string, unknown> & DatabaseDoc>(database, workspaceDb, `${SONG_VARIANT_PREFIX}${variantId}`, (existing) => {
      if (!existing) throw new ServerMessageError('job.variantGone')
      const tracks = (Array.isArray(existing.tracks) ? existing.tracks : []) as Record<string, unknown>[]
      const isOldStem = (t: Record<string, unknown>) => t.kind === 'stem' && t.parentTrackId === sourceTrackId
      replaced = tracks.filter(isOldStem).map((t) => String(t.id))
      return { ...existing, tracks: [...tracks.filter((t) => !isOldStem(t)), ...stems] }
    })
    return replaced
  }

  /**
   * Stem separation (#9): the source track's audio through Demucs on this machine
   * (stems/stemSeparation.ts), each stem stored like an uploaded track and attached as
   * `kind: 'stem'` with `parentTrackId` - replacing the stems of an earlier separation of that
   * track. Only while the band has the stem-separation plugin installed (Marco, 2026-10-15).
   */
  async function processStemJob(job: StemSeparationJob): Promise<void> {
    currentJobId = job.id
    log.info('Starting stem separation', { jobId: job.id, variantId: job.variantId, sourceTrackId: job.sourceTrackId, model: job.model, splitGuitar: job.splitGuitar })
    let workDir: string | null = null
    const written: string[] = []
    const progress = progressWriter(job.id)
    try {
      if (!isSafeAudioId(job.variantId) || !isSafeAudioId(job.sourceTrackId)) throw new ServerMessageError('job.invalidIds')
      if (!(await stemPluginInstalled())) throw new ServerMessageError('job.stemPluginMissing')
      await patchJob(job.id, { status: 'running', progress: 0 })
      const variant = await getDoc<Record<string, unknown> & DatabaseDoc>(database, workspaceDb, `${SONG_VARIANT_PREFIX}${job.variantId}`)
      if (!variant) throw new ServerMessageError('job.variantGone')
      const source = ((Array.isArray(variant.tracks) ? variant.tracks : []) as Record<string, unknown>[]).find((t) => t.id === job.sourceTrackId)
      if (!source) throw new ServerMessageError('job.trackGone')
      const audio = await readAudioFile(job.variantId, job.sourceTrackId)
      if (!audio) throw new ServerMessageError('job.audioMissing')

      workDir = await mkdtemp(join(tmpdir(), 'stageboard-stems-'))
      const input = join(workDir, 'input')
      await writeFile(input, audio)
      const files = await runStemSeparation(input, workDir, { model: job.model, splitGuitar: job.splitGuitar }, (p) => progress.report(p))
      await progress.settled()

      const stems: TrackMeta[] = []
      for (const file of files) {
        const buffer = await readFile(file.path)
        const id = randomUUID()
        await writeAudioFile(job.variantId, id, buffer)
        written.push(id)
        stems.push({
          id,
          kind: 'stem',
          label: STEM_LABELS[file.key] ?? file.key,
          source: 'stem-separation',
          parentTrackId: job.sourceTrackId,
          ...(STEM_ROLES[file.key] ? { role: STEM_ROLES[file.key] } : {}),
          // Ogg Opus, the track format (stem_separate.py); WebM from a script before 2026-11-10.
          mimeType: file.path.endsWith('.opus') ? 'audio/ogg' : 'audio/webm',
          addedAt: Date.now(),
          sizeBytes: buffer.length,
          ...(typeof source.durationMs === 'number' ? { durationMs: source.durationMs } : {}),
        })
      }
      const replaced = await replaceStems(job.variantId, job.sourceTrackId, stems)
      for (const old of replaced) await deleteAudioFile(job.variantId, old).catch(() => {})
      await patchJob(job.id, { status: 'done', progress: 1, stemTrackIds: stems.map((s) => s.id) })
      log.info('Stem separation finished', { jobId: job.id, stems: stems.length, replaced: replaced.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Stem separation failed', { jobId: job.id, error: message })
      for (const id of written) await deleteAudioFile(job.variantId, id).catch(() => {})
      await progress.settled()
      await failJob(job, err)
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {})
      currentJobId = null
    }
    await pickUpNext()
  }

  /**
   * The YouTube job: the recipe is sync-host's (`runYoutubeExtract` - the order of the steps, the checks, the clean-up, the errors), run
   * here with this host's ports: the band's documents over the database client, the audio store on disk, and yt-dlp for the download.
   */
  async function processYoutubeJob(job: YoutubeExtractJob): Promise<void> {
    currentJobId = job.id
    try {
      await runYoutubeExtract(job, {
        log,
        patchJob: (patch) => patchJob(job.id, patch),
        bandHasAddon: () => bandHasAddon(database, workspaceId, YOUTUBE_DOWNLOAD_PLUGIN_ID),
        isSafeVariantId: isSafeAudioId,
        variantExists,
        download: async (url, onProgress) => {
          const workDir = await mkdtemp(join(tmpdir(), 'stageboard-yt-'))
          try {
            const { filePath } = await runYtDlpExtract(url, join(workDir, 'track.%(ext)s'), onProgress)
            return { data: await readFile(filePath), ext: extname(filePath).replace(/^\./, ''), dispose: () => rm(workDir, { recursive: true, force: true }) }
          } catch (err) {
            await rm(workDir, { recursive: true, force: true }).catch(() => {})
            throw err
          }
        },
        writeAudio: (variantId, trackId, data) => writeAudioFile(variantId, trackId, Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
        deleteAudio: deleteAudioFile,
        appendTrack,
        queueOpusConvert,
        newId: randomUUID,
        now: Date.now,
        progressIntervalMs: PROGRESS_WRITE_INTERVAL_MS,
      })
    } finally {
      currentJobId = null
    }
    await pickUpNext()
  }

  async function loadJobs(): Promise<AsyncJob[]> {
    return readAsyncJobs(
      await allDocs<unknown>(database, workspaceDb, { startkey: ASYNC_JOB_PREFIX, endkey: `${ASYNC_JOB_PREFIX}￰` }),
    )
  }

  async function syncOnce(): Promise<void> {
    if (currentJobId !== null) return // already processing one job; the next syncOnce (its own status writes trigger one) picks up whatever is queued after it
    // A job this host cannot do is left for another host only when the band lists one that might; the only host takes it and ends it
    // with its own message ("no demucs"), as before - the person must not wait for nothing.
    const peers = (await options.hasPeers?.()) ?? false
    const next = pickNextClaimable(await loadJobs(), { hostId, ...(options.needsOf ? { needsOf: options.needsOf } : {}), ...(peers && options.canDo ? { canDo: options.canDo } : {}) })
    // Re-checked after the await: a change-feed pass and the startup pass can overlap.
    if (next && currentJobId === null) void claimAndProcess(next, peers)
  }

  /**
   * Takes the job: writes this host as its runner, and - when the band lists another host that might do the same - waits for the
   * claim to settle in replication and goes on only if the job still names this host (sync-host's `stillMine`). Two hosts that claim
   * at once get the same winning revision, so exactly one of them goes on.
   */
  async function claimAndProcess(job: AsyncJob, peers: boolean): Promise<void> {
    currentJobId = job.id
    try {
      await patchJob(job.id, { status: 'running', progress: 0, runner: hostRunner(hostId) })
      if (peers) {
        await new Promise((resolve) => setTimeout(resolve, settleMs))
        const after = readAsyncJobs([await getDoc<DatabaseDoc>(database, workspaceDb, jobDocId(job.id))]).find((j) => j.id === job.id)
        if (!stillMine(after, hostId)) {
          log.info('Another host took the job', { jobId: job.id, runner: after?.runner })
          currentJobId = null
          return
        }
      }
    } catch (err) {
      log.error('Could not claim the async job', { jobId: job.id, error: String(err) })
      currentJobId = null
      return
    }
    await processJob(job)
  }

  /** Only at startup: within one process the only `running` job is the one this watcher itself
   * runs, so any other is left over from a previous process. Sweeping on every pass instead
   * raced with a job finishing between the `allDocs` read and the sweep, overwriting `done`
   * with `error`. */
  async function failJobsLeftRunning(): Promise<void> {
    for (const stuck of stuckJobsOfHost(await loadJobs(), hostId, currentJobId, options.needsOf)) {
      log.error('Async job was left running by a previous process - marking it failed', { jobId: stuck.id })
      await patchJob(stuck.id, errorPatch(new ServerMessageError('job.interrupted')))
    }
  }

  async function watchChanges(): Promise<void> {
    let since = 'now'
    while (!stopped) {
      try {
        const { lastSeq, changed } = await waitForChange(database, workspaceDb, since, CHANGES_TIMEOUT_MS)
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
