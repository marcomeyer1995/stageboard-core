import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStageServerStore } from '../store/useStageServerStore'
import { getAutomaticStageServerUrl, getStageServerUrl, normalizeStageServerUrl, overrideForTypedUrl } from './stageServer'

// Under Vitest `import.meta.env.DEV` is true, so the automatic address is the build-time
// VITE_STAGE_SERVER_URL - pinned here so the tests don't depend on the local .env.
beforeEach(() => {
  vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stageboard.local')
  useStageServerStore.setState({ url: null })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getStageServerUrl', () => {
  it('uses the automatic address when no override is set', () => {
    expect(getAutomaticStageServerUrl()).toBe('https://stageboard.local')
    expect(getStageServerUrl()).toBe('https://stageboard.local')
  })

  it('prefers a manual override', () => {
    useStageServerStore.setState({ url: 'https://192.168.178.99' })
    expect(getStageServerUrl()).toBe('https://192.168.178.99')
  })
})

describe('normalizeStageServerUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeStageServerUrl('  https://stageboard.local//  ')).toBe('https://stageboard.local')
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
