import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BeatGrid, ShowCue } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
const box = vi.hoisted(() => ({ width: 1000, height: 206 }))
vi.mock('../../lib/useElementSize', () => ({ useElementSize: () => [() => {}, box] }))
vi.mock('../../lib/trackAnalysis', () => ({ loadTrackAnalysis: vi.fn(async () => null) }))
vi.mock('../../lib/clickEngine', () => ({ startClick: vi.fn(), stopClick: vi.fn() }))
// Playback state the tapping tests switch on; everything else sees a stopped track.
const trackClock = vi.hoisted(() => ({ isPlaying: false, togglePlay: vi.fn(), ref: { current: null as HTMLAudioElement | null } }))
vi.mock('../../lib/useTrackClock', () => ({
  useTrackClock: () => ({
    elapsedMs: 0,
    isPlaying: trackClock.isPlaying,
    duration: 0,
    position: 0,
    togglePlay: trackClock.togglePlay,
    audioProps: { ref: trackClock.ref },
  }),
}))
// The in-app confirm dialog answers "yes" right away.
const dialog = vi.hoisted(() => ({ promptFields: vi.fn(async (): Promise<Record<string, string> | null> => null) }))
vi.mock('../../store/useDialogStore', () => ({
  useDialogStore: (select: (state: object) => unknown) => select({ confirm: async () => true, promptFields: dialog.promptFields }),
}))
vi.mock('../../store/useProfilesStore', () => ({
  useProfilesStore: (select: (state: object) => unknown) => select({ profiles: [{ id: 'p1', name: 'Marco' }] }),
}))
vi.mock('../../store/useLogicalDevicesStore', () => ({
  useLogicalDevicesStore: (select: (state: object) => unknown) =>
    select({ devices: [{ id: 'kemper-1', name: 'Kemper Marco', capability: 'kemper-control', pluginId: null, executionTarget: null }] }),
}))

const { TimelineEditor } = await import('./TimelineEditor')

const beatGrid: BeatGrid = { points: [{ id: 'p1', bar: 1, timeMs: 1000 }, { id: 'p2', bar: 9, timeMs: 17000 }], meters: [] }

function setup(extra: { beatGrid?: BeatGrid; onDetectGrid?: () => Promise<{ bpm: number; beatGrid: BeatGrid } | null>; trackSrc?: string; fill?: boolean; content?: string; cues?: ShowCue[]; startLineTapping?: boolean } = {}) {
  const onChange = vi.fn()
  const utils = render(
    <TimelineEditor
      variantId="v"
      trackId={null}
      trackSrc={extra.trackSrc ?? null}
      beatGrid={extra.beatGrid}
      bpm={120}
      timeSignature="4/4"
      countInEnabled={false}
      countInBars={1}
      content={extra.content ?? ''}
      cues={extra.cues ?? []}
      onChange={onChange}
      onDetectGrid={extra.onDetectGrid}
      fill={extra.fill}
      startLineTapping={extra.startLineTapping}
    />,
  )
  return { onChange, ...utils }
}

describe('TimelineEditor (docs/14 §5a)', () => {
  it('keeps wheel and touchpad gestures to itself - no browser Back swipe, no page zoom (#323)', () => {
    setup({ beatGrid })
    const lanes = screen.getByTestId('timeline-lanes')
    // fireEvent returns false when the listener called preventDefault() - only possible with a
    // non-passive native listener, not React's onWheel.
    expect(fireEvent.wheel(lanes, { deltaX: 120, deltaY: 0, clientX: 500, clientY: 100 })).toBe(false)
    expect(fireEvent.wheel(lanes, { deltaY: -100, ctrlKey: true, clientX: 500, clientY: 100 })).toBe(false)
  })

  it('clears the grid after confirming, and can undo it', async () => {
    const { onChange } = setup({ beatGrid })
    fireEvent.click(screen.getByText('Raster löschen'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ beatGrid: undefined, bpm: 120, chordProContent: '', cues: [] }))
    fireEvent.click(screen.getByLabelText('Rückgängig'))
    expect(onChange).toHaveBeenLastCalledWith({ beatGrid, bpm: 120, chordProContent: '', cues: [] })
  })

  it('has nothing to clear without a grid', () => {
    setup()
    expect(screen.getByText('Raster löschen')).toBeDisabled()
  })

  it('replaces the grid with a detection run, bpm included', async () => {
    const detected: BeatGrid = { points: [{ id: 'd1', bar: 1, timeMs: 800 }], meters: [] }
    const { onChange } = setup({ beatGrid, onDetectGrid: async () => ({ bpm: 121, beatGrid: detected }), trackSrc: 'blob:track' })
    fireEvent.click(screen.getByText('Track analysieren'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ bpm: 121, beatGrid: detected, chordProContent: '', cues: [] }))
  })

  it('offers no problem jump without a track to compare against', () => {
    setup({ beatGrid })
    expect(screen.getByText('Nächste Problemstelle')).toBeDisabled()
  })
})

