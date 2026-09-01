import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetInviteStoreForTests, createInvite, resolveInvite } from './inviteStore.js'

beforeEach(() => {
  __resetInviteStoreForTests()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-30T20:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createInvite / resolveInvite', () => {
  it('mints an 8-digit code that resolves back to the given workspace payload', () => {
    const { code, expiresAt } = createInvite('band-c', 'Band C')

    expect(code).toMatch(/^\d{8}$/)
    expect(expiresAt).toBeGreaterThan(Date.now())

    expect(resolveInvite(code)).toEqual({
      workspaceId: 'band-c',
      workspaceName: 'Band C',
    })
  })

  it('returns null for an unknown code', () => {
    expect(resolveInvite('00000000')).toBeNull()
  })

  it('is reusable - resolves more than once before it expires', () => {
    const { code } = createInvite('band-c', 'Band C')
    expect(resolveInvite(code)).not.toBeNull()
    expect(resolveInvite(code)).not.toBeNull()
  })

  it('stops resolving once expired', () => {
    const { code } = createInvite('band-c', 'Band C')
    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(resolveInvite(code)).toBeNull()
  })
})
