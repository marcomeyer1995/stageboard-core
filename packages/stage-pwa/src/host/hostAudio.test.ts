import { describe, expect, it } from 'vitest'
import type { AudioStorageBackend } from '../lib/audioStorageBackend'
import { createHostAudio } from './hostAudio'

/** An in-memory stand-in for the app's audio cache - the same store the device plays from. */
function memoryBackend(): AudioStorageBackend & { keys: () => string[] } {
  const files = new Map<string, Blob>()
  return {
    get: async (key) => files.get(key) ?? null,
    set: async (key, blob) => void files.set(key, blob),
    remove: async (key) => void files.delete(key),
    listKeys: async () => [...files.keys()],
    keys: () => [...files.keys()],
  }
}
const bytesOf = async (blob: Blob | null) => (blob ? new Uint8Array(await blob.arrayBuffer()) : null)

function setup(revisions: Record<string, number | undefined> = {}) {
  const backend = memoryBackend()
  const audio = createHostAudio({ backend, revisionOf: async (v, t) => revisions[`${v}/${t}`] })
  return { backend, audio }
}

describe('the audio a tablet host serves is its own playback cache (#954)', () => {
  it('stores an upload under the revision the band\'s song list names, so the device\'s own sync wants the very same key', async () => {
    const { audio, backend } = setup({ 'var1/trk1': 4 })
    await audio.put('var1', 'trk1', new Uint8Array([1, 2, 3]))
    expect(backend.keys()).toEqual(['var1:trk1@4'])
    expect(await audio.get('var1', 'trk1')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('stores it under the plain key while the list names no revision (yet)', async () => {
    const { audio, backend } = setup()
    await audio.put('var1', 'trk1', new Uint8Array([9]))
    expect(backend.keys()).toEqual(['var1:trk1'])
  })

  it('replaces an older file of the same track, whatever revision it was held under', async () => {
    const { audio, backend } = setup({ 'var1/trk1': 5 })
    await backend.set('var1:trk1', new Blob([new Uint8Array([1])]))
    await backend.set('var1:trk1@3', new Blob([new Uint8Array([2])]))
    await audio.put('var1', 'trk1', new Uint8Array([7, 7]))
    expect(backend.keys()).toEqual(['var1:trk1@5'])
  })

  it('hands back the newest revision it holds, and nothing for a track it does not hold', async () => {
    const { audio, backend } = setup()
    await backend.set('v:t', new Blob([new Uint8Array([1])]))
    await backend.set('v:t@2', new Blob([new Uint8Array([2])]))
    await backend.set('v:t@10', new Blob([new Uint8Array([10])]))
    expect(await audio.get('v', 't')).toEqual(new Uint8Array([10]))
    expect(await audio.get('v', 'other')).toBeNull()
    expect(await audio.get('other', 't')).toBeNull()
  })

  it('does not mix up tracks whose ids merely start alike', async () => {
    const { audio, backend } = setup()
    await backend.set('v:t1', new Blob([new Uint8Array([1])]))
    expect(await audio.get('v', 't')).toBeNull()
    await audio.remove('v', 't')
    expect(backend.keys()).toEqual(['v:t1'])
  })

  it('removes every revision of a track', async () => {
    const { audio, backend } = setup()
    await backend.set('v:t', new Blob([new Uint8Array([1])]))
    await backend.set('v:t@2', new Blob([new Uint8Array([2])]))
    await backend.set('v:u', new Blob([new Uint8Array([3])]))
    await audio.remove('v', 't')
    expect(backend.keys()).toEqual(['v:u'])
  })

  it('still stores an upload when the song list cannot be read', async () => {
    const backend = memoryBackend()
    const audio = createHostAudio({
      backend,
      revisionOf: async () => {
        throw new Error('database closed')
      },
    })
    await audio.put('v', 't', new Uint8Array([1]))
    expect(backend.keys()).toEqual(['v:t'])
    expect(await bytesOf(await backend.get('v:t'))).toEqual(new Uint8Array([1]))
  })
})
