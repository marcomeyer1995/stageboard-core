import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StemSeparationJob, TrackMeta } from 'shared-types'
import { runStemSeparation, type StemJobContext } from 'sync-host'
import { createStemAddonSeparate } from './stemAddon.js'

let dir: string
let previous: string | undefined

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-stem-addon-'))
  // A stand-in for the stems python (STEMS_PYTHON): <this> <script> <input> <outDir> <model> [--split-guitar]. It checks that it was handed the audio
  // (the file `input` has the size of what the add-on was given) and writes one file per stem, then the RESULT line.
  const fake = join(dir, 'fake-stems.sh')
  writeFileSync(fake, `#!/bin/bash
IN="$2"; OUT="$3"; MODEL="$4"
SIZE=$(stat -c %s "$IN")
[ "$SIZE" = "4096" ] || { echo "wrong input size $SIZE" >&2; exit 3; }
echo "PROGRESS 0.3"
for k in drums bass vocals other; do head -c 100 /dev/urandom > "$OUT/$k.opus"; done
[ "$MODEL" = "extended" ] && head -c 100 /dev/urandom > "$OUT/piano.webm"
if [ "$MODEL" = "extended" ]; then echo '{"stems":[{"key":"drums","file":"drums.opus"},{"key":"piano","file":"piano.webm"}]}' | sed 's/^/RESULT /'; else echo 'RESULT {"stems":[{"key":"drums","file":"drums.opus"},{"key":"bass","file":"bass.opus"},{"key":"vocals","file":"vocals.opus"},{"key":"other","file":"other.opus"}]}'; fi
`)
  chmodSync(fake, 0o755)
  previous = process.env.STEMS_PYTHON
  process.env.STEMS_PYTHON = fake
})
afterAll(() => {
  if (previous === undefined) delete process.env.STEMS_PYTHON
  else process.env.STEMS_PYTHON = previous
  rmSync(dir, { recursive: true, force: true })
})

describe('the stem-separation add-on in the sandbox (#964)', () => {
  it('separates through the sandboxed add-on and its declared helper: the audio goes in, one file per stem comes back, with progress', async () => {
    const separate = createStemAddonSeparate()
    const progress: number[] = []
    const { stems } = await separate(new Uint8Array(4096), { model: 'standard', splitGuitar: false }, (f) => progress.push(f))
    expect(stems.map((s) => s.key)).toEqual(['drums', 'bass', 'vocals', 'other'])
    expect(stems.every((s) => s.opus && s.data.length === 100)).toBe(true)
    expect(progress).toContain(0.3)
  })

  it('passes the model on, and says which stems are WebM instead of Ogg Opus', async () => {
    const { stems } = await createStemAddonSeparate()(new Uint8Array(4096), { model: 'extended', splitGuitar: true }, () => {})
    expect(stems.map((s) => ({ key: s.key, opus: s.opus }))).toEqual([{ key: 'drums', opus: true }, { key: 'piano', opus: false }])
  })

  it('a helper that fails is an error with what it said - the add-on reports it, the sandbox does not hang', async () => {
    await expect(createStemAddonSeparate()(new Uint8Array(10), { model: 'standard', splitGuitar: false }, () => {})).rejects.toThrow(/wrong input size 10/)
  })

  it('is the `separate` of the shared recipe: a whole job runs through the sandbox, replaces the older stems, and ends done', async () => {
    const attached: TrackMeta[] = []
    const patches: unknown[] = []
    const ctx: StemJobContext = {
      log: { info: vi.fn(), error: vi.fn() },
      patchJob: async (p) => void patches.push(p),
      isSafeId: () => true,
      bandHasStemPlugin: async () => true,
      readVariant: async () => ({ tracks: [{ id: 'src', kind: 'band-mix', durationMs: 90_000 }] }),
      readAudio: async () => new Uint8Array(4096),
      separate: createStemAddonSeparate(),
      writeAudio: async () => undefined,
      deleteAudio: async () => undefined,
      replaceStems: async (_v, _s, stems) => (attached.push(...stems), []),
      newId: (() => { let n = 0; return () => `stem-${++n}` })(),
      now: () => Date.now(),
    }
    const job: StemSeparationJob = { id: 'j', type: 'stem-separation', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', sourceTrackId: 'src', model: 'standard', splitGuitar: false }
    await runStemSeparation(job, ctx)
    expect(patches.at(-1)).toEqual({ status: 'done', progress: 1, stemTrackIds: ['stem-1', 'stem-2', 'stem-3', 'stem-4'] })
    expect(attached.map((t) => ({ label: t.label, role: t.role, mimeType: t.mimeType, sizeBytes: t.sizeBytes, durationMs: t.durationMs }))).toEqual([
      { label: 'Schlagzeug', role: 'drums', mimeType: 'audio/ogg', sizeBytes: 100, durationMs: 90_000 },
      { label: 'Bass', role: 'bass', mimeType: 'audio/ogg', sizeBytes: 100, durationMs: 90_000 },
      { label: 'Gesang', role: 'vocals', mimeType: 'audio/ogg', sizeBytes: 100, durationMs: 90_000 },
      { label: 'Rest', role: 'other', mimeType: 'audio/ogg', sizeBytes: 100, durationMs: 90_000 },
    ])
  })

  it('the add-on is not given a way to start the stems program itself: only the helper it declared, with its own name', async () => {
    const { helperRunnerFor } = await import('./helpers.js')
    await expect(helperRunnerFor(['stems'])('yt-dlp', [], () => {}, [])).rejects.toThrow('No helper "yt-dlp"')
    await expect(helperRunnerFor(['stems'])('rm', ['-rf', '/'], () => {}, [])).rejects.toThrow('No helper "rm"')
  })
})
