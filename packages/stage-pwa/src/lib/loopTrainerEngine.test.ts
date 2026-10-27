import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@soundtouchjs/audio-worklet', () => ({
  SoundTouchNode: class {
    static register = vi.fn(async () => undefined)
    playbackRate = { setValueAtTime: vi.fn() }
    connect = vi.fn()
    disconnect = vi.fn()
  },
}))
vi.mock('@soundtouchjs/audio-worklet/processor?url', () => ({ default: 'processor.js' }))
vi.mock('./audioMix', () => ({ sourceOutput: () => ({}) }))

/** Every buffer source the engine creates - "started" and not "stopped" means it is sounding. */
const sources: { started: boolean; stopped: boolean }[] = []
/** Resolves the decodes one by one, so a test decides when each start finishes loading. */
const decodes: (() => void)[] = []

class FakeAudioContext {
  currentTime = 0
  async resume() {}
  decodeAudioData() {
    const decoded = { sampleRate: 1000, length: 10_000, numberOfChannels: 1, getChannelData: () => new Float32Array(10_000) }
    return new Promise((resolve) => decodes.push(() => resolve(decoded)))
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel: () => undefined }
  }
  createBufferSource() {
    const source = {
      started: false,
      stopped: false,
      playbackRate: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: () => (source.started = true),
      stop: () => (source.stopped = true),
    }
    sources.push(source)
    return source
  }
}

const options = () => ({ blob: new Blob(['x']), startMs: 1000, endMs: 5000, speed: { startRate: 1, targetRate: 1, step: 0 } })
const sounding = () => sources.filter((s) => s.started && !s.stopped).length
/** Lets the engine run up to its next await (the dynamic imports, then the decode). */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('loopTrainerEngine - a start overtaken while loading never plays', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    sources.length = 0
    decodes.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a second tap while the first is still decoding leaves exactly one loop, and Stop silences it', async () => {
    const { startLoopEngine, stopLoopEngine } = await import('./loopTrainerEngine')
    const first = startLoopEngine(options())
    await settle()
    const second = startLoopEngine(options())
    await settle()
    decodes.forEach((resolve) => resolve())
    expect((await first).status).toBe('cancelled')
    expect((await second).status).toBe('ok')
    expect(sounding()).toBe(1)
    stopLoopEngine()
    expect(sounding()).toBe(0)
  })

  it('Stop while the loop is still loading means it never starts', async () => {
    const { startLoopEngine, stopLoopEngine } = await import('./loopTrainerEngine')
    const pending = startLoopEngine(options())
    await settle()
    stopLoopEngine()
    decodes.forEach((resolve) => resolve())
    expect((await pending).status).toBe('cancelled')
    expect(sounding()).toBe(0)
  })
})
