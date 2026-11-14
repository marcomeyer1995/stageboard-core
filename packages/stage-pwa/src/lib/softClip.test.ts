import { describe, expect, it } from 'vitest'
import { SOFT_CLIP_KNEE, softClipCurve } from './nativeOutput'

// The WaveShaper reads the curve over input -1 … 1; the master halves the mix first, so curve
// point i stands for a mix value of (i / (n - 1)) * 4 - 2.
const at = (curve: Float32Array, mix: number) => curve[Math.round(((mix + 2) / 4) * (curve.length - 1))]!

describe('soft clipper on the WebView output (#835)', () => {
  const curve = softClipCurve()

  it('leaves the mix untouched below the knee', () => {
    for (const v of [0, 0.1, -0.3, 0.5, -SOFT_CLIP_KNEE]) expect(at(curve, v)).toBeCloseTo(v, 2)
  })

  it('rounds off above it, never reaching full scale - also at 200 %', () => {
    expect(at(curve, 1)).toBeLessThan(1)
    expect(at(curve, 1)).toBeGreaterThan(SOFT_CLIP_KNEE)
    expect(at(curve, 2)).toBeLessThan(1)
    expect(at(curve, -2)).toBeGreaterThan(-1)
  })

  it('rises steadily, without a step', () => {
    let step = 0
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!)
      step = Math.max(step, curve[i]! - curve[i - 1]!)
    }
    expect(step).toBeLessThan(0.003)
  })
})
