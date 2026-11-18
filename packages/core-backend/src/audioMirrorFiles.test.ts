import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mirrorTracksOf, readLocalRevision, saveMirrorFile } from './audioMirrorFiles.js'

const old = process.env.AUDIO_STORAGE_DIR
afterEach(() => {
  if (old === undefined) delete process.env.AUDIO_STORAGE_DIR
  else process.env.AUDIO_STORAGE_DIR = old
})
const dir = () => (process.env.AUDIO_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'audio-')))

describe('mirrorTracksOf (#919)', () => {
  it('lists every track of every variant with its fileRev, and skips documents that are not variants', () => {
    const tracks = mirrorTracksOf([
      { _id: 'song-variants:v1', id: 'v1', tracks: [{ id: 'a' }, { id: 'b', fileRev: 2 }] },
      { _id: 'song-variants:v2', id: 'v2', tracks: [] },
      { _id: 'song-variants:v3', id: 'v3' },
      { _id: 'songs:s1', tracks: [{ id: 'x' }] },
      { _id: 'song-variants:bad', id: '../escape', tracks: [{ id: 'a' }] },
      { _id: 'song-variants:v4', id: 'v4', tracks: [{ id: '../x' }, { notAnId: 1 }, { id: 'ok' }] },
    ])
    expect(tracks).toEqual([
      { variantId: 'v1', trackId: 'a', fileRev: undefined },
      { variantId: 'v1', trackId: 'b', fileRev: 2 },
      { variantId: 'v4', trackId: 'ok', fileRev: undefined },
    ])
  })
})

describe('mirror files (#919)', () => {
  it('has nothing for an unknown track; a saved file comes back with its revision', async () => {
    dir()
    expect(await readLocalRevision('v1', 'a')).toBeNull()
    await saveMirrorFile('v1', 'a', 3, Buffer.from('opus'))
    expect(await readLocalRevision('v1', 'a')).toEqual({ rev: 3 })
    expect(readFileSync(join(process.env.AUDIO_STORAGE_DIR!, 'v1', 'a')).toString()).toBe('opus')
  })

  it('a revision of null is remembered as none', async () => {
    dir()
    await saveMirrorFile('v1', 'a', null, Buffer.from('x'))
    expect(await readLocalRevision('v1', 'a')).toEqual({ rev: null })
  })

  it('a file that is here without a marker (put there by an upload) counts as present with no revision', async () => {
    const d = dir()
    mkdirSync(join(d, 'v1'))
    writeFileSync(join(d, 'v1', 'a'), 'x')
    expect(await readLocalRevision('v1', 'a')).toEqual({ rev: null })
  })

  it('checking a file does not read it: a large file is only looked at', async () => {
    const d = dir()
    mkdirSync(join(d, 'v1'))
    // A directory where the file should be: readFile would fail with EISDIR, stat sees something there. It
    // must not count as a file either way.
    mkdirSync(join(d, 'v1', 'dir'))
    expect(await readLocalRevision('v1', 'dir')).toBeNull()
    writeFileSync(join(d, 'v1', 'big'), Buffer.alloc(8 * 1024 * 1024))
    const before = process.memoryUsage().arrayBuffers
    for (let i = 0; i < 50; i++) await readLocalRevision('v1', 'big')
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(8 * 1024 * 1024)
  })

  it('refuses ids that could leave the audio folder', async () => {
    dir()
    await expect(saveMirrorFile('..', 'a', null, Buffer.from('x'))).rejects.toThrow()
    await expect(readLocalRevision('v1', '../a')).resolves.toBeNull()
  })

  it('the marker does not look like a track: a track id can never be read as a marker', async () => {
    dir()
    await saveMirrorFile('v1', 'a', 2, Buffer.from('x'))
    expect(await readLocalRevision('v1', 'a.rev')).toBeNull()
  })
})
