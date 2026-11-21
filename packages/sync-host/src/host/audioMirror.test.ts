import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { trackKey, type TrackRef } from './trackSync.js'
import { createAudioMirror } from './audioMirror.js'

const FP = 'a'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: FP, priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }

/** In-memory stand-in for the audio folder: `files` maps "variant/track" to the revision it holds. */
function setup(tracks: TrackRef[], files: Record<string, number | null> = {}, over: Record<string, unknown> = {}) {
  const store = new Map<string, number | null>(Object.entries(files))
  const fetchFile = vi.fn(async (_base: string, _fingerprint: string | undefined, _variantId: string, _trackId: string): Promise<Buffer | null> => Buffer.from('audio'))
  const saveFile = vi.fn(async (variantId: string, trackId: string, rev: number | null) => void store.set(`${variantId}/${trackId}`, rev))
  const m = createAudioMirror({
    selfHostId: 'stage-pc',
    workspaceId: () => 'band-a',
    readHosts: async () => [primary, backup],
    passive: () => true,
    listTracks: async () => tracks,
    heldKeys: async () => [...store].map(([path, rev]) => { const [v, t] = path.split('/'); return trackKey(v!, t!, rev ?? undefined) }),
    fetchFile,
    saveFile,
    ...over,
  })
  return { m, store, fetchFile, saveFile }
}
const t = (variantId: string, trackId: string, fileRev?: number): TrackRef => ({ variantId, trackId, fileRev })

describe('audio mirror on the backup (#919)', () => {
  it('fetches only what is missing, from the primary pinned to its fingerprint', async () => {
    const { m, fetchFile, saveFile } = setup([t('v1', 'a'), t('v1', 'b'), t('v2', 'c')], { 'v1/a': null })
    await m.tick()
    expect(fetchFile).toHaveBeenCalledTimes(2)
    expect(fetchFile).toHaveBeenCalledWith('https://10.0.0.1:8443', FP, 'v1', 'b')
    expect(fetchFile).toHaveBeenCalledWith('https://10.0.0.1:8443', FP, 'v2', 'c')
    expect(saveFile).toHaveBeenCalledTimes(2)
  })

  it('does not fetch again what it has: a second tick and a full folder do nothing', async () => {
    const { m, fetchFile } = setup([t('v1', 'a'), t('v1', 'b')])
    await m.tick()
    fetchFile.mockClear()
    await m.tick()
    expect(fetchFile).not.toHaveBeenCalled()
    expect(m.status()).toMatchObject({ total: 2, present: 2, missing: 0 })
  })

  it('fetches again a track whose file was replaced (newer fileRev), and keeps one with the same rev', async () => {
    const { m, fetchFile } = setup([t('v1', 'a', 2), t('v1', 'b', 1)], { 'v1/a': 1, 'v1/b': 1 })
    await m.tick()
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(fetchFile).toHaveBeenCalledWith(expect.any(String), FP, 'v1', 'a')
  })

  it('a file that is here without a recorded revision counts as present when the track has no fileRev, but is fetched when it has one', async () => {
    const { m, fetchFile } = setup([t('v1', 'old'), t('v1', 'new', 3)], { 'v1/old': null, 'v1/new': null })
    await m.tick()
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(fetchFile).toHaveBeenCalledWith(expect.any(String), FP, 'v1', 'new')
  })

  it('leaves what the primary does not have: a 404 is counted as missing, not saved, and does not stop the rest', async () => {
    const { m, fetchFile, saveFile } = setup([t('v1', 'gone'), t('v1', 'there')])
    fetchFile.mockImplementation(async (_b, _f, _v, track) => (track === 'gone' ? null : Buffer.from('x')))
    await m.tick()
    expect(saveFile).toHaveBeenCalledTimes(1)
    expect(m.status()).toMatchObject({ total: 2, present: 1, missing: 1 })
  })

  it('a failing fetch or save does not throw and does not stop the rest', async () => {
    const { m, fetchFile } = setup([t('v1', 'a'), t('v1', 'b')])
    fetchFile.mockRejectedValueOnce(new Error('down'))
    await expect(m.tick()).resolves.toBeUndefined()
    expect(fetchFile).toHaveBeenCalledTimes(2)
  })

  it('one fetch at a time, and an overlapping tick does nothing', async () => {
    let running = 0
    let peak = 0
    const { m, fetchFile } = setup([t('v1', 'a'), t('v1', 'b'), t('v1', 'c')])
    fetchFile.mockImplementation(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 15))
      running -= 1
      return Buffer.from('x')
    })
    await Promise.all([m.tick(), m.tick()])
    expect(peak).toBe(1)
    expect(fetchFile).toHaveBeenCalledTimes(3)
  })

  it('does nothing unless this host is the passive backup of a band with a primary', async () => {
    for (const over of [
      { passive: () => false },
      { workspaceId: () => null },
      { readHosts: async () => [primary] },
      { readHosts: async () => null },
      { selfHostId: 'laptop' },
    ]) {
      const { m, fetchFile } = setup([t('v1', 'a')], {}, over)
      await m.tick()
      expect(fetchFile).not.toHaveBeenCalled()
    }
  })

  it('stops fetching once it is no longer passive (it took over: the primary is gone)', async () => {
    let passive = true
    const { m, fetchFile } = setup([t('v1', 'a'), t('v1', 'b'), t('v1', 'c')], {}, { passive: () => passive })
    fetchFile.mockImplementation(async () => {
      passive = false
      return Buffer.from('x')
    })
    await m.tick()
    expect(fetchFile).toHaveBeenCalledTimes(1)
  })

  it('reports nothing before it has run', () => {
    expect(setup([]).m.status()).toBeNull()
  })
})
