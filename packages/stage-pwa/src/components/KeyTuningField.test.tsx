import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { KeyTuningField, keyTuningSummary, type KeyTuningValue } from './KeyTuningField'

function Harness({ initial }: { initial: KeyTuningValue }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <KeyTuningField value={value} onChange={(next) => setValue({ ...value, ...next })} />
      <output data-testid="stored">{JSON.stringify({ transpose: value.transpose, tuningSpec: value.tuningSpec })}</output>
    </>
  )
}

const SONG: KeyTuningValue = { key: 'G', chordProContent: '[G]Hello [C]world' }
const stored = () => JSON.parse(screen.getByTestId('stored').textContent ?? '{}') as Record<string, unknown>
const dialog = () => screen.getByRole('dialog')

describe('KeyTuningField - Tonart & Stimmung by intent (Marco, 2026-10-18)', () => {
  it('Umstimmen moves tuning and sound together - the chords on the sheet stay', () => {
    render(<Harness initial={SONG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ändern…' }))
    fireEvent.click(screen.getByLabelText('Umstimmen tiefer'))

    expect(stored()).toEqual({ transpose: -1, tuningSpec: { semitones: -1 } })
    expect(within(dialog()).getByText('G · C')).toBeInTheDocument()
    expect(within(dialog()).getByText(/Klingt in Gb \(−1\) · Stimmung ½ Ton tiefer \(Eb\) · Akkorde wie notiert/)).toBeInTheDocument()
  })

  it('Akkorde verschieben moves chords and sound - the tuning stays', () => {
    render(<Harness initial={SONG} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ändern…' }))
    fireEvent.click(screen.getByLabelText('Akkorde verschieben tiefer'))
    fireEvent.click(screen.getByLabelText('Akkorde verschieben tiefer'))

    expect(stored()).toEqual({ transpose: -2 })
    expect(within(dialog()).getByText('G → F · C → Bb')).toBeInTheDocument()
  })

  it('Drop changes neither chords nor key, and "Zurück zum Original" clears it all', () => {
    render(<Harness initial={{ ...SONG, transpose: -1, tuningSpec: { semitones: -1 } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ändern…' }))
    fireEvent.change(within(dialog()).getByLabelText('Saiten'), { target: { value: 'drop' } })
    expect(stored()).toEqual({ transpose: -1, tuningSpec: { semitones: -1, drop: true } })

    fireEvent.click(screen.getByRole('button', { name: 'Zurück zum Original' }))
    expect(stored()).toEqual({})
  })

  it('reads the stage result in one line', () => {
    expect(keyTuningSummary(SONG)).toBe('Klingt wie das Original (G) · Stimmung Standard · Akkorde wie notiert')
    expect(keyTuningSummary({ ...SONG, transpose: -2, tuningSpec: { semitones: -1 } })).toBe('Klingt in F (−2) · Stimmung ½ Ton tiefer (Eb) · Akkorde −1')
  })
})
