import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Profile, Song } from 'shared-types'
import { PrompterWidget } from './PrompterWidget'
import { useShowMode } from '../lib/showMode'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useProfilesStore } from '../store/useProfilesStore'
import type { PrompterConfig } from './prompterConfig'

// Same reasoning as VisualMetronomeWidget.test.tsx/ShowTransportWidget.test.tsx: mock the
// composed hooks directly rather than the stores underneath them, several of which
// transitively construct a real PouchDB at import time (unavailable under happy-dom).
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: vi.fn() }))
vi.mock('../store/useProfilesStore', () => ({ useProfilesStore: vi.fn() }))

const config: PrompterConfig = { viewMode: 'scroll' }

function song(chordProContent: string): Song {
  return {
    id: 'song-1',
    title: 'Test Song',
    bpm: 120,
    timeSignature: '4/4',
    clickTrackEnabled: false,
    chordProContent,
    timecodes: [],
  }
}

function mockShowMode(currentSong: Song | null) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: 'gig',
    queue: {
      activeSetlist: null,
      orderedItems: [],
      orderedSongs: [],
      previousSong: null,
      currentSong,
      nextSong: null,
      previousEntry: null,
      currentEntry: null,
      nextEntry: null,
      previousVariant: null,
      currentVariant: null,
      nextVariant: null,
    },
    elapsedMs: 0,
    playbackStatus: 'playing',
    trackOverride: null,
    liveTempoAdjustPercent: 0,
    setLiveTempoAdjustPercent: vi.fn(),
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

function profile(id: string, name: string): Profile {
  return { id, name, stageRoles: [] }
}

function mockRoster(profiles: Profile[]) {
  vi.mocked(useProfilesStore).mockImplementation(((selector: (state: { profiles: Profile[] }) => unknown) =>
    selector({ profiles })) as never)
}

describe('PrompterWidget - targeted comment filtering (issue #215 follow-up)', () => {
  it('shows an untargeted comment regardless of the active profile', () => {
    mockShowMode(song('{cc: For everyone}\nLyric line'))
    mockRoster([profile('p1', 'Marco'), profile('p2', 'Jamie')])
    vi.mocked(useActiveProfile).mockReturnValue(profile('p2', 'Jamie'))

    render(<PrompterWidget config={config} />)
    expect(screen.getByText('For everyone')).toBeInTheDocument()
  })

  it('shows a targeted comment to the profile it targets', () => {
    mockShowMode(song('{cc4marco: Start solo fret 7}\nLyric line'))
    mockRoster([profile('p1', 'Marco'), profile('p2', 'Jamie')])
    vi.mocked(useActiveProfile).mockReturnValue(profile('p1', 'Marco'))

    render(<PrompterWidget config={config} />)
    expect(screen.getByText('Start solo fret 7')).toBeInTheDocument()
  })

  it('hides a targeted comment from a profile it does not target', () => {
    mockShowMode(song('{cc4marco: Start solo fret 7}\nLyric line'))
    mockRoster([profile('p1', 'Marco'), profile('p2', 'Jamie')])
    vi.mocked(useActiveProfile).mockReturnValue(profile('p2', 'Jamie'))

    render(<PrompterWidget config={config} />)
    expect(screen.queryByText('Start solo fret 7')).not.toBeInTheDocument()
    expect(screen.getByText('Lyric line')).toBeInTheDocument()
  })

  it('shows every comment when no profile is active on this device - same as before this feature existed', () => {
    mockShowMode(song('{cc4marco: Start solo fret 7}\nLyric line'))
    mockRoster([profile('p1', 'Marco'), profile('p2', 'Jamie')])
    vi.mocked(useActiveProfile).mockReturnValue(undefined)

    render(<PrompterWidget config={config} />)
    expect(screen.getByText('Start solo fret 7')).toBeInTheDocument()
  })

  it('fails open (shows to everyone) when the target name matches nobody on the roster', () => {
    mockShowMode(song('{cc4typo: Start solo fret 7}\nLyric line'))
    mockRoster([profile('p1', 'Marco'), profile('p2', 'Jamie')])
    vi.mocked(useActiveProfile).mockReturnValue(profile('p2', 'Jamie'))

    render(<PrompterWidget config={config} />)
    expect(screen.getByText('Start solo fret 7')).toBeInTheDocument()
  })
})
