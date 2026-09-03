import { describe, expect, it } from 'vitest'
import { ARMED_TRANSPORT, computeActiveMs, pause, play, reset, type TransportState } from './playbackTransport'

describe('play', () => {
  it('starts a freshly armed transport', () => {
    const next = play(ARMED_TRANSPORT, 1000)
    expect(next).toEqual({ status: 'playing', startedAt: 1000, accumulatedMs: 0 })
  })

  it('resumes from a paused position without resetting it', () => {
    const paused: TransportState = { status: 'paused', startedAt: null, accumulatedMs: 5000 }
    const next = play(paused, 2000)
    expect(next).toEqual({ status: 'playing', startedAt: 2000, accumulatedMs: 5000 })
  })

  it('is a no-op if already playing - re-pressing Play never resets the position', () => {
    const playing: TransportState = { status: 'playing', startedAt: 1000, accumulatedMs: 0 }
    expect(play(playing, 5000)).toEqual(playing)
  })
})

describe('pause', () => {
  it('freezes the accumulated active time and stops the clock', () => {
    const playing: TransportState = { status: 'playing', startedAt: 1000, accumulatedMs: 0 }
    const next = pause(playing, 1000 + 7_000)
    expect(next).toEqual({ status: 'paused', startedAt: null, accumulatedMs: 7_000 })
  })

  it('is a no-op unless currently playing', () => {
    expect(pause(ARMED_TRANSPORT, 5000)).toEqual(ARMED_TRANSPORT)
  })
})

describe('computeActiveMs', () => {
  it('excludes any paused span - two play/pause cycles sum only the active portions (#13)', () => {
    let state = play(ARMED_TRANSPORT, 0)
    state = pause(state, 10_000) // played 10s
    // 20s paused in between - a stage-banter gap that must not count.
    state = play(state, 30_000)
    state = pause(state, 30_000 + 8_000) // played another 8s
    expect(computeActiveMs(state, 30_000 + 8_000)).toBe(18_000)
  })

  it('keeps counting up while still playing', () => {
    const playing: TransportState = { status: 'playing', startedAt: 1000, accumulatedMs: 2000 }
    expect(computeActiveMs(playing, 1000 + 5000)).toBe(7000)
  })
})

describe('reset', () => {
  it('always rearms to zero', () => {
    expect(reset()).toEqual(ARMED_TRANSPORT)
    expect(computeActiveMs(reset(), Date.now())).toBe(0)
  })
})
