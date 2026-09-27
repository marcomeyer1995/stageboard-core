import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BeatAnchor } from 'shared-types'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
vi.mock('../../lib/useElementSize', () => ({ useElementSize: () => [() => {}, { width: 1000, height: 206 }] }))
vi.mock('../../lib/trackAnalysis', () => ({ loadTrackAnalysis: vi.fn(async () => null) }))
vi.mock('../../lib/clickEngine', () => ({ startClick: vi.fn(), stopClick: vi.fn() }))

const { TimelineEditor } = await import('./TimelineEditor')

// 32 beats at 120 BPM from 1 s; the stored beat numbers start on "beat 1" at 1 s.
const anchors: BeatAnchor[] = Array.from({ length: 32 }, (_, i) => ({ id: `a${i}`, timeMs: 1000 + i * 500, beatInBar: i % 4 }))

function setup() {
  const onChange = vi.fn()
  const utils = render(
    <TimelineEditor
      variantId="v"
      trackId={null}
      trackSrc={null}
      anchors={anchors}
      tempoMarkers={[]}
      bpm={120}
      timeSignature="4/4"
      countInEnabled={false}
      countInBars={1}
      onChange={onChange}
      onAdoptBpm={vi.fn()}
    />,
  )
  return { onChange, ...utils }
}

/** Taps the grid lane at song time `ms` (the view fits the song: 20.5 ms per px). */
function tapGridAt(ms: number) {
  const lanes = screen.getByTestId('timeline-lanes')
  const x = ms / 20.5
  fireEvent.pointerDown(lanes, { pointerId: 1, clientX: x, clientY: 150 })
  fireEvent.pointerUp(lanes, { pointerId: 1, clientX: x, clientY: 150 })
}

describe('TimelineEditor (docs/14, phase 1)', () => {
  it('selects a beat on tap and makes it beat 1 as a fixed anchor', () => {
    const { onChange } = setup()
    tapGridAt(3000) // 1000 + 4 x 500 ms: the downbeat of bar 2
    expect(screen.getByText(/Takt 2, Schlag 1/)).toBeInTheDocument()
    tapGridAt(2000) // beat 3 of bar 1
    expect(screen.getByText(/Takt 1, Schlag 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Hier ist die Eins'))
    const patch = onChange.mock.calls[0]![0] as { beatAnchors: BeatAnchor[] }
    expect(patch.beatAnchors.find((a) => a.pinned)).toEqual(expect.objectContaining({ timeMs: 2000, beatInBar: 0, pinned: true }))
  })

  it('nudges the selected beat by 10 ms and can undo it', () => {
    const { onChange, rerender } = setup()
    tapGridAt(3000)
    fireEvent.click(screen.getByText('+10 ms'))
    const nudged = (onChange.mock.calls[0]![0] as { beatAnchors: BeatAnchor[] }).beatAnchors
    expect(nudged.find((a) => a.pinned)).toEqual(expect.objectContaining({ timeMs: 3010 }))
    rerender(
      <TimelineEditor
        variantId="v"
        trackId={null}
        trackSrc={null}
        anchors={nudged}
        tempoMarkers={[]}
        bpm={120}
        timeSignature="4/4"
        countInEnabled={false}
        countInBars={1}
        onChange={onChange}
        onAdoptBpm={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText('Rückgängig'))
    expect(onChange).toHaveBeenLastCalledWith({ beatAnchors: anchors, tempoMarkers: [] })
  })

  it('starts a tempo section at the selected beat', () => {
    const { onChange } = setup()
    tapGridAt(5000)
    fireEvent.click(screen.getByText('Abschnitt ab hier'))
    const patch = onChange.mock.calls[0]![0] as { tempoMarkers: { timeMs: number; bpm: number }[] }
    expect(patch.tempoMarkers).toEqual([expect.objectContaining({ timeMs: 5000, bpm: 120 })])
  })
})
