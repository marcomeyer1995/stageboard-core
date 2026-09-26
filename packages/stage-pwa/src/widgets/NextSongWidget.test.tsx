import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, Song } from 'shared-types'
import { NextSongWidget } from './NextSongWidget'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../components/ReadyCheckControl', () => ({
  ReadyCheckControl: ({ compact }: { compact?: boolean }) => <button type="button">{compact ? 'Ready' : 'Ready-Check'}</button>,
}))
vi.mock('../components/MasterTakeoverButton', () => ({ MasterTakeoverButton: () => <button type="button">Übernehmen</button> }))
// The widget's measured box; 0 x 0 (unmeasured) gives the roomy layout.
const mockSize = vi.hoisted(() => ({ width: 0, height: 0 }))
vi.mock('../lib/useElementSize', () => ({ useElementSize: () => [() => {}, mockSize] }))

afterEach(() => {
  mockSize.width = 0
  mockSize.height = 0
})

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}
const entry = (id: string, songId: string): SetlistEntry => ({ id, songId, variantId: null, trackId: null })

function mockQueue() {
  vi.mocked(useShowMode).mockReturnValue({
    queue: {
      previousEntry: entry('e0', 's0'),
      currentEntry: entry('e1', 's1'),
      nextEntry: entry('e2', 's2'),
      currentSong: song('s1', 'Were not gonna take it'),
      nextSong: song('s2', 'Bohemian Rhapsody'),
      currentVariant: null,
      nextVariant: null,
    },
    canControl: true,
    next: vi.fn(),
    previous: vi.fn(),
  } as never)
}

describe('NextSongWidget - size-dependent layout (PR B, stage GUI audit)', () => {
  it('uses full labels and touch-sized buttons when wide', () => {
    mockSize.width = 900
    mockSize.height = 67
    mockQueue()
    render(<NextSongWidget config={{}} />)
    expect(screen.getByText('Weiter ›').className).toContain('min-h-touch')
    expect(screen.getByText('Ready-Check')).toBeInTheDocument()
  })

  it('switches to arrow labels when full labels would leave the song names no room', () => {
    mockSize.width = 454
    mockSize.height = 66
    mockQueue()
    render(<NextSongWidget config={{}} />)
    expect(screen.getByTitle('Nächster Song')).toHaveTextContent('›')
    expect(screen.queryByText('Weiter ›')).not.toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('shows current and next song on separate, separately truncated lines when there is height', () => {
    mockSize.width = 422
    mockSize.height = 119
    mockQueue()
    render(<NextSongWidget config={{}} />)
    expect(screen.getByText('Were not gonna take it').parentElement?.className).toContain('truncate')
    expect(screen.getByText('Bohemian Rhapsody').parentElement?.className).toContain('truncate')
    expect(screen.getByText('Were not gonna take it').parentElement).not.toBe(screen.getByText('Bohemian Rhapsody').parentElement)
  })
})
