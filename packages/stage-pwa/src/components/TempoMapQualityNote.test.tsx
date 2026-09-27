import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TempoMapQualityNote } from './TempoMapQualityNote'

// What's Up-like anchors: one per beat at ~134 BPM, a few doubled, entered as 127.5 BPM.
const period = 60000 / 134
const anchors = Array.from({ length: 64 }, (_, i) => ({ timeMs: 2000 + i * period, beatInBar: i % 4 })).flatMap((a, i) =>
  i % 16 === 5 ? [a, { timeMs: a.timeMs + 180, beatInBar: (a.beatInBar + 1) % 4 }] : [a],
)

describe('TempoMapQualityNote', () => {
  it('names the problems and offers the measured tempo', () => {
    const onAdoptBpm = vi.fn()
    render(<TempoMapQualityNote anchors={anchors} bpm={127.5} timeSignature="4/4" tempoMarkers={[]} onAdoptBpm={onAdoptBpm} />)
    expect(screen.getByRole('status')).toHaveTextContent('Klick-Raster: bitte prüfen')
    expect(screen.getByRole('status')).toHaveTextContent('4 doppelte Anker')
    fireEvent.click(screen.getByText('134 BPM übernehmen'))
    expect(onAdoptBpm).toHaveBeenCalledWith(134)
  })

  it('shows nothing for a song with only a lead-in anchor', () => {
    const { container } = render(
      <TempoMapQualityNote anchors={[{ timeMs: 460 }]} bpm={114} timeSignature="4/4" tempoMarkers={[]} onAdoptBpm={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
