import { ServerMessageError, type StemRole, type StemSeparationJob, type TrackMeta } from 'shared-types'
import { createProgressWriter } from './progress.js'
import { errorPatch, type JobPatch } from './trackFormat.js'

/**
 * The recipe of a stem-separation background job, once (#964, step 3b): check the ids and the plugin, find the source track, hand its audio
 * to the separation tool, store every stem as a track attached with `kind: 'stem'` and `parentTrackId` - replacing the stems of an earlier
 * separation of that track - and report. As with the YouTube recipe, everything it touches is a port; the platform's own part is
 * `separate` (Demucs on a Node machine). Whether a device is *able* to run Demucs is not this file's business: it is the runner's `missing()`
 * and the device's power (`GET /host/capabilities`) that decide whether the job is ever handed to it - a slow tablet that is allowed to try
 * runs the same steps.
 */

/** What a stem is called in the song editor - renamable there ("Gitarre Marco"). */
export const STEM_LABELS: Record<string, string> = {
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
export const STEM_ROLES: Record<string, StemRole> = {
  drums: 'drums',
  bass: 'bass',
  vocals: 'vocals',
  other: 'other',
  guitar: 'guitar',
  'guitar-left': 'guitar',
  'guitar-right': 'guitar',
  piano: 'keys',
}

/** One stem the tool produced: its key (`drums`, `guitar-left`, ...), the file's bytes, and whether it is Ogg Opus (else WebM, as a script before 2026-11-10 wrote). */
export interface SeparatedStem {
  key: string
  data: Uint8Array
  opus: boolean
}

export interface StemJobContext {
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
  patchJob(patch: JobPatch): Promise<void>
  isSafeId(id: string): boolean
  /** The band has the stem-separation plugin installed and enabled (Marco, 2026-10-15). */
  bandHasStemPlugin(): Promise<boolean>
  /** The song variant's raw document, or null when it is gone. */
  readVariant(variantId: string): Promise<Record<string, unknown> | null>
  readAudio(variantId: string, trackId: string): Promise<Uint8Array | null>
  /** The platform's own part: separate `audio` into stems; `onProgress` gets 0-1. `dispose` removes whatever it left (a temp folder). */
  separate(audio: Uint8Array, options: { model: StemSeparationJob['model']; splitGuitar: boolean }, onProgress: (fraction: number) => void): Promise<{ stems: SeparatedStem[]; dispose?: () => Promise<void> }>
  writeAudio(variantId: string, trackId: string, data: Uint8Array): Promise<void>
  deleteAudio(variantId: string, trackId: string): Promise<void>
  /** Puts `stems` in the variant's raw `tracks` in place of the earlier stems of `sourceTrackId`; returns the replaced stems' ids (their files go after). */
  replaceStems(variantId: string, sourceTrackId: string, stems: TrackMeta[]): Promise<string[]>
  newId(): string
  now(): number
  progressIntervalMs?: number
}

/** Runs the job. Never throws: every outcome is written into the job's document - `done`, or `error` with its message and code. */
export async function runStemSeparation(job: StemSeparationJob, ctx: StemJobContext): Promise<void> {
  const { log } = ctx
  log.info('Starting stem separation', { jobId: job.id, variantId: job.variantId, sourceTrackId: job.sourceTrackId, model: job.model, splitGuitar: job.splitGuitar })
  let dispose: (() => Promise<void>) | undefined
  const written: string[] = []
  const progress = createProgressWriter({ patch: ctx.patchJob, intervalMs: ctx.progressIntervalMs ?? 1_500, now: () => ctx.now(), onError: (err) => log.error('Failed to write job progress', { jobId: job.id, error: String(err) }) })
  try {
    if (!ctx.isSafeId(job.variantId) || !ctx.isSafeId(job.sourceTrackId)) throw new ServerMessageError('job.invalidIds')
    if (!(await ctx.bandHasStemPlugin())) throw new ServerMessageError('job.stemPluginMissing')
    await ctx.patchJob({ status: 'running', progress: 0 })
    const variant = await ctx.readVariant(job.variantId)
    if (!variant) throw new ServerMessageError('job.variantGone')
    const source = ((Array.isArray(variant.tracks) ? variant.tracks : []) as Record<string, unknown>[]).find((t) => t.id === job.sourceTrackId)
    if (!source) throw new ServerMessageError('job.trackGone')
    const audio = await ctx.readAudio(job.variantId, job.sourceTrackId)
    if (!audio) throw new ServerMessageError('job.audioMissing')

    const separated = await ctx.separate(audio, { model: job.model, splitGuitar: job.splitGuitar }, (fraction) => progress.report(fraction))
    dispose = separated.dispose
    await progress.settled()

    const stems: TrackMeta[] = []
    for (const file of separated.stems) {
      const id = ctx.newId()
      await ctx.writeAudio(job.variantId, id, file.data)
      written.push(id)
      stems.push({
        id,
        kind: 'stem',
        label: STEM_LABELS[file.key] ?? file.key,
        source: 'stem-separation',
        parentTrackId: job.sourceTrackId,
        ...(STEM_ROLES[file.key] ? { role: STEM_ROLES[file.key] } : {}),
        // Ogg Opus, the track format (stem_separate.py); WebM from a script before 2026-11-10.
        mimeType: file.opus ? 'audio/ogg' : 'audio/webm',
        addedAt: ctx.now(),
        sizeBytes: file.data.length,
        ...(typeof source.durationMs === 'number' ? { durationMs: source.durationMs } : {}),
      })
    }
    const replaced = await ctx.replaceStems(job.variantId, job.sourceTrackId, stems)
    for (const old of replaced) await ctx.deleteAudio(job.variantId, old).catch(() => {})
    await ctx.patchJob({ status: 'done', progress: 1, stemTrackIds: stems.map((s) => s.id) })
    log.info('Stem separation finished', { jobId: job.id, stems: stems.length, replaced: replaced.length })
  } catch (err) {
    log.error('Stem separation failed', { jobId: job.id, error: err instanceof Error ? err.message : String(err) })
    // Stems stored but never attached would be orphans no screen can reach.
    for (const id of written) await ctx.deleteAudio(job.variantId, id).catch(() => {})
    await progress.settled()
    await ctx.patchJob(errorPatch(err)).catch((patchErr) => log.error('Failed to mark async job as failed', { jobId: job.id, error: String(patchErr) }))
  } finally {
    await dispose?.().catch(() => {})
  }
}
