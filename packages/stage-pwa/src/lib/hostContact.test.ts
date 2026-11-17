import { describe, expect, it } from 'vitest'
import { HOST_GONE_MS, HOST_UNREACHABLE_MS, hostStatus, useHostContactStore } from './hostContact'

describe('hostStatus (#782)', () => {
  const T = 1_000_000

  it('is ok while the host answered recently', () => {
    expect(hostStatus(true, T, T + HOST_UNREACHABLE_MS - 1)).toBe('ok')
  })

  it('is unreachable after a few missed answers, gone after 15 s', () => {
    expect(hostStatus(true, T, T + HOST_UNREACHABLE_MS)).toBe('unreachable')
    expect(hostStatus(true, T, T + HOST_GONE_MS - 1)).toBe('unreachable')
    expect(hostStatus(true, T, T + HOST_GONE_MS)).toBe('gone')
  })

  it('never misses a host when the band has no Stage-Server (local-only, Solo)', () => {
    expect(hostStatus(false, T, T + 10 * HOST_GONE_MS)).toBe('ok')
  })

  it('an answer resets the age', () => {
    useHostContactStore.setState({ lastContactAt: 0 })
    useHostContactStore.getState().markContact()
    expect(Date.now() - useHostContactStore.getState().lastContactAt).toBeLessThan(1_000)
  })
})
