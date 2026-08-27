import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ChordProLine } from '../lib/chordpro'
import { ChordProLyrics } from './ChordProLyrics'

const lines: ChordProLine[] = [
  { timeMs: null, segments: [{ chord: 'G', text: 'Hello ' }, { chord: 'C', text: 'world' }], partIndex: 0, partLabel: 'Verse 1' },
  { timeMs: null, segments: [{ chord: null, text: 'no chords on this line' }], partIndex: 0, partLabel: 'Verse 1' },
  { timeMs: null, segments: [{ chord: 'Am', text: 'Chorus line' }], partIndex: 1, partLabel: 'Chorus' },
]

describe('ChordProLyrics', () => {
  it('shows a placeholder for an empty song', () => {
    render(<ChordProLyrics lines={[]} />)
    expect(screen.getByText('Kein Text.')).toBeInTheDocument()
  })

  it('renders one part label per part, not once per line', () => {
    render(<ChordProLyrics lines={lines} />)
    expect(screen.getAllByText('Verse 1')).toHaveLength(1)
    expect(screen.getByText('Chorus')).toBeInTheDocument()
  })

  it('hides part labels when hidePartLabels is set (Paginated View already shows them)', () => {
    render(<ChordProLyrics lines={lines} hidePartLabels />)
    expect(screen.queryByText('Verse 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Chorus')).not.toBeInTheDocument()
  })

  it('renders each chord as its own element positioned before the segment text', () => {
    render(<ChordProLyrics lines={lines} />)

    const chordEl = screen.getByText('G')
    expect(chordEl.tagName).toBe('SPAN')
    expect(chordEl.className).toContain('text-accent')

    // The chord and its text share one wrapper <span>, so the wrapper's full text is the
    // chord immediately followed by the lyric text - "Gello" would mean the DOM order broke.
    expect(chordEl.parentElement?.textContent).toBe('GHello ')
  })

  it('gives a chord-less segment no chord element, only its text', () => {
    render(<ChordProLyrics lines={lines} />)
    const line = screen.getByText('no chords on this line')
    expect(line.querySelector('span')).toBeNull()
  })

  it('tags each rendered line with its absolute index, offset by startIndex', () => {
    const { container } = render(<ChordProLyrics lines={lines} startIndex={5} />)
    const indexed = container.querySelectorAll('[data-line-index]')
    expect(Array.from(indexed).map((el) => el.getAttribute('data-line-index'))).toEqual(['5', '6', '7'])
  })

  it('highlights only the active line', () => {
    const { container } = render(<ChordProLyrics lines={lines} activeIndex={1} />)
    expect(container.querySelector('[data-line-index="0"]')).not.toHaveClass('bg-accent-2/20')
    expect(container.querySelector('[data-line-index="1"]')).toHaveClass('bg-accent-2/20')
    expect(container.querySelector('[data-line-index="2"]')).not.toHaveClass('bg-accent-2/20')
  })
})
