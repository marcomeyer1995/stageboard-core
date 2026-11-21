import { describe, expect, it } from 'vitest'
import { stemRequestOf } from './stemRequest'

describe('stemRequestOf (#964)', () => {
  it('takes a model and a guitar split, and keeps the split only for the extended set', () => {
    expect(stemRequestOf({ model: 'extended', splitGuitar: true })).toEqual({ ok: true, model: 'extended', splitGuitar: true })
    expect(stemRequestOf({ model: 'standard', splitGuitar: true })).toEqual({ ok: true, model: 'standard', splitGuitar: false })
  })
  it('refuses what a view script should not be able to put into a band document', () => {
    for (const body of [null, 'x', {}, { model: 'huge', splitGuitar: false }, { model: 'standard', splitGuitar: 'yes' }]) expect(stemRequestOf(body).ok).toBe(false)
  })
})
