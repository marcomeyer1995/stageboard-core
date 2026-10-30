import { describe, expect, it } from 'vitest'
import { describeLongFrame } from './longFrameMonitor'

describe('longFrameMonitor (docs/26)', () => {
  it('names the total, the drawing part and each script', () => {
    const entry = {
      name: 'long-animation-frame',
      entryType: 'long-animation-frame',
      startTime: 1000,
      duration: 93,
      renderStart: 1092,
      styleAndLayoutStart: 1092.5,
      scripts: [
        { invoker: 'EventSource.onmessage', duration: 15 },
        { invoker: 'EventSource.onmessage', duration: 11 },
      ],
      toJSON: () => ({}),
    }
    expect(describeLongFrame(entry)).toBe('[frames] 93 ms (render 1 ms) - EventSource.onmessage 15ms, EventSource.onmessage 11ms')
  })
})