describe('aligning the grid (docs/14 §5a)', () => {
  // No track in these tests: the view fits bar 1 (at 0) + 60 s into 1000 px - 60 ms per px, where
  // bar lines (2 s apart) are 33 px apart, too close to grab. Zoomed in twice (1.6² = 2.56) they
  // are 85 px apart; the zoom keeps the middle (30 s) in place.
  const zoomIn = () => {
    fireEvent.click(screen.getByLabelText('Hineinzoomen'))
    fireEvent.click(screen.getByLabelText('Hineinzoomen'))
  }
  const msPerPx = 60 / 2.56
  const px = (ms: number) => (ms - (30000 - 500 * msPerPx)) / msPerPx
  function dragGrid(fromMs: number, toMs: number) {
    const lanes = screen.getByTestId('timeline-lanes')
    fireEvent.pointerDown(lanes, { pointerId: 1, clientX: px(fromMs), clientY: 150 })
    fireEvent.pointerMove(lanes, { pointerId: 1, clientX: px(toMs), clientY: 150 })
    fireEvent.pointerUp(lanes, { pointerId: 1, clientX: px(toMs), clientY: 150 })
  }
  const single: BeatGrid = { points: [{ id: 'p1', bar: 1, timeMs: 0 }], meters: [] }

  it('dragging a bar line onto a hit makes it an alignment point; the song bpm follows the first stretch', () => {
    const { onChange } = setup({ beatGrid: single })
    zoomIn()
    dragGrid(30000, 30800) // bar 16 at 120 BPM
    const next = onChange.mock.calls[0]![0] as { beatGrid: BeatGrid; bpm: number }
    expect(next.beatGrid.points.map((p) => p.bar)).toEqual([1, 16])
    expect(next.beatGrid.points[1]!.timeMs).toBeCloseTo(30800, -1)
    expect(next.bpm).toBeCloseTo(116.9, 0) // 60 beats in 30.8 s
  })

  it('refuses a drag past a neighbouring point and says why', () => {
    const { onChange } = setup({ beatGrid: { points: [{ id: 'p1', bar: 1, timeMs: 0 }, { id: 'p2', bar: 17, timeMs: 32000 }], meters: [] } })
    zoomIn()
    dragGrid(30000, 33000) // bar 16 past bar 17
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Takt 16 kann nicht dorthin/)).toBeInTheDocument()
  })

  it('tapping a bar line selects it; ±10 ms moves it as a point, a point can be removed', () => {
    const grid2: BeatGrid = { points: [{ id: 'p1', bar: 1, timeMs: 0 }, { id: 'p2', bar: 16, timeMs: 30000 }], meters: [] }
    const { onChange } = setup({ beatGrid: grid2 })
    zoomIn()
    dragGrid(30000, 30000)
    expect(screen.getByText(/Takt 16 · 0:30.0 · 120.0 BPM · Ausrichtungspunkt/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('+10 ms'))
    expect((onChange.mock.calls[0]![0] as { beatGrid: BeatGrid }).beatGrid.points[1]!.timeMs).toBe(30010)
    fireEvent.click(screen.getByText('Punkt entfernen'))
    expect((onChange.mock.calls[1]![0] as { beatGrid: BeatGrid }).beatGrid.points.map((p) => p.bar)).toEqual([1])
  })

  it('"Takt 1 hier" starts a grid at the playhead', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByText('Takt 1 hier'))
    expect(onChange).toHaveBeenCalledWith({ beatGrid: { points: [expect.objectContaining({ bar: 1 })], meters: [] }, bpm: 120, chordProContent: '', cues: [] })
  })

  it('swiping outside a bar line scrolls instead of moving the grid', () => {
    const { onChange } = setup({ beatGrid: single })
    zoomIn()
    dragGrid(31000, 34000) // halfway between bar 16 (30 s) and bar 17 (32 s): 43 px from either
    expect(onChange).not.toHaveBeenCalled()
  })

  it('zoomed out too far, bar lines cannot be grabbed - a swipe scrolls', () => {
    const { onChange } = setup({ beatGrid: single })
    const lanes = screen.getByTestId('timeline-lanes')
    fireEvent.pointerDown(lanes, { pointerId: 1, clientX: 8000 / 60, clientY: 150 })
    fireEvent.pointerMove(lanes, { pointerId: 1, clientX: 9000 / 60, clientY: 150 })
    fireEvent.pointerUp(lanes, { pointerId: 1, clientX: 9000 / 60, clientY: 150 })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('song text on the timeline (docs/14 §6)', () => {
  // No grid, no track: bar 1 at 0:00, the view fits 60 s into 1000 px (60 ms per px). The text
  // lane starts below waveform (96), tempo strip (26), grid (84) and the parts strip (28): y 234.
  const content = ['{part: Verse}', '[00:10.00] First line', '[00:14.00] Second line', 'Third line'].join('\n')
  const textY = 96 + 26 + 84 + 28 + 20
  function dragText(fromMs: number, toMs: number) {
    const lanes = screen.getByTestId('timeline-lanes')
    fireEvent.pointerDown(lanes, { pointerId: 1, clientX: fromMs / 60, clientY: textY })
    fireEvent.pointerMove(lanes, { pointerId: 1, clientX: toMs / 60, clientY: textY })
    fireEvent.pointerUp(lanes, { pointerId: 1, clientX: toMs / 60, clientY: textY })
  }

  it('dragging a line marker writes its time tag, landing on a beat nearby', () => {
    const { onChange } = setup({ content })
    dragText(10000, 12030) // 12 s is a beat at 120 BPM, 30 ms away
    const next = onChange.mock.calls[0]![0] as { chordProContent: string }
    expect(next.chordProContent.split('\n')[1]).toBe('[00:12.00] First line')
  })

  it('a line cannot pass its neighbour', () => {
    const { onChange } = setup({ content })
    dragText(10000, 20000)
    expect((onChange.mock.calls[0]![0] as { chordProContent: string }).chordProContent.split('\n')[1]).toBe('[00:13.90] First line')
  })

  it('tapping a line marker selects it; "Zeit entfernen" removes the tag', () => {
    const { onChange } = setup({ content })
    dragText(14000, 14000)
    expect(screen.getByText(/„Second line“ · 0:14.0/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Zeit entfernen'))
    expect((onChange.mock.calls[0]![0] as { chordProContent: string }).chordProContent.split('\n')[2]).toBe('Second line')
  })

  it('says how many lines still have no time', () => {
    setup({ content })
    expect(screen.getByRole('status')).toHaveTextContent('1 Zeile noch ohne Zeit')
  })
})

describe('cues on the timeline (docs/14 §7)', () => {
  // The cue lane is the bottom one: y from 96 + 26 + 84 + 28 + 64 + 44 (notes) = 342, 44 px high.
  const cueY = 342 + 22
  const cue: ShowCue = { id: 'c1', timeMs: 12000, targetLogicalDeviceId: 'kemper-1', type: 'kemper.selectRig', payload: { performance: 3, slot: 1 } }
  function pointer(fromMs: number, toMs: number) {
    const lanes = screen.getByTestId('timeline-lanes')
    fireEvent.pointerDown(lanes, { pointerId: 1, clientX: fromMs / 60, clientY: cueY })
    fireEvent.pointerMove(lanes, { pointerId: 1, clientX: toMs / 60, clientY: cueY })
    fireEvent.pointerUp(lanes, { pointerId: 1, clientX: toMs / 60, clientY: cueY })
  }

  it('dragging a cue moves it, landing on a beat nearby', () => {
    const { onChange } = setup({ cues: [cue] })
    pointer(12000, 15040)
    expect((onChange.mock.calls[0]![0] as { cues: ShowCue[] }).cues).toEqual([{ ...cue, timeMs: 15000 }])
  })

  it('tapping a cue selects it; "Entfernen" removes it', () => {
    const { onChange } = setup({ cues: [cue] })
    pointer(12000, 12000)
    expect(screen.getByText(/Kemper Marco · Performance 4, Slot 1 · 0:12.0/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Entfernen'))
    expect((onChange.mock.calls[0]![0] as { cues: ShowCue[] }).cues).toEqual([])
  })

  it('a double tap in the cue lane opens the cue window; the chosen device, command and values become the cue', () => {
    const { onChange } = setup()
    pointer(20000, 20000)
    pointer(20000, 20000)
    fireEvent.change(screen.getByLabelText('Gerät'), { target: { value: 'kemper-1' } })
    fireEvent.change(screen.getByLabelText('Befehl'), { target: { value: 'kemper.selectRig' } })
    fireEvent.change(screen.getByLabelText('Performance'), { target: { value: '11' } })
    fireEvent.change(screen.getByLabelText('Slot'), { target: { value: '3' } })
    fireEvent.click(screen.getByText('Übernehmen'))
    expect((onChange.mock.calls[0]![0] as { cues: ShowCue[] }).cues).toEqual([
      expect.objectContaining({ timeMs: 20000, targetLogicalDeviceId: 'kemper-1', type: 'kemper.selectRig', payload: { performance: 11, slot: 3 } }),
    ])
  })

  it('"Bearbeiten" opens the window with the cue\'s values', () => {
    const { onChange } = setup({ cues: [cue] })
    pointer(12000, 12000)
    fireEvent.click(screen.getByText('Bearbeiten'))
    expect((screen.getByLabelText('Performance') as HTMLSelectElement).value).toBe('3')
    fireEvent.change(screen.getByLabelText('Slot'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('Übernehmen'))
    expect((onChange.mock.calls[0]![0] as { cues: ShowCue[] }).cues[0]!.payload).toEqual({ performance: 3, slot: 5 })
  })
})

describe('comments and tab blocks on the timeline (docs/14 §7)', () => {
  // The notes lane: y from 96 + 26 + 84 + 28 + 64 = 298, 44 px high.
  const notesY = 298 + 22
  const content = ['{c: Solo starts in 8th fret}', '[00:10.00] First line', '[00:14.00] Second line', '[00:20.00] Third line'].join('\n')
  function pointer(fromMs: number, toMs: number) {
    const lanes = screen.getByTestId('timeline-lanes')
    fireEvent.pointerDown(lanes, { pointerId: 1, clientX: fromMs / 60, clientY: notesY })
    fireEvent.pointerMove(lanes, { pointerId: 1, clientX: toMs / 60, clientY: notesY })
    fireEvent.pointerUp(lanes, { pointerId: 1, clientX: toMs / 60, clientY: notesY })
  }

  it('dragging a comment attaches it to the line playing where it is dropped', () => {
    const { onChange } = setup({ content })
    pointer(10000, 15500) // the second line plays from 14 s
    expect((onChange.mock.calls[0]![0] as { chordProContent: string }).chordProContent.split('\n')).toEqual([
      '[00:10.00] First line',
      '{c: Solo starts in 8th fret}',
      '[00:14.00] Second line',
      '[00:20.00] Third line',
    ])
  })

  it('tapping a note selects it: who sees it, and removing it', () => {
    const { onChange } = setup({ content })
    pointer(10000, 10000)
    fireEvent.click(screen.getByText('Marco'))
    expect((onChange.mock.calls[0]![0] as { chordProContent: string }).chordProContent.split('\n')[0]).toBe('{cc4Marco: Solo starts in 8th fret}')
    fireEvent.click(screen.getByText('Entfernen'))
    expect((onChange.mock.calls[1]![0] as { chordProContent: string }).chordProContent.split('\n')).toHaveLength(3)
  })

  it('a double tap in the notes lane adds a comment before the line playing there', async () => {
    dialog.promptFields.mockResolvedValueOnce({ text: 'Switch sound' })
    const { onChange } = setup({ content })
    pointer(21000, 21000)
    pointer(21000, 21000)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect((onChange.mock.calls[0]![0] as { chordProContent: string }).chordProContent.split('\n')[3]).toBe('{cc: Switch sound}')
  })
})

describe('TimelineEditor in portrait (full screen, taller than wide)', () => {
  it('keeps time running left to right; the lanes are stacked and share the height', () => {
    box.width = 800
    box.height = 1100
    setup({ beatGrid, fill: true })
    const [audio, gridLane] = [...screen.getByTestId('timeline-lanes').querySelectorAll('canvas')]
    // Waveform: full width, 40 % of (1100 - 26 - 28 - 44 - 44) px high; the grid lane below it.
    expect(audio!.style.width).toBe('800px')
    expect(audio!.style.height).toBe('383px')
    expect(gridLane!.style.top).toBe('383px')
    box.width = 1000
    box.height = 206
  })
})

describe('tapping lines (#325)', () => {
  const song = ['{part: Verse}', 'First line', 'Second line', 'Third line', 'Fourth line'].join('\n')

  it('opens straight into line tapping, shows the context, undoes taps by button and key', () => {
    trackClock.isPlaying = true
    setup({ content: song, trackSrc: 'blob:track', startLineTapping: true })
    const panel = screen.getByTestId('tap-lines-panel')
    expect(panel.textContent).toContain('→ First line')
    expect(screen.getByText('Letzte Zeile zurück')).toBeDisabled()

    const tapButton = screen.getByText('TIPP')
    fireEvent.pointerDown(tapButton)
    fireEvent.pointerDown(tapButton)
    expect(panel.textContent).toContain('✓ Second line')
    expect(panel.textContent).toContain('→ Third line')
    expect(panel.textContent).toContain('Fourth line')

    fireEvent.click(screen.getByText('Letzte Zeile zurück'))
    expect(panel.textContent).toContain('→ Second line')

    // Space taps (instead of toggling playback), ArrowUp undoes.
    const timeline = screen.getByLabelText('Timeline')
    fireEvent.keyDown(timeline, { key: ' ' })
    expect(trackClock.togglePlay).not.toHaveBeenCalled()
    expect(panel.textContent).toContain('→ Third line')
    fireEvent.keyDown(timeline, { key: 'ArrowUp' })
    expect(panel.textContent).toContain('→ Second line')
    trackClock.isPlaying = false
  })

  it('"Zurück + 4 s" undoes the last tap and replays from before it', () => {
    trackClock.isPlaying = true
    setup({ content: song, trackSrc: 'blob:track', startLineTapping: true })
    trackClock.ref.current!.currentTime = 30
    fireEvent.pointerDown(screen.getByText('TIPP'))
    const panel = screen.getByTestId('tap-lines-panel')
    expect(panel.textContent).toContain('→ Second line')

    fireEvent.keyDown(screen.getByLabelText('Timeline'), { key: 'ArrowLeft' })
    expect(panel.textContent).toContain('→ First line')
    // The tap was at the clock's 0 ms here, so playback goes back to the start (never below 0).
    expect(trackClock.ref.current!.currentTime).toBe(0)
    trackClock.isPlaying = false
  })
})
