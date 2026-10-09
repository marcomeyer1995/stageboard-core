import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetSharedAudioContextForTests, holdAudioOutputAwake } from './sharedAudioContext'

const started: { stopped: boolean }[] = []
class FakeAudioContext {
  destination = {}
  resume = vi.fn(async () => {})
  createOscillator() {
    const osc = { stopped: false, frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: () => (osc.stopped = true) }
    started.push(osc)
    return osc
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  }
}
vi.stubGlobal('AudioContext', FakeAudioContext)

afterEach(() => {
  __resetSharedAudioContextForTests()
  started.length = 0
})

describe('holdAudioOutputAwake (#468)', () => {
  it('runs one inaudible signal while anyone holds the output, and stops it when the last one lets go', () => {
    holdAudioOutputAwake('track', true)
    holdAudioOutputAwake('click', true)
    expect(started).toHaveLength(1)
    holdAudioOutputAwake('track', false)
    expect(started[0].stopped).toBe(false)
    holdAudioOutputAwake('click', false)
    expect(started[0].stopped).toBe(true)
  })

  it('a second hold by the same driver does not start a second signal', () => {
    holdAudioOutputAwake('track', true)
    holdAudioOutputAwake('track', true)
    expect(started).toHaveLength(1)
  })
})
