import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./engineProcessor.ts?worker&url', () => ({ default: 'processor.js' }))
vi.mock('./stageboard_engine.wasm?url', () => ({ default: 'engine.wasm' }))
const calls: [string, unknown[]][] = []
const chunks: string[] = []
let commitError = ''
vi.mock('../nativeOutput', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push([name, args])
  return {
    nativeEngine: {
      enable: record('enable'),
      transport: record('transport'),
      clipRemove: record('clipRemove'),
      clipBegin: async (...args: unknown[]) => void calls.push(['clipBegin', args]),
      clipChunk: async (id: number, offset: number, data: string) => {
        calls.push(['clipChunk', [id, offset]])
        chunks.push(data)
        return { ok: true }
      },
      clipCommit: async (...args: unknown[]) => {
        calls.push(['clipCommit', args])
        return { error: commitError }
      },
    },
    useNativeOutputStore: Object.assign(() => false, { getState: () => ({ delayMs: 410 }) }),
  }
})
const blobs = new Map<string, Blob>()
vi.mock('../songVariantsDb', () => ({ getTrack: async (v: string, t: string) => blobs.get(`${v}:${t}`) ?? null }))

const { isOggOpus, loadNativeTrack, useNativeTrackStore } = await import('./nativeEngineTrack')

function oggOpus(size: number): Blob {
  const b = new Uint8Array(size)
  b.set([...'OggS'].map((c) => c.charCodeAt(0)), 0)
  b.set([...'OpusHead'].map((c) => c.charCodeAt(0)), 28)
  for (let i = 36; i < size; i++) b[i] = i % 251
  return new Blob([b])
}

afterEach(() => {
  calls.length = 0
  chunks.length = 0
  commitError = ''
  blobs.clear()
})

describe('nativeEngineTrack', () => {
  it('recognises Ogg Opus by its first page - an MP3 stays with the WebView', async () => {
    expect(await isOggOpus(oggOpus(64))).toBe(true)
    expect(await isOggOpus(new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...new Array(40).fill(0)])]))).toBe(false)
  })

  it('hands the file over in pieces that add up to it, then places it at song time 0 on the track bus', async () => {
    const file = oggOpus(2 * 768 * 1024 + 1000)
    blobs.set('v1:t1', file)
    expect(await loadNativeTrack('v1', 't1')).toBe('ready')
    expect(calls.filter(([n]) => n === 'clipChunk').map(([, a]) => a[1])).toEqual([0, 768 * 1024, 2 * 768 * 1024])
    const joined = chunks.map((c) => atob(c)).join('')
    expect(joined.length).toBe(file.size)
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect(joined.charCodeAt(1_000_000)).toBe(bytes[1_000_000])
    expect(calls.find(([n]) => n === 'clipCommit')![1]).toEqual([0, 0, 1, 0])
    expect(useNativeTrackStore.getState()).toMatchObject({ key: 'v1:t1', status: 'ready' })
  })

  it('a file that is not Opus yet, or that the engine refuses, is reported - nothing placed', async () => {
    blobs.set('v1:mp3', new Blob([new Uint8Array(64)]))
    expect(await loadNativeTrack('v1', 'mp3')).toBe('not-opus')
    expect(calls.some(([n]) => n === 'clipBegin')).toBe(false)
    blobs.set('v1:bad', oggOpus(100))
    commitError = 'page 3: bad checksum'
    expect(await loadNativeTrack('v1', 'bad')).toBe('error')
    expect(useNativeTrackStore.getState().error).toBe('page 3: bad checksum')
  })

  it('a skipped song stops loading - the newer one wins', async () => {
    blobs.set('v1:a', oggOpus(3 * 768 * 1024))
    blobs.set('v2:b', oggOpus(100))
    const first = loadNativeTrack('v1', 'a')
    const second = loadNativeTrack('v2', 'b')
    expect(await first).toBe('idle')
    expect(await second).toBe('ready')
    expect(useNativeTrackStore.getState().key).toBe('v2:b')
    expect(calls.filter(([n]) => n === 'clipCommit')).toHaveLength(1)
  })
})
