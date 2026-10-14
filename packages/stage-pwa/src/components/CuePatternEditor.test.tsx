import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CuePatternEditor, PART_CUE_PRESETS, samePattern } from './CuePatternEditor'

describe('CuePatternEditor (#63)', () => {
  it('shows the matching preset, and a tapped cell takes the picked value', () => {
    const onChange = vi.fn()
    render(<CuePatternEditor label="Muster" pattern={[['{name}', '', '', '']]} presets={PART_CUE_PRESETS} onChange={onChange} />)
    expect((screen.getByLabelText('Muster') as HTMLSelectElement).value).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: 'Takt 1, Schlag 3: –' }))
    fireEvent.click(screen.getByRole('button', { name: /Zahl des Schlags/ }))
    expect(onChange).toHaveBeenCalledWith([['{name}', '', '#']])
  })

  it('an own pattern shows as "Eigenes Muster"; trailing empty cells do not matter', () => {
    render(<CuePatternEditor label="Muster" pattern={[['Achtung', '', '', '']]} presets={PART_CUE_PRESETS} onChange={() => {}} />)
    expect((screen.getByLabelText('Muster') as HTMLSelectElement).value).toBe('own')
    expect(samePattern([['{name}']], [['{name}', '', '', '']])).toBe(true)
  })
})
