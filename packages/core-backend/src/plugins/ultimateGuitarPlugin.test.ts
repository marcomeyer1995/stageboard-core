import { describe, expect, it, vi } from 'vitest'
import { LookupError } from './lookupError.js'
import { missingDataError, openUgPage, resolveChromeExecutable } from './ultimateGuitarPlugin.js'

describe('ultimate-guitar-scraper errors (#15)', () => {
  it('turns a page timeout into "UG antwortet nicht"', async () => {
    const timeout = Object.assign(new Error('Navigation timeout of 20000 ms exceeded'), { name: 'TimeoutError' })
    const page = { goto: vi.fn(async () => Promise.reject(timeout)) }
    await expect(openUgPage(page as never, 'https://x')).rejects.toMatchObject({ name: 'LookupError', code: 'timeout' })
  })

  it('turns a network failure into "nicht erreichbar"', async () => {
    const page = { goto: vi.fn(async () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED at https://x'))) }
    await expect(openUgPage(page as never, 'https://x')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Internet') })
  })

  it('passes other navigation errors through unchanged', async () => {
    const page = { goto: vi.fn(async () => Promise.reject(new Error('something else'))) }
    await expect(openUgPage(page as never, 'https://x')).rejects.toThrow('something else')
  })

  it('tells a Cloudflare challenge apart from a rebuilt site', () => {
    expect(missingDataError('Just a moment...')).toMatchObject({ code: 'blocked' })
    const changed = missingDataError('WONDERWALL CHORDS by Oasis @ Ultimate-Guitar.Com')
    expect(changed).toBeInstanceOf(LookupError)
    expect(changed.code).toBe('source-changed')
    expect(changed.message).toContain('WONDERWALL CHORDS')
  })

  it('says so when CHROME_EXECUTABLE_PATH points nowhere', () => {
    vi.stubEnv('CHROME_EXECUTABLE_PATH', '/nonexistent/chrome')
    expect(() => resolveChromeExecutable()).toThrow(expect.objectContaining({ code: 'no-browser', message: expect.stringContaining('/nonexistent/chrome') }))
    vi.unstubAllEnvs()
  })
})
