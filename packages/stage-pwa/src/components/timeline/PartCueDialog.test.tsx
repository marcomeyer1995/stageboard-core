import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { describeCuePattern, PartCueDialog } from './PartCueDialog'

const band = [['{name}', '', '', '']]

describe('PartCueDialog (#63 step 2)', () => {
  it('Standard shows the band pattern in words and saves null', () => {
    const onSave = vi.fn()
    render(<PartCueDialog name="Refrää" own={null} bandPattern={band} countIn={false} onSave={onSave} onClose={() => {}} />)
    expect(screen.getByText('Refrää – – –')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('Stumm saves an empty pattern, Eigenes Muster starts from the band pattern', () => {
    const onSave = vi.fn()
    render(<PartCueDialog name="Chorus" own={null} bandPattern={band} countIn={false} onSave={onSave} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Stumm' }))
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(onSave).toHaveBeenLastCalledWith([['']])
    fireEvent.click(screen.getByRole('radio', { name: 'Eigenes Muster' }))
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    expect(onSave).toHaveBeenLastCalledWith(band)
  })

  it('describes a pattern: name, beat numbers, words', () => {
    expect(
      describeCuePattern(
        [
          ['{name}', '', 'Los', ''],
          ['#', '#', '#', '#'],
        ],
        'Bridge',
      ),
    ).toBe('Bridge – Los – | 1 2 3 4')
  })
})
