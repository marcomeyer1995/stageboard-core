import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { playbackCueContent, playbackCueLabel, playbackStateAt } from './playbackCues'

const cue = (id: string, timeMs: number, click?: 'on' | 'off', voice?: 'on' | 'off'): ShowCue => ({ id, timeMs, ...playbackCueContent({ click, voice }) })
const device: ShowCue = { id: 'k', timeMs: 0, targetLogicalDeviceId: 'kemper', type: 'click', payload: { click: 'off' } }

describe('playback cues - Klick/Ansagen aus und an (#485)', () => {
  it('each switch holds from its cue until the next one that names it', () => {
    const cues = [cue('a', 10000, 'off'), cue('b', 20000, undefined, 'off'), cue('c', 30000, 'on', 'on'), device]
    expect(playbackStateAt(cues, 0)).toEqual({ click: true, voice: true })
    expect(playbackStateAt(cues, 10000)).toEqual({ click: false, voice: true })
    expect(playbackStateAt(cues, 9997)).toEqual({ click: false, voice: true }) // a downbeat a hair early still counts
    expect(playbackStateAt(cues, 25000)).toEqual({ click: false, voice: false })
    expect(playbackStateAt(cues, 30000)).toEqual({ click: true, voice: true })
  })

  it('names what it switches', () => {
    expect(playbackCueLabel(cue('a', 0, 'off'))).toBe('Klick aus')
    expect(playbackCueLabel(cue('a', 0, 'off', 'on'))).toBe('Klick aus · Ansagen an')
  })
})
