import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listHeldKeys, saveMirrorFile } from './audioMirrorFiles.js'

const old = process.env.AUDIO_STORAGE_DIR
afterEach(() => {
  if (old === undefined) delete process.env.AUDIO_STORAGE_DIR
  else process.env.AUDIO_STORAGE_DIR = old
})
const dir = () => (process.env.AUDIO_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'audio-')))

describe('mirror files (#919, #954)', () => {
  it('holds nothing at first; a saved file is listed with the revision it was saved with', async () => {
    dir()
    expect(await listHeldKeys()).toEqual([])
    await saveMirrorFile('v1', 'a', 3, Buffer.from('opus'))
    expect(await listHeldKeys()).toEqual(['v1:a@3'])
    expect(readFileSync(join(process.env.AUDIO_STORAGE_DIR!, 'v1', 'a')).toString()).toBe('opus')
  })

  it('a revision of null is listed as the first file', async () => {
    dir()
    await saveMirrorFile('v1', 'a', null, Buffer.from('x'))
    expect(await listHeldKeys()).toEqual(['v1:a'])
  })

  it('a file that is here without a marker (put there by an upload) is listed with no revision', async () => {
    const d = dir()
    mkdirSync(join(d, 'v1'))
    writeFileSync(join(d, 'v1', 'a'), 'x')
    expect(await listHeldKeys()).toEqual(['v1:a'])
  })

  it('the marker is no track, and a folder is no file', async () => {
    const d = dir()
    await saveMirrorFile('v1', 'a', 2, Buffer.from('x'))
    mkdirSync(join(d, 'v1', 'dir'))
    expect(await listHeldKeys()).toEqual(['v1:a@2'])
  })

  it('looking at the folder does not read the files: large ones are only looked at', async () => {
    const d = dir()
    mkdirSync(join(d, 'v1'))
    writeFileSync(join(d, 'v1', 'big'), Buffer.alloc(8 * 1024 * 1024))
    const before = process.memoryUsage().arrayBuffers
    for (let i = 0; i < 50; i++) await listHeldKeys()
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(8 * 1024 * 1024)
  })

  it('skips names that are not safe ids, and refuses to save under them', async () => {
    const d = dir()
    mkdirSync(join(d, 'v1'))
    writeFileSync(join(d, 'v1', 'not safe.mp3'), 'x')
    expect(await listHeldKeys()).toEqual([])
    await expect(saveMirrorFile('..', 'a', null, Buffer.from('x'))).rejects.toThrow()
  })
})
