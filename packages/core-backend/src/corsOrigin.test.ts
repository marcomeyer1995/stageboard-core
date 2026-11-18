import { describe, expect, it } from 'vitest'
import { corsOriginAllowed } from './corsOrigin.js'

const STATIC = ['https://stageboard.local', 'https://localhost']
const LISTED = ['https://192.168.1.10:8443', 'https://192.168.1.11:8443']

describe('corsOriginAllowed (#926)', () => {
  it('allows the configured origins as before', () => {
    expect(corsOriginAllowed('https://stageboard.local', STATIC, [])).toBe(true)
  })

  it('also allows the origin of a host in the band list', () => {
    expect(corsOriginAllowed('https://192.168.1.10:8443', STATIC, LISTED)).toBe(true)
  })

  it('refuses any other origin, a lookalike (other port or scheme) included', () => {
    expect(corsOriginAllowed('https://evil.example', STATIC, LISTED)).toBe(false)
    expect(corsOriginAllowed('https://192.168.1.10:9999', STATIC, LISTED)).toBe(false)
    expect(corsOriginAllowed('http://192.168.1.10:8443', STATIC, LISTED)).toBe(false)
  })

  it('lets a request without an origin through (not a browser page)', () => {
    expect(corsOriginAllowed(undefined, STATIC, LISTED)).toBe(true)
  })
})
