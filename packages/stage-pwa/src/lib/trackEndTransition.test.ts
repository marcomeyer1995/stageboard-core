import { describe, expect, it } from 'vitest'
import type { SongEntry, TransitionEntry } from 'shared-types'
import { resolveTrackEndAction } from './trackEndTransition'

const entry = (over: Partial<SongEntry> = {}): SongEntry => ({
  id: 'e1',
  songId: 's1',
  variantId: null,
  trackId: null,
  ...over,
})
const next = entry({ id: 'e2', songId: 's2' })
const announcement: TransitionEntry = { id: 't1', kind: 'transition', title: 'Ansage Merch', notes: '' }

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

  it('arms a transition item instead of auto-playing into it', () => {
    for (const type of ['seamless', 'delayed'] as const) {
      expect(resolveTrackEndAction(entry({ transitionType: type }), announcement)).toEqual({ kind: 'arm-next' })
    }
  })

  it('never hands off from a transition item itself', () => {
    expect(resolveTrackEndAction(announcement, next)).toEqual({ kind: 'stop' })
  })
})
