import { describe, expect, it, vi } from 'vitest'
import { BrowserError, openPage, resolveChromeExecutable } from './browserHelper.js'

// The device's Chrome reports a failure as a code with parameters; the add-on that asked says it in words (addons/ugAddon.test.ts).
describe('the device\'s Chrome helper (#15, #964)', () => {
  it('turns a page timeout into the code `timeout` with the seconds', async () => {
    const timeout = Object.assign(new Error('Navigation timeout of 20000 ms exceeded'), { name: 'TimeoutError' })
    await expect(openPage({ goto: vi.fn(async () => Promise.reject(timeout)) } as never, 'https://x')).rejects.toMatchObject({ name: 'BrowserError', code: 'timeout', params: { seconds: expect.any(Number) } })
  })

  it('turns a network failure into `unavailable`', async () => {
    const page = { goto: vi.fn(async () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED at https://x'))) }
    await expect(openPage(page as never, 'https://x')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('passes other navigation errors through unchanged', async () => {
    await expect(openPage({ goto: vi.fn(async () => Promise.reject(new Error('something else'))) } as never, 'https://x')).rejects.toThrow('something else')
  })

  it('says so when CHROME_EXECUTABLE_PATH points nowhere - with the path', () => {
    vi.stubEnv('CHROME_EXECUTABLE_PATH', '/nonexistent/chrome')
    expect(() => resolveChromeExecutable()).toThrow(expect.objectContaining({ code: 'chrome-path-wrong', params: { path: '/nonexistent/chrome' } }))
    vi.unstubAllEnvs()
    expect(new BrowserError('chrome-missing')).toBeInstanceOf(Error)
  })
})
