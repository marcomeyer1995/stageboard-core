/**
 * Server-local command: converts the existing track library once to the track format - Ogg Opus,
 * 48 kHz, 160 kbit/s (docs/30 §8h; Marco, 2026-11-13: "einmal am Server", the original kept as an
 * archive on the Stage-Server only, YouTube's Opus re-encoded too). Runs on the Stage-Server
 * itself with the service's own CouchDB login and never prints a credential.
 *
 *   npm run tracks:convert -w core-backend                 # dry run: convert into a temp dir, check, report
 *   npm run tracks:convert -w core-backend -- --apply      # replace the files, archive the originals
 *
 * Options: --python <path> (PyAV, default the stems venv), --encoder <path> (native/engine's
 * opus_encode), --only <variantId>:<trackId>.
 *
 * Each track: tools/convert-tracks/convert_one.py decodes it with ffmpeg (sample-identical to
 * the browsers' decodeAudioData), encodes it and checks length, position and sound - a track
 * that fails any check stays as it is. With --apply the original is copied to the archive first,
 * the Opus file then replaces the stored one (renamed in place), and only then does the track's
 * metadata change: mimeType, size, length, `archive` and a new `fileRev` - the devices fetch it
 * again (audioCache.ts). A run that stopped in between picks up where it was: a stored file
 * that is Opus already with its original in the archive only gets its metadata.
 */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { CouchConfig, CouchDoc } from '../couch.js'
import { serverCouchConfig } from './serviceEnv.js'

const run = promisify(execFile)

export const OPUS_MIME = 'audio/ogg; codecs=opus'

export interface TrackRef {
  db: string
  docId: string
  variantId: string
  trackId: string
  label: string
  mimeType: string
  fileRev?: number
  archived: boolean
}

interface TrackFields {
  id: string
  label?: string
  mimeType: string
  sizeBytes?: number
  durationMs?: number
  fileRev?: number
  archive?: { mimeType: string; sizeBytes: number }
}

interface VariantDoc extends CouchDoc {
  tracks?: TrackFields[]
}

/** What convert_one.py reports. */
export interface ConvertResult {
  ok: boolean
  error?: string
  codec?: string
  sizeBytes?: number
  durationMs?: number
  lagMax?: number
  bandDb?: number
}

export type Step = { kind: 'convert'; ref: TrackRef } | { kind: 'metadata-only'; ref: TrackRef } | { kind: 'done'; ref: TrackRef } | { kind: 'no-file'; ref: TrackRef }

/** Every track of every song variant in the given databases' docs. */
export function tracksOf(db: string, docs: VariantDoc[]): TrackRef[] {
  const refs: TrackRef[] = []
  for (const doc of docs) {
    const variantId = doc._id.slice('song-variants:'.length)
    for (const track of doc.tracks ?? []) {
      refs.push({
        db,
        docId: doc._id,
        variantId,
        trackId: track.id,
        label: track.label ?? track.id,
        mimeType: track.mimeType,
        ...(track.fileRev !== undefined ? { fileRev: track.fileRev } : {}),
        archived: track.archive !== undefined,
      })
    }
  }
  return refs
}

/** Pure decision per track: what the stored file and the archive say is left to do. */
export function planStep(ref: TrackRef, stored: { exists: boolean; isOpus: boolean }, archiveExists: boolean): Step {
  if (!stored.exists) return { kind: 'no-file', ref }
  if (ref.archived && ref.mimeType === OPUS_MIME) return { kind: 'done', ref }
  // A run stopped after replacing the file: the original is in the archive, only the metadata is missing.
  if (stored.isOpus && archiveExists) return { kind: 'metadata-only', ref }
  return { kind: 'convert', ref }
}

/** The track's new metadata after conversion. */
export function convertedTrack(track: TrackFields, result: { sizeBytes: number; durationMs: number }, original: { mimeType: string; sizeBytes: number }): TrackFields {
  return {
    ...track,
    mimeType: OPUS_MIME,
    sizeBytes: result.sizeBytes,
    durationMs: result.durationMs,
    fileRev: (track.fileRev ?? 0) + 1,
    archive: original,
  }
}

