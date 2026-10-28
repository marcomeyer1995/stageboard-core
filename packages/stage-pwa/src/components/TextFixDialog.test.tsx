import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TextFixOffer } from '../lib/variantTextFix'
import { TextFixDialog } from './TextFixDialog'

const offers = [
  {
    before: 'Always I know',
    after: 'Always I knew',
    targets: [
      { variantId: 'orig', variantLabel: 'Original', lineIndex: 4 },
      { variantId: 'acoustic', variantLabel: 'Akustik', lineIndex: 6 },
    ],
  },
] as unknown as TextFixOffer[]

describe('TextFixDialog (#600)', () => {
  it('"Alle auswählen" ticks every variant at once and clears them again (Marco, 2026-10-28)', () => {
    const onSave = vi.fn()
    render(<TextFixDialog offers={offers} onSave={onSave} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Alle auswählen'))
    expect(screen.getByRole('button', { name: 'Speichern + 2 Änderungen' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Alle auswählen'))
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Alle auswählen'))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern + 2 Änderungen' }))
    expect(onSave).toHaveBeenCalledWith([
      { offer: 0, target: 0 },
      { offer: 0, target: 1 },
    ])
  })

  it('no "Alle auswählen" for a single variant', () => {
    render(<TextFixDialog offers={[{ ...offers[0]!, targets: offers[0]!.targets.slice(0, 1) }]} onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('Alle auswählen')).not.toBeInTheDocument()
  })
})
