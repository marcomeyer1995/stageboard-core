import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChordReferenceWidget } from './ChordReferenceWidget'
import type { ChordReferenceConfig } from './chordReferenceConfig'

const config: ChordReferenceConfig = { noteNaming: 'sharp', showGuitar: true, showPiano: true }

const pick = (group: string, name: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name }))

describe('ChordReferenceWidget (#24)', () => {
  it('starts on C major with its notes, intervals and both diagrams', () => {
    render(<ChordReferenceWidget config={config} />)
    expect(screen.getByTestId('chord-symbol')).toHaveTextContent('C')
    expect(screen.getByText('C E G')).toBeInTheDocument()
    expect(screen.getByText('1 3 5')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Griffbild' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Klaviatur' })).toBeInTheDocument()
  })

  it('looks up the notes of a chosen chord (the issue\'s Cmaj7 example)', () => {
    render(<ChordReferenceWidget config={config} />)
    pick('Akkordart', 'maj7')
    expect(screen.getByTestId('chord-symbol')).toHaveTextContent('Cmaj7')
    expect(screen.getByText('C E G B')).toBeInTheDocument()
    expect(screen.getByText('1 3 5 7')).toBeInTheDocument()
  })

  it('changes the root and spells it per the configured naming', () => {
    const { rerender } = render(<ChordReferenceWidget config={config} />)
    pick('Grundton', 'A#')
    pick('Akkordart', 'm7')
    expect(screen.getByTestId('chord-symbol')).toHaveTextContent('A#m7')

    rerender(<ChordReferenceWidget config={{ ...config, noteNaming: 'flat' }} />)
    expect(screen.getByTestId('chord-symbol')).toHaveTextContent('Bbm7')
    expect(screen.getByText('Bb Db F Ab')).toBeInTheDocument()
  })

  it('marks the selection as pressed', () => {
    render(<ChordReferenceWidget config={config} />)
    pick('Grundton', 'G')
    expect(within(screen.getByRole('group', { name: 'Grundton' })).getByRole('button', { name: 'G' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'Grundton' })).getByRole('button', { name: 'C' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('can hide either diagram', () => {
    render(<ChordReferenceWidget config={{ ...config, showGuitar: false }} />)
    expect(screen.queryByRole('img', { name: 'Griffbild' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Klaviatur' })).toBeInTheDocument()
  })
})
