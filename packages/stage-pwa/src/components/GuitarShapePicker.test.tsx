import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { guitarShapesFor } from '../lib/guitarShapes'
import { GuitarShapePicker } from './GuitarShapePicker'

describe('GuitarShapePicker (#609, Marco 2026-10-28)', () => {
  it('shows the F as a barre and moves through its shapes with the arrows and a swipe', () => {
    const { container } = render(<GuitarShapePicker shapes={guitarShapesFor(5, 'maj')} />)
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByTestId('barre')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tieferer Griff' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Höherer Griff' }))
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getByText('8fr')).toBeInTheDocument()
    const box = container.querySelector('.touch-pan-y')!
    // A swipe right goes back down the neck, a swipe left up again.
    fireEvent.pointerDown(box, { clientX: 100, clientY: 50 })
    fireEvent.pointerUp(box, { clientX: 180, clientY: 50 })
    expect(screen.getByText('1/2')).toBeInTheDocument()
    fireEvent.pointerDown(box, { clientX: 200, clientY: 50 })
    fireEvent.pointerUp(box, { clientX: 120, clientY: 55 })
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('a single shape needs no arrows', () => {
    render(<GuitarShapePicker shapes={guitarShapesFor(5, 'maj').slice(0, 1)} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
