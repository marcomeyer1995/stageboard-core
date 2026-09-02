import { beforeEach, describe, expect, it } from 'vitest'
import { getDeviceId } from './deviceId'

beforeEach(() => {
  localStorage.clear()
})

describe('getDeviceId', () => {
  it('generates a fresh id and persists it', () => {
    const id = getDeviceId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(localStorage.getItem('stageboard-device-id')).toBe(id)
  })

  it('returns the same id on every call', () => {
    const first = getDeviceId()
    const second = getDeviceId()
    expect(second).toBe(first)
  })

  it('reuses whatever id was already stored, rather than generating a new one', () => {
    localStorage.setItem('stageboard-device-id', 'existing-id')
    expect(getDeviceId()).toBe('existing-id')
  })
})
