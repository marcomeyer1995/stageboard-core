import { describe, expect, it } from 'vitest'
import type { SongEntry, TransitionEntry } from 'shared-types'
import { resolveTrackEndAction, transitionItemEndMs } from './trackEndTransition'

const entry = (over: Partial<SongEntry> = {}): SongEntry => ({
  id: 'e1',
  songId: 's1',
  variantId: null,
  trackId: null,
  ...over,
})
const next = entry({ id: 'e2', songId: 's2' })
const announcement: TransitionEntry = { id: 't1', kind: 'transition', title: 'Ansage Merch', notes: '' }
const heading: TransitionEntry = { id: 'h1', kind: 'transition', style: 'heading', title: 'Set 1', notes: '' }

describe('resolveTrackEndAction', () => {
  it('defaults to stop for legacy entries without a transition type', () => {
    expect(resolveTrackEndAction(entry(), next)).toEqual({ kind: 'stop' })
  })

  it('stops on manual', () => {
    expect(resolveTrackEndAction(entry({ transitionType: 'manual' }), next)).toEqual({ kind: 'stop' })
  })

  it('arms the next entry on next-ready', () => {
    expect(resolveTrackEndAction(entry({ transitionType: 'next-ready' }), next)).toEqual({ kind: 'arm-next' })
  })

  it('starts the next entry at once, without count-in, on seamless', () => {
    expect(resolveTrackEndAction(entry({ transitionType: 'seamless' }), next)).toEqual({
      kind: 'start-next',
      skipCountIn: true,
      delayMs: 0,
    })
  })

  it('starts the next entry after the configured delay, with count-in, on delayed', () => {
    expect(resolveTrackEndAction(entry({ transitionType: 'delayed', transitionDelayMs: 5000 }), next)).toEqual({
      kind: 'start-next',
      skipCountIn: false,
      delayMs: 5000,
    })
  })

  it('falls back to stop when there is no next entry', () => {
    for (const type of ['next-ready', 'seamless', 'delayed'] as const) {
      expect(resolveTrackEndAction(entry({ transitionType: type }), null)).toEqual({ kind: 'stop' })
    }
  })

  it('starts a following transition item like any next entry', () => {
    expect(resolveTrackEndAction(entry({ transitionType: 'seamless' }), announcement)).toEqual({
      kind: 'start-next',
      skipCountIn: true,
      delayMs: 0,
    })
  })

  it('treats a following section heading like any other next entry', () => {
    expect(resolveTrackEndAction(entry({ transitionType: 'seamless' }), heading)).toEqual({
      kind: 'start-next',
      skipCountIn: true,
      delayMs: 0,
    })
  })

  it('applies a transition item\'s own type and delay after its countdown', () => {
    const timed: TransitionEntry = { ...announcement, transitionType: 'delayed', transitionDelayMs: 3000 }
    expect(resolveTrackEndAction(timed, next)).toEqual({ kind: 'start-next', skipCountIn: false, delayMs: 3000 })
    expect(resolveTrackEndAction({ ...announcement, transitionType: 'next-ready' }, next)).toEqual({ kind: 'arm-next' })
  })

  it('lets a section heading auto-continue like any transition item', () => {
    const timed: TransitionEntry = { ...heading, estimatedDurationMs: 5000, transitionType: 'seamless' }
    expect(transitionItemEndMs(timed)).toBe(5000)
    expect(resolveTrackEndAction(timed, next)).toEqual({ kind: 'start-next', skipCountIn: true, delayMs: 0 })
    expect(resolveTrackEndAction(heading, next)).toEqual({ kind: 'stop' })
  })
})

describe('transitionItemEndMs', () => {
  const item = (over: Partial<TransitionEntry>): TransitionEntry => ({ ...announcement, ...over })

  it('is the duration for any item with one - a manual item stops there, others hand off', () => {
    expect(transitionItemEndMs(item({ estimatedDurationMs: 30000, transitionType: 'seamless' }))).toBe(30000)
    expect(transitionItemEndMs(item({ estimatedDurationMs: 30000 }))).toBe(30000)
    expect(resolveTrackEndAction(item({ estimatedDurationMs: 30000 }), next)).toEqual({ kind: 'stop' })
  })

  it('is null for items without a duration (they wait for Weiter) and for songs', () => {
    expect(transitionItemEndMs(item({ transitionType: 'seamless' }))).toBeNull()
    expect(transitionItemEndMs(heading)).toBeNull()
    expect(transitionItemEndMs(next)).toBeNull()
  })
})
