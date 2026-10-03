import { describe, expect, it } from 'vitest'
import { isNativeApp, shortFingerprint } from './native'

describe('native app helpers (#348)', () => {
  it('is the browser in tests', () => {
    expect(isNativeApp()).toBe(false)
  })

  it('shows the first 8 bytes of a fingerprint for comparing by eye', () => {
    expect(shortFingerprint('0447f3e8fd0f1fd42a4c52086ff133d33a1c7f1bcae81a8633efc3e5ef454951')).toBe('04 47 F3 E8 FD 0F 1F D4')
  })
})
