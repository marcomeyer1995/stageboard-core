import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { PrepTier } from './PrepTier'

describe('PrepTier (docs/15 D10, 2026-10-16)', () => {
  it('controls without a size are 40 px with a 48 px hit area inside, 48 px outside; an explicit size wins', () => {
    render(
      <>
        <Button>Draußen</Button>
        <PrepTier>
          <Button>Drinnen</Button>
          <Button size="stage">Groß</Button>
          <PrepTier on={false}>
            <Button>Schublade</Button>
          </PrepTier>
        </PrepTier>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Draußen' })).toHaveClass('min-h-form')
    expect(screen.getByRole('button', { name: 'Drinnen' })).toHaveClass('min-h-prep', 'sb-hit')
    expect(screen.getByRole('button', { name: 'Groß' })).toHaveClass('min-h-stage')
    expect(screen.getByRole('button', { name: 'Schublade' })).toHaveClass('min-h-form')
    expect(screen.getByRole('button', { name: 'Drinnen' }).closest('.sb-prep')).not.toBeNull()
  })
})
