import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRememberedLogicalDeviceId, rememberLogicalDeviceId } from './hardwareDeviceMemory'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hardwareDeviceMemory', () => {
  it('has no memory for a key that was never remembered', () => {
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBeNull()
  })

  it('round-trips a remembered logicalDeviceId', () => {
    rememberLogicalDeviceId('webmidi:port-1', 'kemper-1')
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBe('kemper-1')
  })

  it('keeps separate keys independent', () => {
    rememberLogicalDeviceId('webmidi:port-1', 'kemper-1')
    rememberLogicalDeviceId('webusb:1:2', 'rc500-1')
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBe('kemper-1')
    expect(getRememberedLogicalDeviceId('webusb:1:2')).toBe('rc500-1')
  })

  it('overwrites an existing memory for the same key', () => {
    rememberLogicalDeviceId('webmidi:port-1', 'kemper-1')
    rememberLogicalDeviceId('webmidi:port-1', 'kemper-2')
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBe('kemper-2')
  })

  it('degrades gracefully when localStorage throws (private mode)', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => rememberLogicalDeviceId('webmidi:port-1', 'kemper-1')).not.toThrow()
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBeNull()
  })
})
