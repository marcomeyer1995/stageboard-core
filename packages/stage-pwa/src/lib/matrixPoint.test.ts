import { describe, expect, it } from 'vitest'
import type { Crosspoint, MatrixPoint } from 'shared-types'
import { samePoint, stereoBadge } from './matrixPoint'

const track = (channel?: 1 | 2): MatrixPoint => (channel ? { kind: 'virtual', virtualPortId: 'track', channel } : { kind: 'virtual', virtualPortId: 'track' })
const usb = (channel: number): MatrixPoint => ({ kind: 'port', portId: 'usb/audio-out', channel })
const stereo = (id: string) => id === 'track'

describe('matrix points', () => {
  it('a side of a source is a point of its own', () => {
    expect(samePoint(track(), track())).toBe(true)
    expect(samePoint(track(1), track())).toBe(false)
    expect(samePoint(track(1), track(1))).toBe(true)
  })

  it('the letter in a cell (2026-11-12): a side says itself; the whole track left on 1, right on 2 - alone on one channel no letter', () => {
    const both: Crosspoint[] = [
      { from: track(), to: usb(1) },
      { from: track(), to: usb(2) },
    ]
    expect(stereoBadge(both, track(), usb(1), stereo)).toBe('L')
    expect(stereoBadge(both, track(), usb(2), stereo)).toBe('R')
    expect(stereoBadge([both[1]!], track(), usb(2), stereo)).toBeUndefined()
    expect(stereoBadge([{ from: track(2), to: usb(1) }], track(2), usb(1), stereo)).toBe('R')
    expect(stereoBadge(both, { kind: 'virtual', virtualPortId: 'klick' }, usb(1), stereo)).toBeUndefined()
  })
})
