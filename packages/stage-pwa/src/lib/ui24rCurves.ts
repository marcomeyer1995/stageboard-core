/**
 * The Soundcraft Ui24R's fader taper - dB <-> linear 0..1 fader position.
 *
 * None of this is officially published by Harman/Soundcraft. Ported, with permission
 * granted by its MIT license, from `fmalcher/soundcraft-ui`'s
 * `value-converters.ts` (`faderToLinearAmplitude`/`DBToFaderValue`/`faderValueToDB`) via
 * `~/Device Emulators/Soundcraft UI24R Emulator/ui24r_emulator/curves.py` - the magic
 * polynomial/exponential coefficients are that community project's own curve-fit of the
 * real mixer's fader taper, not derived from any spec. Cross-checked against the Python
 * emulator's own `db_to_fader_value()` for 11 values spanning -200..10 dB (all matched
 * exactly) before this port was used in `ui24rTranslator.ts` - same discipline
 * cq18tTranslator.ts's `LEVEL_TABLE` transcription used.
 */

const FADER_MAX_DB = 10.0

function faderToLinearAmplitude(v: number): number {
  const poly =
    (23.90844819639692 + (-26.23877598214595 + (12.195249692570245 - 0.4878099877028098 * v) * v) * v) * v
  const sinePart = v < 0.055 ? Math.sin(28.559933214452666 * v) : 1.0
  return sinePart * Math.exp(poly) * 2.676529517952372e-4
}

function faderToLinearAmplitudeDeriv(v: number): number {
  const poly =
    (23.90844819639692 + (-26.23877598214595 + (12.195249692570245 - 0.4878099877028098 * v) * v) * v) * v
  const polyPrime = 23.90844819639692 + (-52.4775519642919 + (36.58574907771074 - 1.9512399508112392 * v) * v) * v
  const expPoly = Math.exp(poly)

  if (v < 0.055) {
    const wv = 28.559933214452666 * v
    return 2.676529517952372e-4 * expPoly * (28.559933214452666 * Math.cos(wv) + Math.sin(wv) * polyPrime)
  }
  return 2.676529517952372e-4 * expPoly * polyPrime
}

/** dB (-Infinity..10) -> linear fader position (0..1), via 20 iterations of Newton's
 * method numerically inverting `faderToLinearAmplitude` - matching the reference
 * implementation exactly rather than using a closed-form inverse. */
export function dbToFaderValue(dbValue: number): number {
  if (dbValue <= -200) return 0.0
  if (dbValue >= FADER_MAX_DB) return 1.0

  const target = 10 ** (dbValue / 20)

  let v = 0.5
  for (let i = 0; i < 20; i++) {
    const delta = (faderToLinearAmplitude(v) - target) / faderToLinearAmplitudeDeriv(v)
    v -= delta
    if (v < 0) v = 1e-10
    if (v > 1) v = 1.0
    if (Math.abs(delta) < 1e-15) break
  }
  return Math.round(v * 1e11) / 1e11
}
