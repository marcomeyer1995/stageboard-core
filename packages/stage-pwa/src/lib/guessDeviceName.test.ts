import { afterEach, describe, expect, it } from 'vitest'
import { guessDeviceName } from './guessDeviceName'

function withUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

const ORIGINAL_UA = navigator.userAgent

describe('guessDeviceName', () => {
  afterEach(() => withUserAgent(ORIGINAL_UA))

  it('recognizes an iPad', () => {
    withUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(guessDeviceName()).toBe('iPad')
  })

  it('recognizes an iPhone', () => {
    withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    expect(guessDeviceName()).toBe('iPhone')
  })

  it('distinguishes an Android phone from an Android tablet', () => {
    withUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')
    expect(guessDeviceName()).toBe('Android-Telefon')
    withUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X200) Safari/537.36')
    expect(guessDeviceName()).toBe('Android-Tablet')
  })

  it('recognizes a Mac', () => {
    withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')
    expect(guessDeviceName()).toBe('Mac')
  })

  it('recognizes Windows and Linux desktops', () => {
    withUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    expect(guessDeviceName()).toBe('Windows-PC')
    withUserAgent('Mozilla/5.0 (X11; Linux x86_64)')
    expect(guessDeviceName()).toBe('Linux-PC')
  })

  it('falls back to a generic name for an unrecognized user agent', () => {
    withUserAgent('SomeExoticBrowser/1.0')
    expect(guessDeviceName()).toBe('Unbekanntes Gerät')
  })
})
