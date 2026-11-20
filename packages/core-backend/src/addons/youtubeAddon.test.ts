import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { oggOpusInfo, type YoutubeExtractJob } from 'shared-types'
import { runYoutubeExtract, type YoutubeJobContext } from 'sync-host'
import { createYoutubeAddonDownload } from './youtubeAddon.js'

const FIXTURE = new URL('../../../shared-types/src/__fixtures__/stereo.webm', import.meta.url).pathname
let dir: string
let previous: string | undefined

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-yt-addon-'))
  // A stand-in for yt-dlp that speaks its progress protocol and leaves a real WebM/Opus file where `-o` says.
  const fake = join(dir, 'fake-yt-dlp.sh')
  writeFileSync(fake, `#!/bin/bash\nwhile [ $# -gt 0 ]; do case "$1" in -o) OUT="$2"; shift 2;; *) shift;; esac; done\nDEST="\${OUT/\\%(ext)s/webm}"\necho "[download] Destination: $DEST"\necho "[download]  40.0% of 1MiB at 1MiB/s ETA 00:01"\ncp "${FIXTURE}" "$DEST"\necho "[download] 100% of 1MiB"\n`)
  chmodSync(fake, 0o755)
  previous = process.env.YT_DLP_PATH
  process.env.YT_DLP_PATH = fake
})
afterAll(() => {
  if (previous === undefined) delete process.env.YT_DLP_PATH
  else process.env.YT_DLP_PATH = previous
  rmSync(dir, { recursive: true, force: true })
})

describe('the YouTube add-on in the sandbox (#964)', () => {
  it('downloads through the sandboxed add-on and its declared helper: the real file comes back, with progress', async () => {
    const download = createYoutubeAddonDownload()
    const progress: number[] = []
    const { data, ext } = await download('https://www.youtube.com/watch?v=dQw4w9WgXcQ', (f) => progress.push(f))
    expect(ext).toBe('webm')
    expect(Buffer.from(data).equals(readFileSync(FIXTURE))).toBe(true)
    expect(progress).toContain(0.4)
  })

  it('two downloads in a row both work through the same sandboxed add-on', async () => {
    const download = createYoutubeAddonDownload()
    await download('https://www.youtube.com/watch?v=aaaaaaaaaaa', () => {})
    await download('https://www.youtube.com/watch?v=bbbbbbbbbbb', () => {})
  })

  it('a failing yt-dlp is an error with its own message - the add-on reports what the helper said', async () => {
    const failing = join(dir, 'failing.sh')
    writeFileSync(failing, '#!/bin/bash\necho "ERROR: Video unavailable" >&2\nexit 1\n')
    chmodSync(failing, 0o755)
    const was = process.env.YT_DLP_PATH
    process.env.YT_DLP_PATH = failing
    try {
      await expect(createYoutubeAddonDownload()('https://www.youtube.com/watch?v=dQw4w9WgXcQ', () => {})).rejects.toThrow(/Video unavailable/)
    } finally {
      process.env.YT_DLP_PATH = was
    }
  })

  it('is the download of the shared recipe: a whole job runs through the sandbox and ends with an Ogg Opus track', async () => {
    const written = new Map<string, Uint8Array>()
    const patches: unknown[] = []
    const tracks: { mimeType?: string }[] = []
    const ctx: YoutubeJobContext = {
      log: { info: vi.fn(), error: vi.fn() },
      patchJob: async (p) => void patches.push(p),
      bandHasAddon: async () => true,
      isSafeVariantId: () => true,
      variantExists: async () => true,
      download: createYoutubeAddonDownload(),
      writeAudio: async (v, t, d) => void written.set(`${v}/${t}`, d),
      deleteAudio: async () => undefined,
      appendTrack: async (_v, meta) => void tracks.push(meta),
      queueOpusConvert: async () => undefined,
      newId: () => 'track-1',
      now: () => Date.now(),
    }
    const job: YoutubeExtractJob = { id: 'j', type: 'youtube-extract', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v1', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', label: 'Intro' }
    await runYoutubeExtract(job, ctx)
    expect(patches.at(-1)).toEqual({ status: 'done', progress: 1, trackId: 'track-1' })
    expect(tracks[0]).toMatchObject({ mimeType: 'audio/ogg' })
    expect(oggOpusInfo(written.get('v1/track-1')!)).toEqual({ channels: 2, preSkip: 312, frames: 72000 })
  })

  it('a link that is no YouTube link never reaches the add-on or its helper - the recipe refuses it first', async () => {
    // The recipe refuses a link that is no YouTube link BEFORE any download: the sandboxed add-on never sees it.
    const download = vi.fn(async () => ({ data: new Uint8Array(), ext: '' }))
    const ctx: YoutubeJobContext = {
      log: { info: vi.fn(), error: vi.fn() }, patchJob: async () => undefined, bandHasAddon: async () => true, isSafeVariantId: () => true, variantExists: async () => true,
      download, writeAudio: async () => undefined, deleteAudio: async () => undefined, appendTrack: async () => undefined, queueOpusConvert: async () => undefined, newId: () => 'x', now: () => 0,
    }
    await runYoutubeExtract({ id: 'j', type: 'youtube-extract', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, variantId: 'v', url: 'https://evil.example/--exec=rm', label: 'x' }, ctx)
    expect(download).not.toHaveBeenCalled()
  })
})
