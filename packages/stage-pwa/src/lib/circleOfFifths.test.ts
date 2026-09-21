import { describe, expect, it } from 'vitest'
import { circleLabel, describeSignature, keyName, keyRelations, signatureAccidentals, wedgeCentre, wedgePath } from './circleOfFifths'

describe('keyRelations', () => {
  it('finds C major\'s relative minor, dominant and subdominant (the issue\'s acceptance example)', () => {
    const relations = keyRelations({ ring: 'major', index: 0 })
    expect(circleLabel(relations.relative, 'sharp')).toBe('Am')
    expect(circleLabel(relations.dominant, 'sharp')).toBe('G')
    expect(circleLabel(relations.subdominant, 'sharp')).toBe('F')
  })

  it('goes the other way from a minor key', () => {
    const relations = keyRelations({ ring: 'minor', index: 0 }) // A minor
    expect(circleLabel(relations.relative, 'sharp')).toBe('C')
    expect(circleLabel(relations.dominant, 'sharp')).toBe('Em')
    expect(circleLabel(relations.subdominant, 'sharp')).toBe('Dm')
  })

  it('wraps around the top of the wheel', () => {
    expect(keyRelations({ ring: 'major', index: 11 }).dominant.index).toBe(0) // F -> C
    expect(keyRelations({ ring: 'major', index: 0 }).subdominant.index).toBe(11) // C -> F
  })

  it('keeps every relative pair on the same slice: relative keys share a signature', () => {
    for (let index = 0; index < 12; index++) {
      const { relative } = keyRelations({ ring: 'major', index })
      expect(signatureAccidentals(relative.index, 'sharp')).toBe(signatureAccidentals(index, 'sharp'))
    }
  })
})

describe('circleLabel', () => {
  it('spells the ambiguous slices per naming', () => {
    expect(circleLabel({ ring: 'major', index: 6 }, 'sharp')).toBe('F#')
    expect(circleLabel({ ring: 'major', index: 6 }, 'flat')).toBe('Gb')
    expect(circleLabel({ ring: 'minor', index: 6 }, 'sharp')).toBe('D#m')
    expect(circleLabel({ ring: 'minor', index: 6 }, 'flat')).toBe('Ebm')
  })

  it('lists the twelve majors in fifths and their relative minors', () => {
    const majors = Array.from({ length: 12 }, (_, index) => circleLabel({ ring: 'major', index }, 'flat'))
    expect(majors).toEqual(['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'])
    const minors = Array.from({ length: 12 }, (_, index) => circleLabel({ ring: 'minor', index }, 'flat'))
    expect(minors).toEqual(['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'])
  })
})

describe('key signature', () => {
  it('counts sharps clockwise and flats counter-clockwise', () => {
    expect(describeSignature(0, 'sharp')).toBe('keine Vorzeichen')
    expect(describeSignature(1, 'sharp')).toBe('1 ♯') // G
    expect(describeSignature(11, 'flat')).toBe('1 ♭') // F
    expect(describeSignature(9, 'flat')).toBe('3 ♭') // Eb
    expect(describeSignature(6, 'sharp')).toBe('6 ♯') // F#
    expect(describeSignature(6, 'flat')).toBe('6 ♭') // Gb
    expect(describeSignature(7, 'sharp')).toBe('7 ♯') // C#
    expect(describeSignature(7, 'flat')).toBe('5 ♭') // Db
  })
})

describe('wedge geometry', () => {
  it('draws a closed ring segment and puts twelve labels around the wheel', () => {
    expect(wedgePath(100, 100, 40, 80, 0)).toMatch(/^M .* A 80 80 0 0 1 .* L .* A 40 40 0 0 0 .* Z$/)
    const top = wedgeCentre(100, 100, 60, 0)
    expect(top.x).toBeCloseTo(100)
    expect(top.y).toBeCloseTo(40)
    const bottom = wedgeCentre(100, 100, 60, 6)
    expect(bottom.y).toBeCloseTo(160)
  })
})

describe('keyName', () => {
  it('names a slice as a German key', () => {
    expect(keyName({ ring: 'major', index: 0 }, 'sharp')).toBe('C-Dur')
    expect(keyName({ ring: 'minor', index: 0 }, 'sharp')).toBe('A-Moll')
    expect(keyName({ ring: 'minor', index: 6 }, 'flat')).toBe('Eb-Moll')
  })
})