/** Ogg with an OpusHead in its first page. */
export function isOggOpus(head: Buffer): boolean {
  return head.length >= 36 && head.subarray(0, 4).toString('latin1') === 'OggS' && head.subarray(28, 36).toString('latin1') === 'OpusHead'
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function readHead(path: string): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const buf = Buffer.alloc(64)
    const { bytesRead } = await file.read(buf, 0, 64, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
  const python = option(args, 'python') ?? join(homedir(), 'stageboard-data/stems/venv/bin/python')
  const encoder = option(args, 'encoder') ?? join(repo, 'native/engine/build/opus_encode')
  const script = join(repo, 'tools/convert-tracks/convert_one.py')
  const only = option(args, 'only')
  for (const [what, path] of [['python', python], ['encoder', encoder], ['script', script]] as const) {
    if (!(await exists(path))) throw new Error(`${what} not found: ${path}`)
  }

  const couch: CouchConfig = serverCouchConfig()
  // Imported after the environment is set, like the server itself.
  const { allDocs, listDbs, putDocWithRetry } = await import('../couch.js')
  const audioDir = process.env.AUDIO_STORAGE_DIR ?? './data/audio'
  const archiveDir = process.env.AUDIO_ARCHIVE_DIR ?? join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'audio-archive')
  const work = join(tmpdir(), `sb-convert-${process.pid}`)
  await mkdir(work, { recursive: true })

  const refs: TrackRef[] = []
  for (const db of (await listDbs(couch)).filter((name) => name.startsWith('stageboard-'))) {
    refs.push(...tracksOf(db, await allDocs<VariantDoc>(couch, db, { startkey: 'song-variants:', endkey: 'song-variants:￰' })))
  }
  const wanted = only ? refs.filter((r) => `${r.variantId}:${r.trackId}` === only) : refs
  console.log(`${wanted.length} tracks${apply ? '' : ' - dry run, nothing is changed (--apply to convert)'}`)

  const counts: Record<string, number> = {}
  for (const ref of wanted) {
    const stored = join(audioDir, ref.variantId, ref.trackId)
    const archived = join(archiveDir, ref.variantId, ref.trackId)
    const storedExists = await exists(stored)
    const step = planStep(ref, { exists: storedExists, isOpus: storedExists && isOggOpus(await readHead(stored)) }, await exists(archived))
    const name = `${ref.label} (${ref.variantId}:${ref.trackId})`
    if (step.kind === 'no-file' || step.kind === 'done') {
      counts[step.kind] = (counts[step.kind] ?? 0) + 1
      console.log(`${step.kind === 'done' ? 'already Opus' : 'no file'}  ${name}`)
      continue
    }

    let result: ConvertResult
    const out = join(work, `${ref.variantId}_${ref.trackId}.opus`)
    if (step.kind === 'metadata-only') {
      const size = (await stat(stored)).size
      const { stdout } = await run(python, ['-I', '-c', 'import av,sys; c=av.open(sys.argv[1]); s=c.streams.audio[0]; print(round(float(s.duration*s.time_base)*1000) if s.duration else 0)', stored])
      result = { ok: true, sizeBytes: size, durationMs: Number(stdout.trim()) }
    } else {
      try {
        const { stdout } = await run(python, ['-I', script, stored, out, encoder], { maxBuffer: 1 << 20 })
        result = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as ConvertResult
      } catch (error) {
        result = { ok: false, error: String((error as Error).message ?? error) }
      }
    }
    if (!result.ok || result.sizeBytes === undefined || result.durationMs === undefined) {
      counts.failed = (counts.failed ?? 0) + 1
      console.log(`FAILED  ${name}: ${result.error ?? 'no result'} - left as it is`)
      await rm(out, { force: true })
      continue
    }
    const detail = step.kind === 'convert' ? `${result.codec} → Opus, ${(result.sizeBytes / 1e6).toFixed(1)} MB, offset ≤ ${result.lagMax} samples, bands ${result.bandDb} dB` : 'metadata only'
    if (!apply) {
      counts.ok = (counts.ok ?? 0) + 1
      console.log(`ok  ${name}: ${detail}`)
      await rm(out, { force: true })
      continue
    }

    const originalSize = step.kind === 'convert' ? (await stat(stored)).size : (await stat(archived)).size
    if (step.kind === 'convert') {
      // The original first: copied whole into the archive, then the Opus file renamed over the stored one.
      await mkdir(dirname(archived), { recursive: true })
      if (!(await exists(archived))) await copyFile(stored, archived)
      const staged = `${stored}.opus-new`
      await copyFile(out, staged)
      await rename(staged, stored)
      await rm(out, { force: true })
    }
    await putDocWithRetry<VariantDoc>(couch, ref.db, ref.docId, (existing) => {
      if (!existing) throw new Error(`${ref.docId} is gone`)
      return {
        ...existing,
        tracks: (existing.tracks ?? []).map((t) =>
          t.id === ref.trackId ? convertedTrack(t, { sizeBytes: result.sizeBytes!, durationMs: result.durationMs! }, { mimeType: t.archive?.mimeType ?? t.mimeType, sizeBytes: t.archive?.sizeBytes ?? originalSize }) : t,
        ),
      }
    })
    counts.converted = (counts.converted ?? 0) + 1
    console.log(`converted  ${name}: ${detail}`)
  }
  await rm(work, { recursive: true, force: true })
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  if (apply) console.log(`Originals: ${archiveDir}`)
  if (counts.failed) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

