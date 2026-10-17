import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const show = vi.hoisted(() => ({
  mode: 'gig',
  elapsedMs: 9000 as number | null,
  playbackStatus: 'playing',
  queue: {
    currentEntry: { id: 'e1', songId: 's1' },
    currentSong: { id: 's1', title: 'Song', bpm: 120, timeSignature: '4/4', chordProContent: '' },
    currentVariant: {
      id: 'v1',
      bpm: 120,
      timeSignature: '4/4',
      tracks: [],
      durationMs: 30000,
      chordProContent: ['{part: Intro}', '[00:00.00]x', '{part: Verse 1}', '[00:08.00]a', '{part: Chorus}', '[00:16.00]b'].join('\n'),
    },
  },
}))
const state = vi.hoisted(() => ({ isMaster: true, state: { playbackJump: null as null | { at: number; toMs: number; label?: string }, playbackLoop: null, trackOverride: null, liveTempoAdjustPercent: 0 } }))
const actions = vi.hoisted(() => ({ queueSectionJump: vi.fn(async () => 'queued'), cancelSectionJump: vi.fn(), setSectionLoop: vi.fn() }))

vi.mock('../lib/showMode', () => ({ useShowMode: () => show }))
vi.mock('../store/useShowStateStore', () => ({ useShowStateStore: (select: (s: typeof state) => unknown) => select(state) }))
vi.mock('../lib/sectionJump', () => actions)
vi.mock('../lib/entryDuration', () => ({ songDurationMs: () => ({ ms: 30000, source: 'manual' }) }))

const { SectionJumpWidget } = await import('./SectionJumpWidget')

beforeEach(() => {
  vi.clearAllMocks()
  state.isMaster = true
  state.state.playbackJump = null
})

describe('SectionJumpWidget (#479)', () => {
  it('lists the sections, marks the one playing, and the master jumps with a tap', () => {
    render(<SectionJumpWidget />)
    expect(screen.getByRole('button', { name: 'Verse 1' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Chorus' }))
    expect(actions.queueSectionJump).toHaveBeenCalledWith(expect.objectContaining({ label: 'Chorus', startMs: 16000 }), 'section', expect.any(Array), expect.anything())
  })

  it('tapping the queued section again calls the jump off', () => {
    state.state.playbackJump = { at: 1, toMs: 16000, label: 'Chorus' }
    render(<SectionJumpWidget />)
    expect(screen.getByText('Nächster Abschnitt: Chorus')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chorus' }))
    expect(actions.cancelSectionJump).toHaveBeenCalled()
  })

  it('others see the sections but cannot jump', () => {
    state.isMaster = false
    render(<SectionJumpWidget />)
    expect(screen.getByRole('button', { name: 'Chorus' })).toBeDisabled()
    expect(screen.getByText('Springen kann der Master')).toBeInTheDocument()
  })
})
