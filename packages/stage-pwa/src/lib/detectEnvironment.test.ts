import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ app: false }))
vi.mock('./native', () => ({ isNativeApp: () => native.app }))

const { detectEnvironment } = await import('./detectEnvironment')

function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: standalone } as MediaQueryList),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  native.app = false
  // @ts-expect-error - test-only cleanup of a property this suite adds to the real window.
  delete window.Capacitor
})

describe('detectEnvironment', () => {
  it('returns "native" in the native app, regardless of display-mode', () => {
    stubMatchMedia(false)
    native.app = true

    expect(detectEnvironment()).toBe('native')
  })

  it('a browser stays a browser although the web build defines window.Capacitor (2026-11-05)', () => {
    stubMatchMedia(false)
    // @ts-expect-error - @capacitor/core defines this global in every browser, too.
    window.Capacitor = {}

    expect(detectEnvironment()).toBe('browser')
  })

  it('returns "pwa" when display-mode is standalone outside the native app', () => {
    stubMatchMedia(true)

    expect(detectEnvironment()).toBe('pwa')
  })

  it('returns "browser" otherwise', () => {
    stubMatchMedia(false)

    expect(detectEnvironment()).toBe('browser')
  })
})
