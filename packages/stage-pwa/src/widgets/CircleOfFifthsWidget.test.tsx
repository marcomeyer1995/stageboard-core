import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CircleOfFifthsWidget } from './CircleOfFifthsWidget'
import type { CircleOfFifthsConfig } from './circleOfFifthsConfig'

const config: CircleOfFifthsConfig = { noteNaming: 'sharp' }

describe('CircleOfFifthsWidget (#24)', () => {
  it('starts on C major and names its relative minor, dominant and subdominant', () => {
    render(<CircleOfFifthsWidget config={config} />)
    expect(screen.getByText('C-Dur')).toBeInTheDocument()
    expect(screen.getByText('A-Moll')).toBeInTheDocument() // Paralleltonart
    expect(screen.getByText('keine Vorzeichen')).toBeInTheDocument()
  })

  it('shows the relations of a tapped key (G major: relative Em, dominant D, subdominant C)', () => {
    render(<CircleOfFifthsWidget config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'G' }))

    expect(screen.getByText('G-Dur')).toBeInTheDocument()
    expect(screen.getByText('E-Moll')).toBeInTheDocument()
    expect(screen.getByText('1 ♯')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'G' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('works from a minor slice too: tapping Am names C major as its Paralleltonart', () => {
    render(<CircleOfFifthsWidget config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Em' }))
    fireEvent.click(screen.getByRole('button', { name: 'Am' }))

    expect(screen.getByText('A-Moll')).toBeInTheDocument()
    expect(screen.getByText('C-Dur')).toBeInTheDocument()
  })

  it('can be operated from the keyboard', () => {
    render(<CircleOfFifthsWidget config={config} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'D' }), { key: 'Enter' })
    expect(screen.getByText('D-Dur')).toBeInTheDocument()
  })

  it('reads the enharmonic slice per naming', () => {
    render(<CircleOfFifthsWidget config={{ noteNaming: 'flat' }} />)
    expect(screen.getByRole('button', { name: 'Gb' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'F#' })).not.toBeInTheDocument()
  })
})
