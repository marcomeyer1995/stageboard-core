import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Song, SongVariant } from 'shared-types'
import { VisualMetronomeWidget } from './VisualMetronomeWidget'
import { useShowMode } from '../lib/showMode'

// Same reasoning as ShowTransportWidget.test.tsx: mock useShowMode directly rather than the
// stores it composes, several of which transitively construct a real PouchDB at import time.
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))

function song(bpm: number, timeSignature: string): Song {
  return { id: 'song-1', title: 'Test Song', bpm, timeSignature, chordProContent: '', timecodes: [] }
}

function mockShowMode(overrides: {
  currentSong: Song | null
  currentVariant?: SongVariant | null
  elapsedMs: number | null
  playbackStatus?: 'playing' | 'paused' | 'stopped'
}) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: 'gig',
    queue: {
      activeSetlist: null,
      orderedItems: [],
      orderedSongs: [],
      previousSong: null,
      currentSong: overrides.currentSong,
      nextSong: null,
      previousEntry: null,
      currentEntry: null,
      nextEntry: null,
      previousVariant: null,
      currentVariant: overrides.currentVariant ?? null,
      nextVariant: null,
    },
    elapsedMs: overrides.elapsedMs,
    playbackStatus: overrides.playbackStatus ?? 'playing',
    trackOverride: null,
    canControl: true,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setTrackOverride: vi.fn(),
  } as never)
}

describe('VisualMetronomeWidget', () => {
  it('shows a placeholder when no song is active', () => {
    mockShowMode({ currentSong: null, elapsedMs: null, playbackStatus: 'stopped' })
    render(<VisualMetronomeWidget />)
    expect(screen.getByText('Kein Song aktiv')).toBeInTheDocument()
  })

  it('shows a waiting state when a song is loaded but not playing', () => {
    mockShowMode({ currentSong: song(120, '4/4'), elapsedMs: null, playbackStatus: 'stopped' })
    render(<VisualMetronomeWidget />)
    expect(screen.getByText('Wartet auf Play')).toBeInTheDocument()
    expect(screen.getByText('120 BPM · 4/4')).toBeInTheDocument()
  })

  it('shows the downbeat count and BPM/time signature while playing', () => {
    mockShowMode({ currentSong: song(120, '3/4'), elapsedMs: 0, playbackStatus: 'playing' })
    render(<VisualMetronomeWidget />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('120 BPM · 3/4')).toBeInTheDocument()
  })

  it('advances the displayed beat number as elapsed time crosses beat boundaries', () => {
    // 120 BPM = 500ms/beat; 650ms is into beat index 1 -> displayed as "2" (1-indexed).
    mockShowMode({ currentSong: song(120, '4/4'), elapsedMs: 650, playbackStatus: 'playing' })
    render(<VisualMetronomeWidget />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('prefers the current variant\'s bpm/timeSignature over the song\'s own', () => {
    const variant: SongVariant = {
      id: 'variant-1',
      songId: 'song-1',
      label: 'Akustik',
      isDefault: false,
      bpm: 90,
      timeSignature: '6/8',
      chordProContent: '',
      timecodes: [],
      tracks: [],
      cues: [],
    }
    mockShowMode({ currentSong: song(120, '4/4'), currentVariant: variant, elapsedMs: 0, playbackStatus: 'playing' })
    render(<VisualMetronomeWidget />)
    expect(screen.getByText('90 BPM · 6/8')).toBeInTheDocument()
  })
})
