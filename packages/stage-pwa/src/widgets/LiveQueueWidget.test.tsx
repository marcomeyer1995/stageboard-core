import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, Song } from 'shared-types'
import { LiveQueueWidget } from './LiveQueueWidget'
import { useShowMode } from '../lib/showMode'
import { LONG_PRESS_MS } from '../lib/useLongPress'

vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../lib/useContentFontSize', () => ({ useContentFontSize: () => 16 }))
vi.mock('../components/MasterTakeoverButton', () => ({ MasterTakeoverButton: () => <button type="button">Übernehmen</button> }))
const saveSetlist = vi.hoisted(() => vi.fn())
vi.mock('../store/useSetlistsStore', () => ({
  useSetlistsStore: (select: (state: { saveSetlist: typeof saveSetlist }) => unknown) => select({ saveSetlist }),
}))

afterEach(() => {
  vi.useRealTimers()
  saveSetlist.mockReset()
})

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}
const entry = (id: string, songId: string): SetlistEntry => ({ id, songId, variantId: null, trackId: null })

const entries = [entry('e1', 's1'), entry('e2', 's2'), entry('e3', 's3')]
const titles = ['Were not gonna take it', 'Wie ein schützender Engel', 'Sweet Home Alabama']

function mockQueue({ canControl = true, playbackStatus = 'stopped' } = {}) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: 'gig',
    canControl,
    playbackStatus,
    queue: {
      activeSetlist: { id: 'set', name: 'Set', entries },
      currentEntry: entries[0],
      orderedItems: entries.map((e, i) => ({ entry: e, song: song(`s${i + 1}`, titles[i]), variant: null })),
    },
  } as never)
}

describe('LiveQueueWidget - sort mode and long-press menu (PR F1, stage GUI audit)', () => {
  it('shows titles only - no drag handles, no row menu buttons - outside sort mode', () => {
    mockQueue()
    render(<LiveQueueWidget config={{}} />)
    expect(screen.queryByLabelText('Ziehen zum Sortieren')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Menü öffnen')).not.toBeInTheDocument()
    expect(screen.getByText('Sweet Home Alabama').className).toContain('line-clamp-2')
  })

  it('"⇅ Sortieren" shows handles and "⋮" triggers on the upcoming rows, "Fertig" hides them', () => {
    mockQueue()
    render(<LiveQueueWidget config={{}} />)
    fireEvent.click(screen.getByText('⇅ Sortieren'))
    expect(screen.getAllByLabelText('Ziehen zum Sortieren')).toHaveLength(2)
    expect(screen.getAllByTitle('Menü öffnen')[0]).toHaveTextContent('⋮')
    fireEvent.click(screen.getByText('Fertig'))
    expect(screen.queryByLabelText('Ziehen zum Sortieren')).not.toBeInTheDocument()
  })

  it('closes sort mode when playback starts', () => {
    mockQueue()
    const { rerender } = render(<LiveQueueWidget config={{}} />)
    fireEvent.click(screen.getByText('⇅ Sortieren'))
    mockQueue({ playbackStatus: 'playing' })
    rerender(<LiveQueueWidget config={{}} />)
    expect(screen.queryByLabelText('Ziehen zum Sortieren')).not.toBeInTheDocument()
    expect(screen.getByText('⇅ Sortieren')).toBeInTheDocument()
  })

  it('opens the row actions on a long press, not on a tap', () => {
    vi.useFakeTimers()
    mockQueue()
    render(<LiveQueueWidget config={{}} />)
    const row = screen.getByText('Sweet Home Alabama').closest('div')!

    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(row)
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(screen.queryByText('Als nächstes spielen')).not.toBeInTheDocument()

    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(screen.getByText('Als nächstes spielen')).toBeInTheDocument()
  })

  it('treats a moving finger as scrolling, not a long press', () => {
    vi.useFakeTimers()
    mockQueue()
    render(<LiveQueueWidget config={{}} />)
    const row = screen.getByText('Sweet Home Alabama').closest('div')!
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(row, { clientX: 10, clientY: 40 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(screen.queryByText('Als nächstes spielen')).not.toBeInTheDocument()
  })

  it('offers neither sort mode nor row actions without the Master token', () => {
    vi.useFakeTimers()
    mockQueue({ canControl: false })
    render(<LiveQueueWidget config={{}} />)
    expect(screen.queryByText('⇅ Sortieren')).not.toBeInTheDocument()
    const row = screen.getByText('Sweet Home Alabama').closest('div')!
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    expect(screen.queryByText('Als nächstes spielen')).not.toBeInTheDocument()
  })
})
