import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/showMode', () => ({ useShowMode: () => ({ mode: 'gig' }) }))
vi.mock('../lib/useCapabilityRouting', () => ({ useCapabilityRouting: () => ({ engine: 'remote' }) }))
vi.mock('../components/MixFaders', () => ({ MixFaders: () => <div data-testid="faders" /> }))

const { AudioMixWidget } = await import('./AudioMixWidget')

describe('AudioMixWidget', () => {
  it('keeps the Gig hint outside the faders\' area - the faders measure only what is left, so they no longer run under it (2026-10-17)', () => {
    render(<AudioMixWidget config={{}} />)
    const hint = screen.getByText(/Im Gig spielt dieses Gerät keinen Ton/)
    const faderArea = screen.getByTestId('faders').parentElement!
    expect(faderArea).not.toContainElement(hint)
    expect(faderArea).toHaveClass('flex-1', 'min-h-0')
    expect(hint).toHaveClass('flex-shrink-0')
  })
})
