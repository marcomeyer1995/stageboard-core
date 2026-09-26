import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { parseChordPro, type ChordProLine } from '../lib/chordpro'
import { ChordProLyrics } from './ChordProLyrics'

const lines: ChordProLine[] = [
  { timeMs: null, segments: [{ chord: 'G', text: 'Hello ' }, { chord: 'C', text: 'world' }], partIndex: 0, partLabel: 'Verse 1', comment: null, commentTargets: null, tab: null },
  { timeMs: null, segments: [{ chord: null, text: 'no chords on this line' }], partIndex: 0, partLabel: 'Verse 1', comment: null, commentTargets: null, tab: null },
  { timeMs: null, segments: [{ chord: 'Am', text: 'Chorus line' }], partIndex: 1, partLabel: 'Chorus', comment: null, commentTargets: null, tab: null },
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

describe('ChordProLyrics comment lines (#215)', () => {
  const commentLines: ChordProLine[] = [
    { timeMs: null, segments: [{ chord: null, text: 'Regular lyric' }], partIndex: 0, partLabel: null, comment: null, commentTargets: null, tab: null },
    { timeMs: null, segments: [], partIndex: 0, partLabel: null, comment: 'Play softer here', commentTargets: null, tab: null },
  ]

  it('renders a comment line by its text, distinct from a lyric line', () => {
    render(<ChordProLyrics lines={commentLines} />)
    const commentEl = screen.getByText('Play softer here')
    expect(commentEl.className).toContain('italic')
    expect(commentEl.className).not.toContain('font-sb-mono')
  })

  it('gives a comment line no chord segments', () => {
    const { container } = render(<ChordProLyrics lines={commentLines} />)
    const commentEl = container.querySelector('[data-line-index="1"]')
    expect(commentEl?.querySelector('.text-accent')).toBeNull()
  })

  it('sizes a comment line from commentFontSize, independent of chordFontSize', () => {
    render(<ChordProLyrics lines={commentLines} chordFontSize={99} commentFontSize={42} />)
    expect(screen.getByText('Play softer here')).toHaveStyle({ fontSize: '42px' })
  })

  it('renders a tab block verbatim in a non-wrapping, scrollable monospace block', () => {
    const { container } = render(
      <ChordProLyrics
        lines={[{ timeMs: null, segments: [], partIndex: 0, partLabel: null, comment: null, commentTargets: null, tab: { label: 'Riff', lines: ['e|---5-2---|', 'B|-3-----3-|'] } }]}
      />,
    )
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('e|---5-2---|\nB|-3-----3-|')
    expect(pre?.parentElement?.className).toContain('overflow-x-auto')
    expect(screen.getByText('Riff')).toBeInTheDocument()
  })

  it('gives a line-end chord a line-height segment (zero-width space), so it sits above the lyric like the others', () => {
    const { container } = render(
      <ChordProLyrics
        lines={[{ timeMs: null, segments: [{ chord: 'G', text: 'All the small things' }, { chord: 'F', text: '' }], partIndex: 0, partLabel: null, comment: null, commentTargets: null, tab: null }]}
      />,
    )
    const segments = [...container.querySelectorAll('p[data-line-index] > span')]
    expect(segments).toHaveLength(2)
    // jsdom does no layout - what matters is that the empty segment is no longer empty: a
    // zero-width space for the line height, plus an invisible copy of the chord for its width.
    expect(segments[1].textContent).toBe('F\u200BF')
    const spacer = segments[1].querySelector('[aria-hidden="true"]')
    expect(spacer?.className).toContain('invisible')
    expect(segments[0].textContent).toBe('GAll the small things')
  })

  it('gives every line-end chord its own width, so "D#5 C#m7 B" stand side by side', () => {
    const { container } = render(<ChordProLyrics lines={parseChordPro("[E]We're not gonna take it anymore[D#5][C#m7][B]")} />)
    const spacers = [...container.querySelectorAll('[aria-hidden="true"]')].map((s) => s.textContent)
    expect(spacers).toEqual(['D#5', 'C#m7', 'B'])
  })

  it('keeps chords inside the line box: chords above via bottom-full, room reserved on top of the line', () => {
    const { container } = render(<ChordProLyrics lines={parseChordPro('[G]Hello')} />)
    const line = container.querySelector('p[data-line-index]') as HTMLElement
    expect(line.style.paddingTop).toBe('0.85em')
    expect(line.querySelector('span.absolute')?.className).toContain('bottom-full')
  })

  it('sizes the reserved room from the prompter\'s own chord size, and none for a line without chords', () => {
    const { container } = render(<ChordProLyrics lines={parseChordPro('[G]Hello\nno chords here')} chordFontSize={20} />)
    const [withChords, without] = [...container.querySelectorAll('p[data-line-index]')] as HTMLElement[]
    expect(withChords.style.paddingTop).toBe('24px')
    expect(without.style.paddingTop).toBe('')
  })

  describe('instrumental chord rows render inline, lyric lines keep chords above', () => {
    /** Renders one line parsed from ChordPro and reports whether its chords sit inline. */
    function chordsInline(source: string): boolean {
      const { container, unmount } = render(<ChordProLyrics lines={parseChordPro(source)} />)
      const line = container.querySelector('p[data-line-index]')!
      const floating = line.querySelectorAll('span.absolute').length
      unmount()
      return floating === 0
    }

    it.each([
      ['| [C]   | [F]   | [G]   | [G]   |', 'bar notation'],
      ['[Em] [C] [G] [D/F#]  x4', 'chord row with a repeat mark'],
      ['[G]', 'a single chord on its own line'],
      ['[C]...[G]...', 'punctuation only (accepted borderline case)'],
    ])('inline: %s (%s)', (source) => {
      expect(chordsInline(source)).toBe(true)
    })

    it.each([
      ['[G]I', 'one sung letter'],
      ['[C]Oh [G]yeah', 'ordinary lyric'],
      ['[C]Ärger', 'non-ASCII letter'],
      ['[C]1 2 3 4', 'counting (digits count as text)'],
    ])('chords above: %s (%s)', (source) => {
      expect(chordsInline(source)).toBe(false)
    })

    it('leaves a bar line without any chord as plain text', () => {
      const { container } = render(<ChordProLyrics lines={parseChordPro('|    |    |')} />)
      expect(container.querySelector('p[data-line-index]')?.textContent).toBe('|    |    |')
      expect(container.querySelectorAll('.text-accent')).toHaveLength(0)
    })

    it('keeps the original columns: chord names occupy width between the bars', () => {
      const { container } = render(<ChordProLyrics lines={parseChordPro('| [C]   | [F]   |')} />)
      expect(container.querySelector('p[data-line-index]')?.textContent).toBe('| C   | F   |')
    })
  })
})
