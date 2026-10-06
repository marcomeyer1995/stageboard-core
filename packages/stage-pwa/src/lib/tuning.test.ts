import { describe, expect, it } from 'vitest'
import { isStandardTuning } from './tuning'

describe('isStandardTuning (#410)', () => {
  it('recognizes the usual spellings of standard tuning', () => {
    for (const t of ['E A D G B E', 'EADGBe', 'e a d g b e', 'Standard', 'E Standard', 'Standard (E A D G B E)', '', undefined]) {
      expect(isStandardTuning(t)).toBe(true)
    }
  })
  it('keeps everything else', () => {
    for (const t of ['Drop D', 'D A D G B E', 'Eb Ab Db Gb Bb Eb', 'Half step down', 'DADGAD']) {
      expect(isStandardTuning(t)).toBe(false)
    }
  })
})
