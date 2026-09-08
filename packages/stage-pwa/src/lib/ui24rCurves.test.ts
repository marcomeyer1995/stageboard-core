import { describe, expect, it } from 'vitest'
import { dbToFaderValue } from './ui24rCurves'

// Reference values from the real emulator's own `curves.db_to_fader_value()`
// (~/Device Emulators/Soundcraft UI24R Emulator/ui24r_emulator/curves.py), computed via
// `python3 -c "from ui24r_emulator import curves; print(curves.db_to_fader_value(<db>))"`
// and cross-checked against this TS port before it was used in ui24rTranslator.ts.
const REFERENCE: [number, number][] = [
  [-200, 0.0],
  [-60, 0.05882352941],
  [-40, 0.18623016528],
  [-20, 0.37650583661],
  [-10, 0.52941176471],
  [-6, 0.61272849746],
  [-3, 0.68558892202],
  [0, 0.76470588235],
  [3, 0.84375627201],
  [6, 0.91653908203],
  [10, 1.0],
]

describe('dbToFaderValue', () => {
  it.each(REFERENCE)('matches the Python reference implementation at %d dB', (db, expected) => {
    expect(dbToFaderValue(db)).toBeCloseTo(expected, 8)
  })

  it('clamps below -200 dB to 0', () => {
    expect(dbToFaderValue(-300)).toBe(0)
  })

  it('clamps above 10 dB to 1', () => {
    expect(dbToFaderValue(20)).toBe(1)
  })
})
