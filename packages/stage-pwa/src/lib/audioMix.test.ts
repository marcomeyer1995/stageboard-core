import { afterEach, describe, expect, it } from 'vitest'
import { __resetAudioMixForTests, DEFAULT_MIX, mixGain, parseMix, sideOf, sourceOutput, trackElementVolume, useAudioMixStore, useOutputRoutingStore } from './audioMix'

class FakeGain {
  gain = {
    value: 1,
    targets: [] as number[],
    setTargetAtTime(v: number) {
      this.targets.push(v)
    },
  }
  connectedTo: unknown = null
  input: number | null = null
  channelCount = 2
  channelCountMode = 'max'
  channelInterpretation = 'speakers'
  connect(node: unknown, ...[, input = null]: [number?, (number | null)?]) {
    this.connectedTo = node
    this.input = input
    return node
  }
  disconnect() {
    this.connectedTo = null
  }
}
class FakeMerger {
  constructor(public inputs: number) {}
  connectedTo: unknown = null
  connect(node: unknown) {
    this.connectedTo = node
  }
}
const fakeCtx = () =>
  ({ currentTime: 0, destination: { name: 'out' }, createGain: () => new FakeGain(), createChannelMerger: (n: number) => new FakeMerger(n) }) as unknown as AudioContext

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

describe('Klick und Track trennen (#481 step 1)', () => {
  it('click and announcements on one side, the track on the other', () => {
    expect(sideOf('click', 'click-left')).toBe('left')
    expect(sideOf('voice', 'click-left')).toBe('left')
    expect(sideOf('track', 'click-left')).toBe('right')
    expect(sideOf('track', 'click-right')).toBe('left')
    expect(sideOf('track', 'mixed')).toBeNull()
  })

  it('split: each source into a mono bus on its merger input; back to mixed: straight to the output', () => {
    const ctx = fakeCtx()
    const click = sourceOutput('click', ctx) as unknown as FakeGain
    const track = sourceOutput('track', ctx) as unknown as FakeGain
    useOutputRoutingStore.getState().setRouting('click-left')
    const left = click.connectedTo as FakeGain
    const right = track.connectedTo as FakeGain
    expect(left.input).toBe(0)
    expect(right.input).toBe(1)
    // Mono buses: the stereo track is summed down on its way in.
    expect([right.channelCount, right.channelCountMode, right.channelInterpretation]).toEqual([1, 'explicit', 'speakers'])
    const merger = left.connectedTo as FakeMerger
    expect(right.connectedTo).toBe(merger)
    expect(merger.connectedTo).toBe(ctx.destination)
    // A source created later follows the routing too.
    const voice = sourceOutput('voice', ctx) as unknown as FakeGain
    expect(voice.connectedTo).toBe(left)
    useOutputRoutingStore.getState().setRouting('mixed')
    expect(click.connectedTo).toBe(ctx.destination)
    expect(track.connectedTo).toBe(ctx.destination)
  })

  it('is kept per device', () => {
    useOutputRoutingStore.getState().setRouting('click-right')
    expect(localStorage.getItem('sb:audio:routing')).toBe('click-right')
  })
})
