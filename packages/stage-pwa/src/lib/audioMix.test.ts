import { afterEach, describe, expect, it } from 'vitest'
import { __resetAudioMixForTests, DEFAULT_MIX, mixGain, parseMix, sourceOutput, trackElementVolume, useAudioMixStore } from './audioMix'

class FakeGain {
  gain = {
    value: 1,
    targets: [] as number[],
    setTargetAtTime(v: number) {
      this.targets.push(v)
    },
  }
  connectedTo: unknown = null
  connect(node: unknown) {
    this.connectedTo = node
    return node
  }
}
const fakeCtx = () => ({ currentTime: 0, destination: { name: 'out' }, createGain: () => new FakeGain() }) as unknown as AudioContext

afterEach(() => {
  __resetAudioMixForTests()
  localStorage.clear()
})

describe('Mein Mix (docs/21 §9.3)', () => {
  it('keeps levels in range and survives broken storage', () => {
    expect(parseMix(null)).toEqual(DEFAULT_MIX)
    expect(parseMix({ track: { level: 3 }, click: { level: -1, muted: true }, voice: 'x' })).toEqual({
      track: { level: 1, muted: false },
      click: { level: 0, muted: true },
      voice: { level: 1, muted: false },
    })
  })

  it('stores per device, mute wins over the level', () => {
    useAudioMixStore.getState().setLevel('voice', 1.6)
    useAudioMixStore.getState().setMuted('click', true)
    expect(JSON.parse(localStorage.getItem('sb:audio:mix')!)).toMatchObject({ voice: { level: 1.6 }, click: { muted: true } })
    expect(mixGain('voice')).toBe(1.6)
    expect(mixGain('click')).toBe(0)
  })

  it('every source gets one gain node per context, following the sliders', () => {
    const ctx = fakeCtx()
    const click = sourceOutput('click', ctx) as unknown as FakeGain
    expect(sourceOutput('click', ctx)).toBe(click as unknown as AudioNode)
    expect(click.connectedTo).toBe(ctx.destination)
    useAudioMixStore.getState().setLevel('click', 0.5)
    expect(click.gain.targets[click.gain.targets.length - 1]).toBe(0.5)
    useAudioMixStore.getState().setMuted('click', true)
    expect(click.gain.targets[click.gain.targets.length - 1]).toBe(0)
  })

  it("the track's <audio> element never goes above full volume", () => {
    useAudioMixStore.setState({ mix: { ...DEFAULT_MIX, track: { level: 1.5, muted: false } } })
    expect(trackElementVolume()).toBe(1)
    useAudioMixStore.getState().setLevel('track', 0.3)
    expect(trackElementVolume()).toBeCloseTo(0.3)
  })
})
