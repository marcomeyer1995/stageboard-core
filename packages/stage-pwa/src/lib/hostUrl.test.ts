import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHostUrlStore } from '../store/useHostUrlStore'
import { getAutomaticHostUrl, getHostUrl, normalizeHostUrl, overrideForTypedUrl } from './hostUrl'

// Under Vitest `import.meta.env.DEV` is true, so the automatic address is the build-time
// VITE_HOST_URL - pinned here so the tests don't depend on the local .env.
beforeEach(() => {
  vi.stubEnv('VITE_HOST_URL', 'https://stageboard.local')
  useHostUrlStore.setState({ url: null })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getHostUrl', () => {
  it('uses the automatic address when no override is set', () => {
    expect(getAutomaticHostUrl()).toBe('https://stageboard.local')
    expect(getHostUrl()).toBe('https://stageboard.local')
  })

  it('prefers a manual override', () => {
    useHostUrlStore.setState({ url: 'https://192.168.178.99' })
    expect(getHostUrl()).toBe('https://192.168.178.99')
  })
})

describe('normalizeHostUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeHostUrl('  https://stageboard.local//  ')).toBe('https://stageboard.local')
  })
})

describe('overrideForTypedUrl', () => {
  it('treats an empty entry as automatic', () => {
    expect(overrideForTypedUrl('   ')).toBeNull()
  })

  it('treats the automatic address itself as automatic, so it is never pinned', () => {
    expect(overrideForTypedUrl('https://stageboard.local/')).toBeNull()
  })

  it('keeps a genuinely different address as an override, normalized', () => {
    expect(overrideForTypedUrl(' https://192.168.178.99/ ')).toBe('https://192.168.178.99')
  })
})
