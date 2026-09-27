import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BeatGrid } from 'shared-types'

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
// The in-app confirm dialog answers "yes" right away.
vi.mock('../../store/useDialogStore', () => ({
  useDialogStore: (select: (state: object) => unknown) => select({ confirm: async () => true, promptFields: async () => null }),
}))

const { TimelineEditor } = await import('./TimelineEditor')

const beatGrid: BeatGrid = { points: [{ id: 'p1', bar: 1, timeMs: 1000 }, { id: 'p2', bar: 9, timeMs: 17000 }], meters: [] }

function setup(extra: { beatGrid?: BeatGrid; onDetectGrid?: () => Promise<{ bpm: number; beatGrid: BeatGrid } | null>; trackSrc?: string; fill?: boolean } = {}) {
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
      onChange={onChange}
      onDetectGrid={extra.onDetectGrid}
      fill={extra.fill}
    />,
  )
  return { onChange, ...utils }
}

describe('TimelineEditor (docs/14 §5a)', () => {
  it('clears the grid after confirming, and can undo it', async () => {
    const { onChange } = setup({ beatGrid })
    fireEvent.click(screen.getByText('Raster löschen'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ beatGrid: undefined, bpm: 120 }))
    fireEvent.click(screen.getByLabelText('Rückgängig'))
    expect(onChange).toHaveBeenLastCalledWith({ beatGrid, bpm: 120 })
  })

  it('has nothing to clear without a grid', () => {
    setup()
    expect(screen.getByText('Raster löschen')).toBeDisabled()
  })

  it('replaces the grid with a detection run, bpm included', async () => {
    const detected: BeatGrid = { points: [{ id: 'd1', bar: 1, timeMs: 800 }], meters: [] }
    const { onChange } = setup({ beatGrid, onDetectGrid: async () => ({ bpm: 121, beatGrid: detected }), trackSrc: 'blob:track' })
    fireEvent.click(screen.getByText('Track analysieren'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ bpm: 121, beatGrid: detected }))
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
    expect(onChange).toHaveBeenCalledWith({ beatGrid: { points: [expect.objectContaining({ bar: 1 })], meters: [] }, bpm: 120 })
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

describe('TimelineEditor in portrait (full screen, taller than wide)', () => {
  it('runs time downwards: the lanes become columns along the full height', () => {
    box.width = 800
    box.height = 1100
    const { container } = setup({ beatGrid, fill: true })
    const [audio, gridLane] = [...container.querySelectorAll('canvas')]
    // Audio column: 45 % of (800 - 26) px wide, as tall as the time axis.
    expect(audio!.style.width).toBe('348px')
    expect(audio!.style.height).toBe('1100px')
    expect(gridLane!.style.left).toBe('348px')
    box.width = 1000
    box.height = 206
  })
})
