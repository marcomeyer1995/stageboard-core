import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAddonMethods } from './addonMethods.js'

const FIXTURE = new URL('../../../shared-types/src/__fixtures__/stereo.webm', import.meta.url).pathname
let dir: string
let previous: string | undefined
const call = (method: string, body: unknown, onProgress?: (f: number) => void) => methods.call('youtube-download', method, body, onProgress ? { onProgress } : {})
const methods = createAddonMethods()

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-yt-methods-'))
  // A stand-in for yt-dlp: a search (`-J`) prints the playlist JSON, a download writes a real WebM/Opus file where `-o` says and reports progress;
  // the link decides what happens (`toolarge`, `slow`). Every call is logged so a test can see what the add-on really asked for.
  const fake = join(dir, 'fake-yt-dlp.sh')
  writeFileSync(fake, `#!/bin/bash
echo "$*" >> "${dir}/calls.log"
if [[ "$*" == *" -J "* ]] || [[ "$*" == *"-J "* ]]; then
  echo '{"entries":[{"id":"dQw4w9WgXcQ","title":"Never Gonna","channel":"Rick","duration":212.4},{"id":"bad id","title":"skipped"},{"id":"aaaaaaaaaaa","title":"Second","uploader":"Up"}]}'
  exit 0
fi
while [ $# -gt 0 ]; do case "$1" in -o) OUT="$2"; shift 2;; *) LAST="$1"; shift;; esac; done
if [[ "$LAST" == *toolarge* ]]; then echo "[download] File is larger than max-filesize (999 bytes). Aborting."; exit 1; fi
DEST="\${OUT/\\%(ext)s/webm}"
echo "[download] Destination: $DEST"
echo "[download]  30.0% of 1MiB at 1MiB/s ETA 00:01"; sleep 0.2
echo "[download]  80.0% of 1MiB at 1MiB/s ETA 00:01"; sleep 0.2
cp "${FIXTURE}" "$DEST"
echo "[download] 100% of 1MiB"
`)
  chmodSync(fake, 0o755)
  previous = process.env.YT_DLP_PATH
  process.env.YT_DLP_PATH = fake
})
afterAll(() => {
  if (previous === undefined) delete process.env.YT_DLP_PATH
  else process.env.YT_DLP_PATH = previous
  rmSync(dir, { recursive: true, force: true })
})

const calls = () => { try { return readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n') } catch { return [] } }

describe('the YouTube add-on over the contract (#964, docs/36 §7)', () => {
  it('is declared: the device knows its methods and its slot from the manifest', () => {
    expect(methods.has('youtube-download')).toBe(true)
    expect(Object.keys(methods.contributes('youtube-download')!.methods)).toEqual(['search', 'fetchAudio'])
    expect(methods.contributes('youtube-download')!.ui).toEqual([expect.objectContaining({ slot: 'song-editor.track-source' })])
    expect(methods.has('no-such-addon')).toBe(false)
  })

  it('search: the add-on asks the helper, the hits come back with the entries without a valid id skipped', async () => {
    const result = await call('search', { query: 'never gonna' })
    expect(result).toMatchObject({ ok: true, body: { hits: [
      { id: 'dQw4w9WgXcQ', title: 'Never Gonna', channel: 'Rick', durationSec: 212, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { id: 'aaaaaaaaaaa', title: 'Second', channel: 'Up', durationSec: null },
    ] } })
  })

  it('search: an empty text never reaches yt-dlp - the boundary refuses it', async () => {
    const before = calls().length
    expect(await call('search', { query: '' })).toMatchObject({ ok: false, error: { code: 'method.input' } })
    expect(await call('search', { query: 'x'.repeat(201) })).toMatchObject({ ok: false, error: { code: 'method.input' } })
    expect(await call('search', { query: '   ' })).toMatchObject({ ok: false, error: { code: 'youtube.query' } })
    expect(calls().length).toBe(before)
  })

  it('fetchAudio: the real file comes back (byte for byte) with its extension, and the progress of the helper reaches the caller', async () => {
    const progress: number[] = []
    const result = await call('fetchAudio', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, (f) => progress.push(f))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const body = result.body as { audio: Uint8Array; ext: string }
    expect(body.ext).toBe('webm')
    expect(Buffer.from(body.audio).equals(readFileSync(FIXTURE))).toBe(true)
    expect(progress).toEqual(expect.arrayContaining([0.3, 0.8]))
  })

  it('fetchAudio: a link that is no YouTube link is refused by the add-on in its own words, and no download is started', async () => {
    const before = calls().length
    for (const url of ['https://evil.example/--exec=rm', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'file:///etc/passwd']) {
      expect(await call('fetchAudio', { url }), url).toEqual({ ok: false, error: { code: 'youtube.urlOnly', message: 'Nur youtube.com/youtu.be-Links werden unterstützt.' } })
    }
    expect(calls().length).toBe(before)
  })

  it('fetchAudio: a failure the helper reports as a code is said in the add-on\'s words, with its numbers', async () => {
    expect(await call('fetchAudio', { url: 'https://www.youtube.com/watch?v=toolargexx1' })).toMatchObject({ ok: false, error: { code: 'youtube.tooLarge', message: expect.stringMatching(/^Die Audiospur ist größer als das Limit von \d+ MB\.$/) } })
  })

  it('an unknown add-on and an undeclared method are answered, not crashes', async () => {
    expect(await methods.call('nope', 'x', {})).toMatchObject({ ok: false, error: { code: 'addon.unknown' } })
    expect(await call('format-disk', {})).toMatchObject({ ok: false, error: { code: 'method.undeclared' } })
  })
})
