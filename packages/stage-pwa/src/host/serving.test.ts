import { describe, expect, it } from 'vitest'
import { createServing } from './serving'

const serving = (over: { founded?: string[]; active?: string | null; lease?: boolean }) =>
  createServing({ founded: () => new Set(over.founded ?? []), activeBand: () => over.active ?? null, leaseActive: () => over.lease ?? false })

describe('createServing (#962)', () => {
  it('serves a band it founded without any lease - also when it is the active band', () => {
    expect(serving({ founded: ['a'], active: 'a', lease: false })('a')).toBe(true)
    expect(serving({ founded: ['a'], lease: false })('a')).toBe(true)
  })

  it('serves a band it only joined while the lease makes it the host, and not otherwise', () => {
    expect(serving({ active: 'b', lease: true })('b')).toBe(true)
    expect(serving({ active: 'b', lease: false })('b')).toBe(false)
  })

  it('never serves a band it neither founded nor holds as the active one', () => {
    expect(serving({ founded: ['a'], active: 'b', lease: true })('c')).toBe(false)
  })

  it('with no band named (audio), serves when it holds a founded band or is the band host by the lease', () => {
    expect(serving({ founded: ['a'] })()).toBe(true)
    expect(serving({ active: 'b', lease: true })()).toBe(true)
    expect(serving({ active: 'b', lease: false })()).toBe(false)
    expect(serving({})()).toBe(false)
  })
})
