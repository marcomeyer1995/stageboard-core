import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectEnvironment } from './detectEnvironment'

function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: standalone } as MediaQueryList),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  // @ts-expect-error - test-only cleanup of a property this suite adds to the real window.
  delete window.Capacitor
})

describe('detectEnvironment', () => {
  it('returns "native" when window.Capacitor is present, regardless of display-mode', () => {
    stubMatchMedia(false)
    // @ts-expect-error - a native wrapper injects this global; the actual shape doesn't matter here.
    window.Capacitor = {}

    expect(detectEnvironment()).toBe('native')
  })

  it('returns "pwa" when display-mode is standalone and no Capacitor global exists', () => {
    stubMatchMedia(true)

    expect(detectEnvironment()).toBe('pwa')
  })

  it('returns "browser" otherwise', () => {
    stubMatchMedia(false)

    expect(detectEnvironment()).toBe('browser')
  })
})
