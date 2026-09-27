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
  useDialogStore: (select: (state: object) => unknown) => select({ confirm: async () => true }),
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
